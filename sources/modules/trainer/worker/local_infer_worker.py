#!/usr/bin/env python3
"""
Постоянный процесс нейросетевого инференса локальных моделей (.safetensors) на базе PyTorch (zero-copy mmap + KV-Cache).
Поддерживает архитектуры Qwen3, Qwen2.5, Llama-3, DeepSeek-R1-Distill, Gemma, Mistral (включая многофайловые шарды).
Общается с Node.js-сервером WORK по протоколу JSONL (stdin -> stdout), удерживая веса модели в памяти между запросами.
"""
import base64
import ctypes
import gc
import glob
import io
import json
import mmap
import os
import struct
import sys
import threading
import time
import warnings
import wave

warnings.filterwarnings("ignore")

try:
    import torch
    import torch.nn.functional as F
    HAS_TORCH = True
    torch.set_num_threads(max(4, min(16, (os.cpu_count() or 8))))
    try:
        torch.backends.mkldnn.enabled = True
    except Exception:
        pass
    DTYPE_MAP = {
        "BF16": torch.bfloat16,
        "F16": torch.float16,
        "F32": torch.float32,
        "I64": torch.int64,
        "I32": torch.int32,
    }
except Exception:
    torch = None
    F = None
    HAS_TORCH = False
    DTYPE_MAP = {}


_MIOPEN_CPU_FALLBACK_OPS = set()


def _install_rocm_miopen_fallback(target_f=None, target_torch=None):
    """На Windows ROCm (gfx1151) матричные ядра трансформеров (nn.Linear / SDPA) работают на GPU через hipBLASLt,
    но свёрточные ядра MIOpen (Conv1d/Conv2d/ConvTranspose в VAE Z-Image-Turbo и вокодере Qwen3-TTS)
    без компилятора rocm-sdk-devel падают с `miopenStatusInternalError`.
    Прозрачно перехватываем сбойные свёртки MIOpen и выполняем само свёрточное ядро на CPU (Unified Memory),
    возвращая тензор обратно на GPU (`cuda:0`).
    """
    f_mod = target_f if target_f is not None else F
    t_mod = target_torch if target_torch is not None else torch
    if f_mod is None or t_mod is None:
        return False
    if getattr(f_mod, "_work_miopen_wrapped", False):
        return True
    try:
        t_mod.backends.cudnn.benchmark = False
    except Exception:
        pass

    tensor_cls = getattr(t_mod, "Tensor", None)
    f16_dt = getattr(t_mod, "float16", None)
    f32_dt = getattr(t_mod, "float32", None)

    def _to_cpu(val):
        if tensor_cls is not None and isinstance(val, tensor_cls):
            dt = f32_dt if (f16_dt is not None and val.dtype == f16_dt and f32_dt is not None) else val.dtype
            return val.to(device="cpu", dtype=dt)
        return val

    def _wrap_conv(op_name):
        orig_fn = getattr(f_mod, op_name, None)
        if not callable(orig_fn):
            return

        def _safe_op(*args, **kwargs):
            x = args[0] if args else kwargs.get("input")
            is_cuda = bool(getattr(x, "is_cuda", False))
            if not is_cuda:
                return orig_fn(*args, **kwargs)
            orig_dev = x.device
            orig_dt = getattr(x, "dtype", None)
            key = (op_name, str(orig_dt))
            if key not in _MIOPEN_CPU_FALLBACK_OPS:
                try:
                    return orig_fn(*args, **kwargs)
                except Exception as e:
                    msg = str(e).lower()
                    if "miopen" not in msg and "cudnn" not in msg and "hip" not in msg:
                        raise
                    _MIOPEN_CPU_FALLBACK_OPS.add(key)
            cpu_args = tuple(_to_cpu(a) for a in args)
            cpu_kwargs = {k: _to_cpu(v) for k, v in kwargs.items()}
            out = orig_fn(*cpu_args, **cpu_kwargs)
            return out.to(device=orig_dev, dtype=orig_dt) if hasattr(out, "to") else out

        try:
            setattr(f_mod, op_name, _safe_op)
        except Exception:
            pass
        try:
            if hasattr(t_mod, op_name):
                setattr(t_mod, op_name, _safe_op)
        except Exception:
            pass

    for name in (
        "conv1d",
        "conv2d",
        "conv3d",
        "conv_transpose1d",
        "conv_transpose2d",
        "conv_transpose3d",
    ):
        _wrap_conv(name)
    try:
        f_mod._work_miopen_wrapped = True
    except Exception:
        pass
    return True


if HAS_TORCH:
    _install_rocm_miopen_fallback()


def _is_recoverable_gpu_error(exc):
    msg = str(exc or "").lower()
    return any(tok in msg for tok in (
        "miopen",
        "hip out of memory",
        "cuda out of memory",
        "out of memory",
        "hiperror",
        "cudnn",
        "invalid device function",
    ))


def _inference_mode_dec():
    if HAS_TORCH and hasattr(torch, "inference_mode"):
        return torch.inference_mode()
    return lambda fn: fn


class SafetensorsStore:
    """Zero-copy загрузчик .safetensors (одиночных и шардированных) через mmap."""

    def __init__(self, weights_dir):
        self.weights_dir = weights_dir
        self.files = []
        self.tensors = {}
        self._load_all()

    def _load_all(self):
        pattern = os.path.join(self.weights_dir, "*.safetensors")
        paths = sorted(glob.glob(pattern))
        if not paths:
            raise FileNotFoundError(f"В папке {self.weights_dir} не найдено файлов *.safetensors")

        for p in paths:
            f = open(p, "rb")
            mm = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
            self.files.append((f, mm))
            header_size = struct.unpack("<Q", mm[:8])[0]
            header_json = mm[8 : 8 + header_size].decode("utf-8")
            header = json.loads(header_json)
            data_base = 8 + header_size

            for name, info in header.items():
                if name == "__metadata__":
                    continue
                dtype = DTYPE_MAP.get(info["dtype"])
                if dtype is None:
                    continue
                start, end = info["data_offsets"]
                shape = tuple(info["shape"])
                byte_len = end - start
                if byte_len == 0:
                    continue
                elem_size = torch.tensor([], dtype=dtype).element_size()
                count = byte_len // elem_size
                t = torch.frombuffer(mm, dtype=dtype, count=count, offset=data_base + start).reshape(shape)
                self.tensors[name] = t

    def get(self, name, default=None):
        return self.tensors.get(name, default)


def rms_norm(x, weight, eps=1e-6):
    orig_dtype = x.dtype
    x_f32 = x.to(torch.float32)
    var = x_f32.pow(2).mean(-1, keepdim=True)
    x_norm = x_f32 * torch.rsqrt(var + eps)
    return (x_norm * weight.to(torch.float32)).to(orig_dtype)


def rotate_half(x):
    half = x.shape[-1] // 2
    x1 = x[..., :half]
    x2 = x[..., half:]
    return torch.cat((-x2, x1), dim=-1)


def apply_rope(q, k, cos, sin):
    q_embed = (q * cos) + (rotate_half(q) * sin)
    k_embed = (k * cos) + (rotate_half(k) * sin)
    return q_embed, k_embed


class LocalCausalLM:
    def __init__(self, weights_dir):
        cfg_path = os.path.join(weights_dir, "config.json")
        with open(cfg_path, "r", encoding="utf-8") as f:
            self.cfg = json.load(f)

        self.store = SafetensorsStore(weights_dir)
        self.num_layers = int(self.cfg.get("num_hidden_layers", 28))
        self.num_heads = int(self.cfg.get("num_attention_heads", 16))
        self.num_kv_heads = int(self.cfg.get("num_key_value_heads", self.num_heads))
        self.hidden_size = int(self.cfg.get("hidden_size", 1024))
        self.head_dim = int(self.cfg.get("head_dim", self.hidden_size // self.num_heads))
        self.rms_eps = float(self.cfg.get("rms_norm_eps", 1e-6))
        self.rope_theta = float(self.cfg.get("rope_theta", 1000000.0))

        target_dev, _ = _best_device_and_dtype()
        self.device = target_dev

        def _build_weights(dev):
            embed_t = self.store.get("model.embed_tokens.weight")
            norm_t = self.store.get("model.norm.weight")
            lm_t = self.store.get("lm_head.weight")
            if lm_t is None:
                lm_t = embed_t
            dt = embed_t.dtype if embed_t is not None else torch.bfloat16
            if str(dev).startswith("cuda") and dt not in (torch.bfloat16, torch.float16, torch.float32):
                dt = torch.bfloat16

            def _move(t):
                if t is None:
                    return None
                if str(dev) == "cpu":
                    return t
                return t.to(device=dev, dtype=dt)

            embed_m = _move(embed_t)
            norm_m = _move(norm_t)
            lm_m = embed_m if (lm_t is embed_t) else _move(lm_t)
            inv_f = (1.0 / (
                self.rope_theta
                ** (torch.arange(0, self.head_dim, 2, dtype=torch.float32) / self.head_dim)
            )).to(device=dev)
            layers_m = []
            for i in range(self.num_layers):
                p = f"model.layers.{i}"
                layers_m.append({
                    "in_norm": _move(self.store.get(f"{p}.input_layernorm.weight")),
                    "q_proj": _move(self.store.get(f"{p}.self_attn.q_proj.weight")),
                    "q_bias": _move(self.store.get(f"{p}.self_attn.q_proj.bias")),
                    "k_proj": _move(self.store.get(f"{p}.self_attn.k_proj.weight")),
                    "k_bias": _move(self.store.get(f"{p}.self_attn.k_proj.bias")),
                    "v_proj": _move(self.store.get(f"{p}.self_attn.v_proj.weight")),
                    "v_bias": _move(self.store.get(f"{p}.self_attn.v_proj.bias")),
                    "o_proj": _move(self.store.get(f"{p}.self_attn.o_proj.weight")),
                    "q_norm": _move(self.store.get(f"{p}.self_attn.q_norm.weight")),
                    "k_norm": _move(self.store.get(f"{p}.self_attn.k_norm.weight")),
                    "post_norm": _move(self.store.get(f"{p}.post_attention_layernorm.weight")),
                    "gate_proj": _move(self.store.get(f"{p}.mlp.gate_proj.weight")),
                    "up_proj": _move(self.store.get(f"{p}.mlp.up_proj.weight")),
                    "down_proj": _move(self.store.get(f"{p}.mlp.down_proj.weight")),
                })
            return embed_m, norm_m, lm_m, dt, inv_f, layers_m

        try:
            (
                self.embed_tokens,
                self.norm,
                self.lm_head,
                self.compute_dtype,
                self.inv_freq,
                self.layers,
            ) = _build_weights(self.device)
            if str(self.device).startswith("cuda"):
                # После переноса всех весов на GPU освобождаем CPU-mmap ссылки
                self.store.tensors.clear()
                for f_h, mm_h in self.store.files:
                    try:
                        mm_h.close()
                    except Exception:
                        pass
                    try:
                        f_h.close()
                    except Exception:
                        pass
                self.store.files.clear()
        except Exception:
            if str(self.device).startswith("cuda"):
                try:
                    torch.cuda.empty_cache()
                except Exception:
                    pass
                self.device = "cpu"
                (
                    self.embed_tokens,
                    self.norm,
                    self.lm_head,
                    self.compute_dtype,
                    self.inv_freq,
                    self.layers,
                ) = _build_weights("cpu")
            else:
                raise

    def _rope_cos_sin(self, positions, dtype):
        freqs = torch.outer(positions.to(torch.float32), self.inv_freq)
        emb = torch.cat((freqs, freqs), dim=-1)
        cos = emb.cos().to(dtype).unsqueeze(0).unsqueeze(0)  # [1, 1, seq, head_dim]
        sin = emb.sin().to(dtype).unsqueeze(0).unsqueeze(0)
        return cos, sin

    @_inference_mode_dec()
    def forward_step(self, input_ids, kv_cache, start_pos):
        if input_ids.device != self.embed_tokens.device:
            input_ids = input_ids.to(self.embed_tokens.device)
        seq_len = input_ids.shape[1]
        x = F.embedding(input_ids, self.embed_tokens)  # [1, seq, hidden]
        positions = torch.arange(start_pos, start_pos + seq_len, dtype=torch.long, device=self.embed_tokens.device)
        cos, sin = self._rope_cos_sin(positions, self.compute_dtype)

        for idx, layer in enumerate(self.layers):
            residual = x
            h = rms_norm(x, layer["in_norm"], self.rms_eps)

            q = F.linear(h, layer["q_proj"], layer["q_bias"])
            k = F.linear(h, layer["k_proj"], layer["k_bias"])
            v = F.linear(h, layer["v_proj"], layer["v_bias"])

            q = q.view(1, seq_len, self.num_heads, self.head_dim)
            k = k.view(1, seq_len, self.num_kv_heads, self.head_dim)
            v = v.view(1, seq_len, self.num_kv_heads, self.head_dim)

            if layer["q_norm"] is not None:
                q = rms_norm(q, layer["q_norm"], self.rms_eps)
            if layer["k_norm"] is not None:
                k = rms_norm(k, layer["k_norm"], self.rms_eps)

            q = q.transpose(1, 2)  # [1, heads, seq, head_dim]
            k = k.transpose(1, 2)  # [1, kv_heads, seq, head_dim]
            v = v.transpose(1, 2)

            q, k = apply_rope(q, k, cos, sin)

            if kv_cache[idx] is not None:
                prev_k, prev_v = kv_cache[idx]
                k = torch.cat((prev_k, k), dim=2)
                v = torch.cat((prev_v, v), dim=2)
            kv_cache[idx] = (k, v)

            attn_out = F.scaled_dot_product_attention(
                q, k, v,
                is_causal=(seq_len > 1 and start_pos == 0),
                enable_gqa=(self.num_heads != self.num_kv_heads),
            )
            attn_out = attn_out.transpose(1, 2).contiguous().view(1, seq_len, self.num_heads * self.head_dim)
            x = residual + F.linear(attn_out, layer["o_proj"])

            residual = x
            h2 = rms_norm(x, layer["post_norm"], self.rms_eps)
            gate = F.silu(F.linear(h2, layer["gate_proj"]))
            up = F.linear(h2, layer["up_proj"])
            x = residual + F.linear(gate * up, layer["down_proj"])

        last_hidden = rms_norm(x[:, -1:, :], self.norm, self.rms_eps)
        logits = F.linear(last_hidden[:, 0, :], self.lm_head)  # [1, vocab]
        return logits[0]

    @_inference_mode_dec()
    def generate_stream(self, req_id, prompt_ids, max_new_tokens=384, temperature=0.6, top_p=0.9, repetition_penalty=1.08, eos_ids=None, load_ms=0):
        eos_set = set(eos_ids or [151645, 151643])
        kv_cache = [None] * self.num_layers
        seen_tokens = list(prompt_ids)
        dev = self.embed_tokens.device

        inp = torch.tensor([prompt_ids], dtype=torch.long, device=dev)
        logits = self.forward_step(inp, kv_cache, 0)
        cur_pos = len(prompt_ids)

        for _ in range(max_new_tokens):
            next_token = self._sample(logits, seen_tokens, temperature, top_p, repetition_penalty)
            if next_token in eos_set:
                break
            seen_tokens.append(next_token)
            print(json.dumps({"id": req_id, "event": "token", "token": next_token}), flush=True)

            inp_next = torch.tensor([[next_token]], dtype=torch.long, device=dev)
            logits = self.forward_step(inp_next, kv_cache, cur_pos)
            cur_pos += 1

        print(json.dumps({
            "id": req_id,
            "event": "done",
            "generated": cur_pos - len(prompt_ids),
            "device": _describe_torch_device(self.device),
            "loadMs": int(load_ms or 0),
        }), flush=True)

    def _sample(self, logits, seen_tokens, temperature, top_p, repetition_penalty):
        logits_f = logits.to(torch.float32).clone()
        if repetition_penalty and repetition_penalty != 1.0 and seen_tokens:
            uniq = torch.tensor(list(set(seen_tokens[-128:])), dtype=torch.long, device=logits_f.device)
            vals = logits_f[uniq]
            logits_f[uniq] = torch.where(vals < 0, vals * repetition_penalty, vals / repetition_penalty)

        if temperature <= 0.02:
            return int(torch.argmax(logits_f).item())

        logits_f = logits_f / temperature
        probs = F.softmax(logits_f, dim=-1)
        sorted_probs, sorted_indices = torch.sort(probs, descending=True)
        cumulative_probs = torch.cumsum(sorted_probs, dim=-1)

        mask = cumulative_probs - sorted_probs > top_p
        sorted_probs[mask] = 0.0
        sorted_probs /= sorted_probs.sum()
        sampled_idx = torch.multinomial(sorted_probs[:64], 1)
        return int(sorted_indices[sampled_idx].item())


_CPU_BF16_OK = None


def _cpu_supports_bf16():
    global _CPU_BF16_OK
    if _CPU_BF16_OK is not None:
        return _CPU_BF16_OK
    if not HAS_TORCH:
        _CPU_BF16_OK = False
        return False
    try:
        a = torch.ones((2, 8), dtype=torch.bfloat16)
        b = torch.ones((4, 8), dtype=torch.bfloat16)
        _ = F.linear(a, b)
        _CPU_BF16_OK = True
    except Exception:
        _CPU_BF16_OK = False
    return _CPU_BF16_OK


def _best_device_and_dtype():
    if not HAS_TORCH:
        raise RuntimeError(json.dumps({
            "error": "В Python-окружении не установлен PyTorch (torch).",
            "missingDeps": ["torch"],
        }))
    if torch.cuda.is_available():
        return "cuda:0", torch.bfloat16
    return "cpu", (torch.bfloat16 if _cpu_supports_bf16() else torch.float32)


def _describe_torch_device(device="cpu"):
    dev_str = str(device or "cpu")
    if HAS_TORCH and dev_str.startswith("cuda") and torch.cuda.is_available():
        try:
            name = str(torch.cuda.get_device_name(0) or "").strip()
            return f"GPU ({name})" if name else "GPU"
        except Exception:
            return "GPU"
    if dev_str == "ort":
        return "ONNX (DirectML/NPU)"
    return "CPU (BF16)" if _cpu_supports_bf16() else "CPU"


def _onnx_external_data_ok(onnx_path):
    """Внешние тензоры ONNX лежат рядом с графом (`model.onnx_data` / `model.onnx.data`)."""
    return os.path.isfile(onnx_path + "_data") or os.path.isfile(onnx_path + ".data")


def _find_onnx_file(weights_dir):
    candidates = []
    for sub in ("", "onnx"):
        folder = os.path.join(weights_dir, sub) if sub else weights_dir
        if not os.path.isdir(folder):
            continue
        preferred = os.path.join(folder, "model.onnx")
        if os.path.isfile(preferred):
            candidates.append(preferred)
        else:
            found = sorted(glob.glob(os.path.join(folder, "*.onnx")))
            candidates.extend(found)
    for path in candidates:
        try:
            size = os.path.getsize(path)
        except OSError:
            continue
        # Маленький ONNX-граф без файла внешних данных не загрузится — пропускаем,
        # чтобы прозрачно использовать PyTorch-веса вместо падения на сессии.
        if size < 512 * 1024 * 1024 and not _onnx_external_data_ok(path):
            continue
        return path
    return None


def _has_torch_weights(weights_dir):
    patterns = ("*.safetensors", "*.bin", "*.pt", "*.pth")
    for pattern in patterns:
        if glob.glob(os.path.join(weights_dir, pattern)):
            return True
    for sub in ("transformer", "vae", "text_encoder"):
        folder = os.path.join(weights_dir, sub)
        if os.path.isdir(folder) and glob.glob(os.path.join(folder, "*.safetensors")):
            return True
    return False


def _has_safetensors(weights_dir):
    return bool(glob.glob(os.path.join(weights_dir, "*.safetensors")))


def _load_ort_session(onnx_path):
    ort_pkg = "onnxruntime-directml" if sys.platform == "win32" else "onnxruntime"
    try:
        import onnxruntime as ort
    except Exception as e:
        raise RuntimeError(json.dumps(_missing_pkg_error(e, {"onnxruntime": ort_pkg})))
    avail = set(ort.get_available_providers() or [])
    ordered = [
        p for p in (
            "VitisAIExecutionProvider",
            "QNNExecutionProvider",
            "DmlExecutionProvider",
            "CPUExecutionProvider",
        ) if p in avail
    ] or ["CPUExecutionProvider"]
    opts = ort.SessionOptions()
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    try:
        return ort.InferenceSession(onnx_path, sess_options=opts, providers=ordered)
    except Exception:
        return ort.InferenceSession(onnx_path, sess_options=opts, providers=["CPUExecutionProvider"])


def _missing_pkg_error(exc, required_map):
    msg = str(exc)
    missing = []
    for mod, pkg in required_map.items():
        if mod in msg or f"'{mod}'" in msg:
            missing.append(pkg)
    if not missing:
        missing = list(dict.fromkeys(required_map.values()))
    return {
        "error": f"В Python-окружении отсутствуют пакеты ({', '.join(missing)}): {msg}",
        "missingDeps": missing,
    }


def handle_check_deps():
    ort_pkg = "onnxruntime-directml" if sys.platform == "win32" else "onnxruntime"
    mods = {
        "torch": "torch",
        "transformers": "transformers",
        "diffusers": "diffusers",
        "accelerate": "accelerate",
        "PIL": "pillow",
        "soundfile": "soundfile",
        "qwen_tts": "qwen-tts",
        "qwen_asr": "qwen-asr",
        "onnxruntime": ort_pkg,
    }
    status = {}
    for mod, pkg in mods.items():
        try:
            __import__(mod)
            status[pkg] = True
        except Exception:
            status[pkg] = False
    cuda = False
    device_name = "CPU (BF16)" if _cpu_supports_bf16() else "CPU"
    try:
        cuda = bool(HAS_TORCH and torch.cuda.is_available())
        if cuda:
            device_name = torch.cuda.get_device_name(0)
        elif status.get(ort_pkg):
            import onnxruntime as ort
            provs = set(ort.get_available_providers() or [])
            if "VitisAIExecutionProvider" in provs or "QNNExecutionProvider" in provs:
                device_name = f"NPU (ONNX) + {device_name}"
            elif "DmlExecutionProvider" in provs:
                device_name = f"DirectML + {device_name}"
    except Exception:
        pass
    return {
        "packages": status,
        "cuda": cuda,
        "deviceName": device_name,
        "python": sys.executable,
    }


def _load_embed_model(weights_dir, cache):
    key = ("embed", weights_dir)
    if key in cache:
        return cache[key]
    try:
        from transformers import AutoTokenizer, AutoModel
    except Exception as e:
        raise RuntimeError(json.dumps(_missing_pkg_error(e, {"transformers": "transformers"})))
    tok = AutoTokenizer.from_pretrained(weights_dir, local_files_only=True)
    onnx_path = _find_onnx_file(weights_dir)
    if onnx_path:
        try:
            sess = _load_ort_session(onnx_path)
            cache[key] = ("onnx", tok, sess, "ort")
            return cache[key]
        except Exception:
            if not _has_torch_weights(weights_dir) or not HAS_TORCH:
                raise
    device, dtype = _best_device_and_dtype()
    try:
        try:
            mdl = AutoModel.from_pretrained(weights_dir, local_files_only=True, torch_dtype=dtype, attn_implementation="sdpa")
        except Exception:
            mdl = AutoModel.from_pretrained(weights_dir, local_files_only=True, torch_dtype=dtype)
        mdl.to(device).eval()
    except Exception:
        mdl = AutoModel.from_pretrained(weights_dir, local_files_only=True, torch_dtype=torch.float32)
        mdl.to("cpu").eval()
        device = "cpu"
    cache[key] = ("torch", tok, mdl, device)
    return cache[key]


def handle_embed(req, cache):
    weights_dir = req["weightsDir"]
    texts = req.get("input") or []
    if isinstance(texts, str):
        texts = [texts]
    was_cached = ("embed", weights_dir) in cache
    t_load0 = time.time()
    kind, tok, mdl, device = _load_embed_model(weights_dir, cache)
    load_ms = 0 if was_cached else int((time.time() - t_load0) * 1000)
    t_gen0 = time.time()
    if kind == "onnx":
        import numpy as np
        encoded = tok(texts, padding=True, truncation=True, max_length=int(req.get("maxLength", 2048)), return_tensors="np")
        feed = {}
        for inp in mdl.get_inputs():
            if inp.name in encoded:
                feed[inp.name] = encoded[inp.name].astype(np.int64)
            elif inp.name == "token_type_ids" and "input_ids" in encoded:
                feed[inp.name] = np.zeros_like(encoded["input_ids"], dtype=np.int64)
        outs = mdl.run(None, feed)
        last_hidden = outs[0].astype(np.float32)
        if last_hidden.ndim == 3:
            mask = encoded["attention_mask"].astype(np.float32)[..., None]
            summed = (last_hidden * mask).sum(axis=1)
            counts = np.clip(mask.sum(axis=1), 1e-9, None)
            vecs = summed / counts
        else:
            vecs = last_hidden
        norms = np.clip(np.linalg.norm(vecs, axis=1, keepdims=True), 1e-12, None)
        arr = (vecs / norms).tolist()
        gen_ms = max(1, int((time.time() - t_gen0) * 1000))
        return {"embeddings": arr, "dimensions": len(arr[0]) if arr else 0, "device": _describe_torch_device(device), "loadMs": load_ms, "genMs": gen_ms, "durationMs": gen_ms}
    with torch.inference_mode():
        encoded = tok(texts, padding=True, truncation=True, max_length=int(req.get("maxLength", 2048)), return_tensors="pt")
        encoded = {k: v.to(device) for k, v in encoded.items()}
        out = mdl(**encoded)
        last_hidden = out.last_hidden_state
        mask = encoded["attention_mask"].unsqueeze(-1).expand(last_hidden.size()).float()
        summed = torch.sum(last_hidden.float() * mask, dim=1)
        counts = torch.clamp(mask.sum(dim=1), min=1e-9)
        vecs = F.normalize(summed / counts, p=2, dim=1)
        arr = vecs.cpu().tolist()
    gen_ms = max(1, int((time.time() - t_gen0) * 1000))
    return {"embeddings": arr, "dimensions": len(arr[0]) if arr else 0, "device": _describe_torch_device(device), "loadMs": load_ms, "genMs": gen_ms, "durationMs": gen_ms}


def _load_rerank_model(weights_dir, cache):
    key = ("rerank", weights_dir)
    if key in cache:
        return cache[key]
    try:
        from transformers import AutoTokenizer, AutoModelForSequenceClassification
    except Exception as e:
        raise RuntimeError(json.dumps(_missing_pkg_error(e, {"transformers": "transformers"})))
    tok = AutoTokenizer.from_pretrained(weights_dir, local_files_only=True)
    onnx_path = _find_onnx_file(weights_dir)
    if onnx_path:
        try:
            sess = _load_ort_session(onnx_path)
            cache[key] = ("onnx", tok, sess, "ort")
            return cache[key]
        except Exception:
            if not _has_torch_weights(weights_dir) or not HAS_TORCH:
                raise
    device, dtype = _best_device_and_dtype()
    try:
        try:
            mdl = AutoModelForSequenceClassification.from_pretrained(weights_dir, local_files_only=True, torch_dtype=dtype, attn_implementation="sdpa")
        except Exception:
            mdl = AutoModelForSequenceClassification.from_pretrained(weights_dir, local_files_only=True, torch_dtype=dtype)
        mdl.to(device).eval()
    except Exception:
        mdl = AutoModelForSequenceClassification.from_pretrained(weights_dir, local_files_only=True, torch_dtype=torch.float32)
        mdl.to("cpu").eval()
        device = "cpu"
    cache[key] = ("torch", tok, mdl, device)
    return cache[key]


def handle_rerank(req, cache):
    weights_dir = req["weightsDir"]
    query = str(req.get("query", ""))
    docs = req.get("documents") or []
    if not docs:
        return {"results": [], "loadMs": 0, "genMs": 0, "durationMs": 0}
    was_cached = ("rerank", weights_dir) in cache
    t_load0 = time.time()
    kind, tok, mdl, device = _load_rerank_model(weights_dir, cache)
    load_ms = 0 if was_cached else int((time.time() - t_load0) * 1000)
    t_gen0 = time.time()
    pairs = [[query, str(d.get("text", d) if isinstance(d, dict) else d)] for d in docs]
    if kind == "onnx":
        import math
        import numpy as np
        inputs = tok(pairs, padding=True, truncation=True, max_length=int(req.get("maxLength", 1024)), return_tensors="np")
        feed = {}
        for inp in mdl.get_inputs():
            if inp.name in inputs:
                feed[inp.name] = inputs[inp.name].astype(np.int64)
            elif inp.name == "token_type_ids" and "input_ids" in inputs:
                feed[inp.name] = np.zeros_like(inputs["input_ids"], dtype=np.int64)
        logits = mdl.run(None, feed)[0].reshape(-1).astype(np.float32).tolist()
        scores = [1.0 / (1.0 + math.exp(-max(-40.0, min(40.0, float(x))))) for x in logits]
    else:
        with torch.inference_mode():
            inputs = tok(pairs, padding=True, truncation=True, max_length=int(req.get("maxLength", 1024)), return_tensors="pt")
            inputs = {k: v.to(device) for k, v in inputs.items()}
            logits = mdl(**inputs).logits.view(-1).float()
            scores = torch.sigmoid(logits).cpu().tolist()
    ranked = sorted(
        [{"index": i, "relevance_score": float(s), "document": docs[i]} for i, s in enumerate(scores)],
        key=lambda x: x["relevance_score"],
        reverse=True,
    )
    top_n = int(req.get("topN") or 0)
    if top_n > 0:
        ranked = ranked[:top_n]
    gen_ms = max(1, int((time.time() - t_gen0) * 1000))
    return {"results": ranked, "device": _describe_torch_device(device), "loadMs": load_ms, "genMs": gen_ms, "durationMs": gen_ms}


def _load_image_pipeline(weights_dir, cache):
    key = ("image", weights_dir)
    if key in cache:
        return cache[key]
    try:
        import diffusers
        import accelerate  # noqa: F401
        from PIL import Image  # noqa: F401
    except Exception as e:
        raise RuntimeError(json.dumps(_missing_pkg_error(e, {
            "diffusers": "diffusers",
            "accelerate": "accelerate",
            "PIL": "pillow",
        })))
    device, dtype = _best_device_and_dtype()
    pipe = None
    if hasattr(diffusers, "ZImagePipeline"):
        try:
            pipe = diffusers.ZImagePipeline.from_pretrained(weights_dir, local_files_only=True, torch_dtype=dtype)
        except Exception:
            pipe = None
    if pipe is None:
        pipe = diffusers.AutoPipelineForText2Image.from_pretrained(weights_dir, local_files_only=True, torch_dtype=dtype)
    try:
        pipe.to(device)
    except Exception:
        if str(device).startswith("cuda") and HAS_TORCH:
            try:
                torch.cuda.empty_cache()
            except Exception:
                pass
        device = "cpu"
        pipe.to(device)
    cache[key] = (pipe, device)
    return cache[key]


def handle_image(req, cache):
    weights_dir = req["weightsDir"]
    prompt = str(req.get("prompt", "")).strip()
    size_str = str(req.get("size", "512x512"))
    try:
        w, h = [max(256, min(1536, int(v))) for v in size_str.lower().split("x")[:2]]
    except Exception:
        w, h = 512, 512
    is_turbo = "z-image" in weights_dir.lower() or "turbo" in weights_dir.lower()
    steps = int(req.get("steps") or (4 if is_turbo else 8))
    seed = int(req.get("seed") if req.get("seed") is not None else 42)
    was_cached = ("image", weights_dir) in cache
    t_load0 = time.time()
    pipe, device = _load_image_pipeline(weights_dir, cache)
    load_ms = 0 if was_cached else int((time.time() - t_load0) * 1000)
    t_gen0 = time.time()
    gen = torch.Generator(device=device).manual_seed(seed)
    kwargs = {"prompt": prompt, "width": w, "height": h, "num_inference_steps": steps, "generator": gen}
    if is_turbo:
        kwargs["guidance_scale"] = 0.0
    try:
        with torch.inference_mode():
            out = pipe(**kwargs)
            img = out.images[0]
    except Exception as e:
        if str(device).startswith("cuda") and _is_recoverable_gpu_error(e):
            try:
                torch.cuda.empty_cache()
            except Exception:
                pass
            device = "cpu"
            pipe.to("cpu")
            cache[("image", weights_dir)] = (pipe, "cpu")
            kwargs["generator"] = torch.Generator(device="cpu").manual_seed(seed)
            with torch.inference_mode():
                out = pipe(**kwargs)
                img = out.images[0]
        else:
            raise
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    gen_ms = max(1, int((time.time() - t_gen0) * 1000))
    return {"mime": "image/png", "base64": base64.b64encode(buf.getvalue()).decode("ascii"), "device": _describe_torch_device(device), "loadMs": load_ms, "genMs": gen_ms, "durationMs": gen_ms}


def _pcm_to_wav_base64(samples, sample_rate):
    import array
    if hasattr(samples, "detach"):
        samples = samples.detach().cpu().float().flatten().tolist()
    elif hasattr(samples, "tolist"):
        samples = samples.flatten().tolist()
    pcm = array.array("h", (max(-32767, min(32767, int(float(s) * 32767.0))) for s in samples))
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(int(sample_rate))
        wf.writeframes(pcm.tobytes())
    return base64.b64encode(buf.getvalue()).decode("ascii")


DEFAULT_VOICE_DESIGN_INSTRUCT = (
    "Male, 35 years old, deep warm baritone voice, calm confident professional tone, "
    "natural pacing and clear articulation."
)

SUPPORTED_ASR_LANGUAGES = {
    "chinese": "Chinese", "english": "English", "cantonese": "Cantonese",
    "arabic": "Arabic", "german": "German", "french": "French",
    "spanish": "Spanish", "portuguese": "Portuguese", "indonesian": "Indonesian",
    "italian": "Italian", "korean": "Korean", "russian": "Russian",
    "thai": "Thai", "vietnamese": "Vietnamese", "japanese": "Japanese",
    "turkish": "Turkish", "hindi": "Hindi", "malay": "Malay",
    "dutch": "Dutch", "swedish": "Swedish", "danish": "Danish",
    "finnish": "Finnish", "polish": "Polish", "czech": "Czech",
    "filipino": "Filipino", "persian": "Persian", "greek": "Greek",
    "romanian": "Romanian", "hungarian": "Hungarian", "macedonian": "Macedonian",
}

TTS_LANGUAGE_ALIASES = {
    "ru": "Russian", "rus": "Russian", "russian": "Russian", "русский": "Russian", "рус": "Russian",
    "en": "English", "eng": "English", "english": "English", "английский": "English",
    "zh": "Chinese", "cn": "Chinese", "zho": "Chinese", "chinese": "Chinese", "китайский": "Chinese",
    "yue": "Cantonese", "cantonese": "Cantonese",
    "de": "German", "deu": "German", "ger": "German", "german": "German", "немецкий": "German",
    "fr": "French", "fra": "French", "fre": "French", "french": "French", "французский": "French",
    "es": "Spanish", "spa": "Spanish", "spanish": "Spanish", "испанский": "Spanish",
    "pt": "Portuguese", "por": "Portuguese", "portuguese": "Portuguese", "португальский": "Portuguese",
    "it": "Italian", "ita": "Italian", "italian": "Italian", "итальянский": "Italian",
    "ja": "Japanese", "jp": "Japanese", "jpn": "Japanese", "japanese": "Japanese", "японский": "Japanese",
    "ko": "Korean", "kor": "Korean", "korean": "Korean", "корейский": "Korean",
    "ar": "Arabic", "ara": "Arabic", "arabic": "Arabic", "арабский": "Arabic",
    "tr": "Turkish", "tur": "Turkish", "turkish": "Turkish", "турецкий": "Turkish",
    "hi": "Hindi", "hin": "Hindi", "hindi": "Hindi",
    "pl": "Polish", "pol": "Polish", "polish": "Polish",
    "cs": "Czech", "cze": "Czech", "ces": "Czech", "czech": "Czech",
    "nl": "Dutch", "nld": "Dutch", "dut": "Dutch", "dutch": "Dutch",
    "sv": "Swedish", "swe": "Swedish", "swedish": "Swedish",
    "da": "Danish", "dan": "Danish", "danish": "Danish",
    "fi": "Finnish", "fin": "Finnish", "finnish": "Finnish",
    "el": "Greek", "ell": "Greek", "gre": "Greek", "greek": "Greek",
    "ro": "Romanian", "ron": "Romanian", "rum": "Romanian", "romanian": "Romanian",
    "hu": "Hungarian", "hun": "Hungarian", "hungarian": "Hungarian",
    "mk": "Macedonian", "mkd": "Macedonian", "macedonian": "Macedonian",
    "th": "Thai", "tha": "Thai", "thai": "Thai",
    "vi": "Vietnamese", "vie": "Vietnamese", "vietnamese": "Vietnamese",
    "id": "Indonesian", "ind": "Indonesian", "indonesian": "Indonesian",
    "ms": "Malay", "msa": "Malay", "malay": "Malay",
    "fa": "Persian", "fas": "Persian", "per": "Persian", "persian": "Persian",
    "tl": "Filipino", "fil": "Filipino", "filipino": "Filipino",
    "auto": "Auto", "": "Auto",
}


def _read_json_file(path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {}


def _tts_language(value):
    raw = str(value or "").strip()
    key = raw.lower().split("-")[0].split("_")[0]
    if raw.lower() in TTS_LANGUAGE_ALIASES:
        return TTS_LANGUAGE_ALIASES[raw.lower()]
    if key in TTS_LANGUAGE_ALIASES:
        return TTS_LANGUAGE_ALIASES[key]
    if raw.lower() in SUPPORTED_ASR_LANGUAGES:
        return SUPPORTED_ASR_LANGUAGES[raw.lower()]
    return raw or "Auto"


def _asr_language(value):
    """Нормализация языка для Qwen3-ASR: поддерживаются 30 полных английских названий или None (автоопределение)."""
    raw = str(value or "").strip()
    if not raw or raw.lower() in ("auto", "none", "null", "default"):
        return None
    norm = _tts_language(raw)
    if norm == "Auto":
        return None
    canonical = SUPPORTED_ASR_LANGUAGES.get(norm.lower())
    return canonical


def _normalize_voice_design_instruct(raw_instruct):
    """Преобразовать русские и короткие описания голоса в детальный английский акустический профиль для Qwen3-TTS VoiceDesign.

    Энкодер инструкций Qwen3-TTS-VoiceDesign обучен на развёрнутых английских/китайских описаниях
    (пол, возраст, тембр, подача, темп). Короткая русская фраза («мужской голос») без перевода
    даёт слабый сигнал и случайный тембр.
    """
    txt = str(raw_instruct or "").strip()
    if not txt:
        return DEFAULT_VOICE_DESIGN_INSTRUCT
    low = txt.lower()
    has_cyrillic = any("а" <= ch <= "я" or ch in "ёіїєґ" for ch in low)
    if not has_cyrillic and len(txt) >= 32:
        return txt

    is_female = any(w in low for w in (
        "женск", "женщин", "девушк", "девочк", "сопрано", "альт", "леди",
        "female", "woman", "girl", "lady", "soprano", "alto",
    ))
    is_male = any(w in low for w in (
        "мужск", "мужчин", "парен", "парн", "мальчик", "баритон", "бас", "тенор", "диктор",
        "male", "man", "boy", "baritone", "bass", "tenor",
    ))
    if not is_female and not is_male:
        is_male = True

    if any(w in low for w in ("молод", "юный", "юная", "парен", "девушк", "young", "youth")):
        age_part = "23 years old, youthful"
    elif any(w in low for w in ("зрел", "стар", "взросл", "опытн", "mature", "older", "seasoned")):
        age_part = "45 years old, mature seasoned"
    else:
        age_part = "30 years old, adult" if is_female else "35 years old, adult"

    if is_female:
        if any(w in low for w in ("низк", "альт", "глубок", "бархат", "alto", "deep", "warm")):
            timbre = "warm rich alto female voice"
        elif any(w in low for w in ("высок", "звонк", "нежных", "нежн", "сопрано", "soprano", "bright")):
            timbre = "bright clear soprano female voice"
        else:
            timbre = "warm, clear, natural female voice"
        gender_tag = "Female"
    else:
        if any(w in low for w in ("бас", "низк", "глубок", "густ", "bass", "deep")):
            timbre = "deep resonant bass-baritone male voice"
        elif any(w in low for w in ("тенор", "высок", "светл", "tenor")):
            timbre = "clear expressive tenor male voice"
        else:
            timbre = "deep warm baritone male voice"
        gender_tag = "Male"

    style_parts = []
    if any(w in low for w in ("диктор", "новост", "официальн", "делов", "презентац", "announcer", "broadcast", "professional")):
        style_parts.append("authoritative professional broadcast announcer delivery with crystal-clear diction")
    if any(w in low for w in ("энергич", "жив", "бодр", "весел", "радост", "эмоцион", "energetic", "lively", "happy", "upbeat")):
        style_parts.append("energetic, lively, upbeat and expressive intonation")
    elif any(w in low for w in ("строг", "серьез", "уверен", "тверд", "serious", "stern", "confident")):
        style_parts.append("confident, composed, serious tone")
    else:
        style_parts.append("calm, confident, friendly and natural professional tone")

    if any(w in low for w in ("быстр", "динамич", "fast", "brisk")):
        pace_part = "brisk dynamic speaking pace"
    elif any(w in low for w in ("медлен", "размерен", "неспеш", "slow", "measured")):
        pace_part = "measured unhurried speaking pace"
    else:
        pace_part = "natural steady pacing and clean articulation"

    return f"{gender_tag}, {age_part}, {timbre}, {', '.join(style_parts)}, {pace_part}."


def _tts_model_kind(weights_dir, mdl, instructions=""):
    """Разновидность Qwen3-TTS: VoiceDesign / CustomVoice / Base (клонирование голоса).

    Метод `generate_*` в пакете есть у всех моделей, но исполняется только «свой»:
    вызов `generate_custom_voice` на VoiceDesign падает с ошибкой пакета.
    Поэтому тип берём из `config.json` (`tts_model_type`), а не из наличия метода.
    """
    cfg = _read_json_file(os.path.join(weights_dir, "config.json"))
    raw = str(cfg.get("tts_model_type") or "")
    if not raw:
        for attr in ("config", "model_config", "generation_config"):
            raw = str(getattr(getattr(mdl, attr, None), "tts_model_type", "") or "")
            if raw:
                break
    low = raw.lower().replace("-", "_")
    if "voice_design" in low or "voicedesign" in low:
        return "voice_design"
    if "custom_voice" in low or "customvoice" in low:
        return "custom_voice"
    if "base" in low or "clone" in low:
        return "base"
    name = os.path.basename(os.path.normpath(weights_dir)).lower()
    if "voicedesign" in name:
        return "voice_design"
    if "customvoice" in name:
        return "custom_voice"
    if "-base" in name or name.endswith("base"):
        return "base"
    return "voice_design" if instructions else "custom_voice"


def _resolve_tts_speaker(mdl, requested):
    """Имена спикеров регистрозависимы (`Serena`, `Vivian`, …) — сопоставляем с реальным списком модели."""
    try:
        speakers = [str(s) for s in (mdl.get_supported_speakers() or [])]
    except Exception:
        speakers = []
    want = str(requested or "").strip()
    if not speakers:
        return want or "Serena"
    if want:
        for s in speakers:
            if s.lower() == want.lower():
                return s
        for s in speakers:
            if want.lower() in s.lower():
                return s
    for s in speakers:
        if s.lower() == "serena":
            return s
    return speakers[0]


def _seed_torch_deterministic(seed_val):
    if not HAS_TORCH or torch is None:
        return
    try:
        s = int(seed_val if seed_val is not None else 42)
        torch.manual_seed(s)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(s)
    except Exception:
        pass


def _install_fast_qwen_tts_code_predictor(mdl):
    """Ускоряет внутренний 15-шаговый цикл `code_predictor` в Qwen3-TTS (вызывается на каждом 12 Гц кадре).

    Штатный `qwen_tts` на каждом 12 Гц шаге вызывает полный `GenerationMixin.generate()`,
    делая `deepcopy(generation_config)`, `torch.sort` по всему словарю и сохраняя 75 неиспользуемых
    тензоров `output_hidden_states=True`. Прямой цикл по 15 головам `lm_head[step]` делает ту же
    математику без обвязки `GenerationMixin` и лишних аллокаций.
    """
    cp = getattr(getattr(getattr(mdl, "model", None), "talker", None), "code_predictor", None)
    if cp is None or getattr(cp, "_work_fast_patched", False):
        return
    orig_generate = cp.generate

    class _FastPredictorOut:
        __slots__ = ("sequences", "hidden_states")

        def __init__(self, sequences):
            self.sequences = sequences
            self.hidden_states = None

    def _fast_generate(
        inputs_embeds=None,
        max_new_tokens=None,
        do_sample=False,
        top_p=1.0,
        top_k=50,
        temperature=0.9,
        **kwargs,
    ):
        if inputs_embeds is None:
            return orig_generate(
                inputs_embeds=inputs_embeds,
                max_new_tokens=max_new_tokens,
                do_sample=do_sample,
                top_p=top_p,
                top_k=top_k,
                temperature=temperature,
                **kwargs,
            )
        try:
            from transformers.cache_utils import DynamicCache
            steps = int(max_new_tokens or (cp.config.num_code_groups - 1))
            past_kv = DynamicCache()
            cur_embeds = cp.small_to_mtp_projection(inputs_embeds)
            embs = cp.model.get_input_embeddings()
            heads = cp.lm_head
            tokens = []
            temp = float(temperature) if (temperature and float(temperature) > 0) else 1.0
            k = int(top_k) if top_k else 0
            for step in range(steps):
                out = cp.model(
                    input_ids=None,
                    inputs_embeds=cur_embeds,
                    past_key_values=past_kv,
                    use_cache=True,
                    output_attentions=False,
                    output_hidden_states=False,
                )
                last_h = out.last_hidden_state[:, -1, :]
                logits = heads[step](last_h)
                if not do_sample:
                    next_tok = torch.argmax(logits, dim=-1, keepdim=True)
                else:
                    if temp != 1.0:
                        logits = logits / temp
                    if 0 < k < logits.size(-1):
                        top_vals, top_idx = torch.topk(logits, k, dim=-1)
                        probs = F.softmax(top_vals, dim=-1)
                        pick = torch.multinomial(probs, num_samples=1)
                        next_tok = top_idx.gather(-1, pick)
                    else:
                        probs = F.softmax(logits, dim=-1)
                        next_tok = torch.multinomial(probs, num_samples=1)
                tokens.append(next_tok)
                if step + 1 < steps:
                    cur_embeds = cp.small_to_mtp_projection(embs[step](next_tok))
            return _FastPredictorOut(torch.cat(tokens, dim=-1))
        except Exception:
            return orig_generate(
                inputs_embeds=inputs_embeds,
                max_new_tokens=max_new_tokens,
                do_sample=do_sample,
                top_p=top_p,
                top_k=top_k,
                temperature=temperature,
                **kwargs,
            )

    cp.generate = _fast_generate
    cp._work_fast_patched = True


def _call_tts_gen(fn, max_new_tokens, **kwargs):
    try:
        return fn(max_new_tokens=max_new_tokens, subtalker_dosample=False, **kwargs)
    except TypeError:
        try:
            return fn(max_new_tokens=max_new_tokens, **kwargs)
        except TypeError:
            return fn(**kwargs)


def _move_qwen_tts_vocoder_to_cpu(mdl):
    """Переносит декодер вокодера `speech_tokenizer` на CPU один раз при загрузке модели на GPU `cuda:0`.

    Убирает сотни мелких перебросов `cuda:0 ↔ cpu` внутри `_install_rocm_miopen_fallback` для каждой
    отдельной Conv1d/ConvTranspose1d свёртки: коды 12 Гц кадров один раз уходят в Unified Memory на CPU
    и целиком декодируются в волну.
    """
    st = getattr(getattr(mdl, "model", None), "speech_tokenizer", None) or getattr(mdl, "speech_tokenizer", None)
    if st is None or getattr(st, "_work_cpu_vocoder_patched", False):
        return False
    inner = getattr(st, "model", None) or st
    decoder = getattr(inner, "decoder", None)

    def _to_cpu_arg(v):
        if HAS_TORCH and torch is not None and isinstance(v, torch.Tensor):
            return v.detach().to("cpu")
        if isinstance(v, list):
            return [_to_cpu_arg(x) for x in v]
        if isinstance(v, tuple):
            return tuple(_to_cpu_arg(x) for x in v)
        if isinstance(v, dict):
            return {k: _to_cpu_arg(val) for k, val in v.items()}
        return v

    if decoder is not None and callable(getattr(decoder, "forward", None)) and hasattr(decoder, "to"):
        try:
            cpu_dt = torch.float32 if (HAS_TORCH and torch is not None) else "float32"
            decoder.to(device="cpu", dtype=cpu_dt)
            orig_fwd = decoder.forward

            def _cpu_decoder_fwd(*args, **kwargs):
                return orig_fwd(*(_to_cpu_arg(a) for a in args), **{k: _to_cpu_arg(v) for k, v in kwargs.items()})

            decoder.forward = _cpu_decoder_fwd
            st._work_cpu_vocoder_patched = True
            return True
        except Exception:
            pass

    dec = getattr(st, "decode", None)
    if not callable(dec):
        return False
    try:
        if hasattr(inner, "to"):
            cpu_dt = torch.float32 if (HAS_TORCH and torch is not None) else "float32"
            inner.to(device="cpu", dtype=cpu_dt)
    except Exception:
        return False

    orig_dec = dec

    def _cpu_decode(*args, **kwargs):
        return orig_dec(*(_to_cpu_arg(a) for a in args), **{k: _to_cpu_arg(v) for k, v in kwargs.items()})

    try:
        st.decode = _cpu_decode
        orig_enc = getattr(st, "encode", None)
        if callable(orig_enc):
            st.encode = lambda *args, **kwargs: orig_enc(*(_to_cpu_arg(a) for a in args), **{k: _to_cpu_arg(v) for k, v in kwargs.items()})
        st._work_cpu_vocoder_patched = True
        return True
    except Exception:
        return False


def _load_qwen_tts_model(weights_dir):
    from qwen_tts import Qwen3TTSModel
    device, dtype = _best_device_and_dtype()
    candidates = [(device, dtype)]
    if str(device).startswith("cuda"):
        cpu_dtype = torch.bfloat16 if _cpu_supports_bf16() else torch.float32
        candidates.append(("cpu", cpu_dtype))
    last_err = None
    for dev, dt in candidates:
        try:
            try:
                mdl = Qwen3TTSModel.from_pretrained(
                    weights_dir,
                    device_map=dev,
                    dtype=dt,
                    attn_implementation="sdpa",
                )
            except Exception:
                mdl = Qwen3TTSModel.from_pretrained(weights_dir, device_map=dev, dtype=dt)
            _install_fast_qwen_tts_code_predictor(mdl)
            if str(dev).startswith("cuda"):
                _move_qwen_tts_vocoder_to_cpu(mdl)
            mdl._work_device = dev
            return mdl
        except Exception as e:
            last_err = e
            if str(dev).startswith("cuda") and HAS_TORCH:
                try:
                    torch.cuda.empty_cache()
                except Exception:
                    pass
    raise last_err


def handle_tts(req, cache):
    weights_dir = req["weightsDir"]
    text = str(req.get("text", "")).strip()
    language = _tts_language(req.get("language") or "Russian")
    instructions = str(req.get("instructions") or "").strip()
    seed = int(req.get("seed") if req.get("seed") is not None else 42)
    # 12.5 Гц аудио-токенизатор (~0.93 кадра на символ речи): компактный потолок без холостых хвостов
    max_new_tokens = max(72, min(768, int(len(text) * 2.0) + 48))
    key = ("tts", weights_dir)
    was_cached = key in cache
    t_load0 = time.time()
    if not was_cached:
        try:
            from qwen_tts import Qwen3TTSModel  # noqa: F401
        except Exception as e:
            raise RuntimeError(json.dumps(_missing_pkg_error(e, {
                "qwen_tts": "qwen-tts",
                "soundfile": "soundfile",
            })))
        try:
            cache[key] = _load_qwen_tts_model(weights_dir)
        except Exception as e:
            # Пакет установлен, но веса/конфиг не читаются — отдаём реальную причину,
            # а не ложное «нет пакетов», из-за которого раньше шёл бесконечный переустанов.
            raise RuntimeError(json.dumps({
                "error": f"Не удалось загрузить модель синтеза речи из {weights_dir}: {e}",
            }))
    load_ms = 0 if was_cached else int((time.time() - t_load0) * 1000)
    mdl = cache[key]
    _install_fast_qwen_tts_code_predictor(mdl)
    active_dev = getattr(mdl, "_work_device", None) or str(getattr(mdl, "device", "cpu"))
    kind = _tts_model_kind(weights_dir, mdl, instructions)
    _seed_torch_deterministic(seed)
    t_gen0 = time.time()
    instruct_used = ""
    try:
        if kind == "voice_design":
            # VoiceDesign синтезирует голос по текстовому описанию (`instruct`);
            # переводим русские и короткие описания в полный акустический профиль на английском.
            instruct_used = _normalize_voice_design_instruct(instructions)
            wavs, sr = _call_tts_gen(
                mdl.generate_voice_design,
                max_new_tokens,
                text=text,
                language=language,
                instruct=instruct_used,
            )
        elif kind == "custom_voice":
            kwargs = {
                "text": text,
                "language": language,
                "speaker": _resolve_tts_speaker(mdl, req.get("voice")),
            }
            if instructions and "0.6b" not in weights_dir.lower():
                kwargs["instruct"] = instructions
                instruct_used = instructions
            try:
                wavs, sr = _call_tts_gen(mdl.generate_custom_voice, max_new_tokens, **kwargs)
            except Exception as e:
                # CustomVoice 0.6B не принимает instruct — повторяем без него.
                if "instruct" in kwargs and ("instruct" in str(e).lower() or "0.6b" in weights_dir.lower()):
                    kwargs.pop("instruct")
                    instruct_used = ""
                    wavs, sr = _call_tts_gen(mdl.generate_custom_voice, max_new_tokens, **kwargs)
                else:
                    raise
        else:
            ref_b64 = str(req.get("refAudioBase64") or "")
            if not ref_b64:
                raise RuntimeError(json.dumps({
                    "error": "Модель Qwen3-TTS Base клонирует голос и требует эталонную запись "
                             "(refAudioBase64 + refText). Для синтеза без эталона используйте "
                             "Qwen3-TTS-12Hz-1.7B-VoiceDesign или -CustomVoice.",
                }))
            import tempfile
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
                tf.write(base64.b64decode(ref_b64))
                ref_path = tf.name
            ref_text = str(req.get("refText") or "").strip()
            try:
                wavs, sr = _call_tts_gen(
                    mdl.generate_voice_clone,
                    max_new_tokens,
                    text=text,
                    language=language,
                    ref_audio=ref_path,
                    ref_text=ref_text,
                    x_vector_only_mode=not ref_text,
                )
            finally:
                try:
                    os.remove(ref_path)
                except Exception:
                    pass
    except RuntimeError:
        raise
    except Exception as e:
        raise RuntimeError(json.dumps({
            "error": f"Синтез речи Qwen3-TTS ({kind}) не удался: {e}",
        }))
    gen_ms = max(1, int((time.time() - t_gen0) * 1000))
    audio = wavs[0] if isinstance(wavs, (list, tuple)) else wavs
    return {
        "audioBase64": _pcm_to_wav_base64(audio, sr),
        "sampleRate": int(sr),
        "ttsKind": kind,
        "instructUsed": instruct_used,
        "device": _describe_torch_device(active_dev),
        "loadMs": load_ms,
        "genMs": gen_ms,
        "durationMs": gen_ms,
    }


def handle_stt(req, cache):
    weights_dir = req["weightsDir"]
    audio_b64 = req.get("audioBase64", "")
    language = _asr_language(req.get("language"))
    raw = base64.b64decode(audio_b64)
    key = ("stt", weights_dir)
    was_cached = key in cache
    t_load0 = time.time()
    if not was_cached:
        device, dtype = _best_device_and_dtype()
        candidates = [(device, dtype)]
        if str(device).startswith("cuda"):
            cpu_dtype = torch.bfloat16 if _cpu_supports_bf16() else torch.float32
            candidates.append(("cpu", cpu_dtype))
        errors = []
        try:
            from qwen_asr import Qwen3ASRModel
            for dev, dt in candidates:
                try:
                    try:
                        loaded = Qwen3ASRModel.from_pretrained(weights_dir, dtype=dt, device_map=dev, attn_implementation="sdpa")
                    except Exception:
                        loaded = Qwen3ASRModel.from_pretrained(weights_dir, dtype=dt, device_map=dev)
                    loaded._work_device = dev
                    cache[key] = ("qwen_asr", loaded)
                    break
                except Exception as e:
                    errors.append(f"qwen-asr ({dev}): {e}")
                    if str(dev).startswith("cuda") and HAS_TORCH:
                        try:
                            torch.cuda.empty_cache()
                        except Exception:
                            pass
        except Exception as e:
            errors.append(f"qwen-asr (нет пакета): {e}")
        if key not in cache:
            try:
                from transformers import pipeline
                for dev, dt in candidates:
                    try:
                        p_obj = pipeline(
                            "automatic-speech-recognition",
                            model=weights_dir,
                            device=0 if str(dev).startswith("cuda") else -1,
                            torch_dtype=dt,
                        )
                        p_obj._work_device = dev
                        cache[key] = ("hf_asr", p_obj)
                        break
                    except Exception as e:
                        errors.append(f"transformers ({dev}): {e}")
            except Exception as e:
                errors.append(f"transformers (нет пакета): {e}")
        if key not in cache:
            msg = " | ".join(errors)
            if "No module named" in msg:
                raise RuntimeError(json.dumps(_missing_pkg_error(Exception(msg), {
                    "qwen_asr": "qwen-asr",
                    "soundfile": "soundfile",
                    "transformers": "transformers",
                })))
            raise RuntimeError(json.dumps({
                "error": f"Не удалось загрузить модель распознавания речи из {weights_dir}: {msg}",
            }))
    load_ms = 0 if was_cached else int((time.time() - t_load0) * 1000)
    kind, mdl = cache[key]
    active_dev = getattr(mdl, "_work_device", None) or str(getattr(mdl, "device", "cpu"))
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
        tf.write(raw)
        tmp_path = tf.name
    t_gen0 = time.time()
    try:
        if kind == "qwen_asr":
            try:
                res = mdl.transcribe(audio=tmp_path, language=language)
            except Exception as e:
                if "unsupported language" in str(e).lower() and language is not None:
                    res = mdl.transcribe(audio=tmp_path, language=None)
                else:
                    raise
            txt = res[0].text if isinstance(res, list) and res else getattr(res, "text", str(res))
        else:
            res = mdl(tmp_path)
            txt = res.get("text", "") if isinstance(res, dict) else str(res)
    finally:
        try:
            os.remove(tmp_path)
        except Exception:
            pass
    gen_ms = max(1, int((time.time() - t_gen0) * 1000))
    return {"text": str(txt or "").strip(), "language": language or "Auto", "device": _describe_torch_device(active_dev), "loadMs": load_ms, "genMs": gen_ms, "durationMs": gen_ms}


def _get_free_ram_gb():
    """Кроссплатформенно определить объём свободной оперативной памяти в ГБ."""
    try:
        if sys.platform == "win32":
            class _MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [
                    ("dwLength", ctypes.c_ulong),
                    ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong),
                    ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
                ]
            st = _MEMORYSTATUSEX()
            st.dwLength = ctypes.sizeof(_MEMORYSTATUSEX)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(st)):
                return float(st.ullAvailPhys) / (1024.0 ** 3)
        elif os.path.isfile("/proc/meminfo"):
            with open("/proc/meminfo", "r", encoding="utf-8") as f:
                for line in f:
                    if line.startswith("MemAvailable:"):
                        kb = float(line.split()[1])
                        return kb / (1024.0 ** 2)
    except Exception:
        pass
    return None


def _release_cached_item(obj):
    try:
        if isinstance(obj, tuple) and len(obj) >= 1 and hasattr(obj[0], "to"):
            try:
                obj[0].to("cpu")
            except Exception:
                pass
        elif hasattr(obj, "to"):
            try:
                obj.to("cpu")
            except Exception:
                pass
    except Exception:
        pass


def _evict_memory_if_needed(
    mod_cache,
    mod_last_used,
    models,
    llm_last_used,
    cache_lock=None,
    keep_mod_key=None,
    keep_llm_key=None,
    now_ts=None,
):
    """Умная очистка памяти:
    - Тяжёлую диффузию (`image`, напр. Z-Image-Turbo) выгружаем через `WORK_IMAGE_IDLE_SEC` (10 мин)
      или при падении свободной RAM ниже `WORK_MIN_FREE_RAM_GB` (20 ГБ).
    - Лёгкие модели (embed, rerank, tts, stt, 0.6B/4B) держим постоянно горячими,
      выгружая по LRU только при критической нехватке RAM (`< WORK_CRIT_FREE_RAM_GB`, 10 ГБ).
    """
    now = float(now_ts if now_ts is not None else time.time())
    image_idle_sec = float(os.environ.get("WORK_IMAGE_IDLE_SEC", "600"))
    min_free_gb = float(os.environ.get("WORK_MIN_FREE_RAM_GB", "20"))
    crit_free_gb = float(os.environ.get("WORK_CRIT_FREE_RAM_GB", "10"))
    free_gb = _get_free_ram_gb()
    evicted = []

    def _do():
        low_mem = free_gb is not None and free_gb < min_free_gb
        for k in list(mod_cache.keys()):
            if not (isinstance(k, tuple) and len(k) >= 1 and k[0] == "image"):
                continue
            if k == keep_mod_key:
                continue
            idle = now - float(mod_last_used.get(k, now))
            if idle >= image_idle_sec or low_mem:
                obj = mod_cache.pop(k, None)
                mod_last_used.pop(k, None)
                _release_cached_item(obj)
                evicted.append(k)

        if free_gb is not None and free_gb < crit_free_gb:
            # Критическая нехватка памяти — выгружаем самую давно неиспользуемую неактивную модель
            candidates = []
            for k in list(mod_cache.keys()):
                if k != keep_mod_key:
                    candidates.append(("mod", k, float(mod_last_used.get(k, 0.0))))
            for k in list(models.keys()):
                if k != keep_llm_key:
                    candidates.append(("llm", k, float(llm_last_used.get(k, 0.0))))
            candidates.sort(key=lambda item: item[2])
            for kind, k, _ in candidates[:2]:
                if kind == "mod":
                    obj = mod_cache.pop(k, None)
                    mod_last_used.pop(k, None)
                    _release_cached_item(obj)
                    evicted.append(k)
                else:
                    obj = models.pop(k, None)
                    llm_last_used.pop(k, None)
                    _release_cached_item(obj)
                    evicted.append(("llm", k))

    if cache_lock is not None:
        with cache_lock:
            _do()
    else:
        _do()

    if evicted:
        try:
            gc.collect()
        except Exception:
            pass
        if HAS_TORCH and torch is not None and torch.cuda.is_available():
            try:
                torch.cuda.empty_cache()
            except Exception:
                pass
    return evicted


def main():
    models = {}
    mod_cache = {}
    mod_last_used = {}
    llm_last_used = {}
    cache_lock = threading.Lock()
    idle_timers = {"image": None}

    def _schedule_image_idle_eviction():
        try:
            prev = idle_timers.get("image")
            if prev is not None:
                prev.cancel()
            delay = max(5.0, float(os.environ.get("WORK_IMAGE_IDLE_SEC", "600")) + 1.0)
            t = threading.Timer(
                delay,
                lambda: _evict_memory_if_needed(mod_cache, mod_last_used, models, llm_last_used, cache_lock=cache_lock),
            )
            t.daemon = True
            t.start()
            idle_timers["image"] = t
        except Exception:
            pass

    print(json.dumps({"event": "ready"}), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id = ""
        try:
            req = json.loads(line)
            req_id = req.get("id", "")
            op = req.get("op", "chat")

            if op == "check_deps":
                print(json.dumps({"id": req_id, "event": "result", "data": handle_check_deps()}), flush=True)
                continue
            if not HAS_TORCH and not (op in ("embed", "rerank") and _find_onnx_file(str(req.get("weightsDir") or ""))):
                needed = ["torch"]
                if op in ("embed", "rerank"):
                    needed.append("transformers")
                elif op == "image":
                    needed.extend(["diffusers", "accelerate", "pillow", "transformers"])
                elif op == "tts":
                    needed.extend(["qwen-tts", "soundfile", "transformers"])
                elif op == "stt":
                    needed.extend(["qwen-asr", "soundfile", "transformers"])
                print(json.dumps({
                    "id": req_id,
                    "event": "error",
                    "error": "В Python-окружении не установлен PyTorch (torch) и необходимые библиотеки.",
                    "missingDeps": needed,
                }), flush=True)
                continue
            if op in ("embed", "rerank", "image", "tts", "stt"):
                t0 = time.time()
                mod_key = (op, str(req.get("weightsDir") or ""))
                _evict_memory_if_needed(
                    mod_cache, mod_last_used, models, llm_last_used,
                    cache_lock=cache_lock, keep_mod_key=mod_key,
                )
                fn = {
                    "embed": handle_embed,
                    "rerank": handle_rerank,
                    "image": handle_image,
                    "tts": handle_tts,
                    "stt": handle_stt,
                }[op]
                with cache_lock:
                    res = fn(req, mod_cache)
                    mod_last_used[mod_key] = time.time()
                if op == "image":
                    _schedule_image_idle_eviction()
                if "durationMs" not in res:
                    res["durationMs"] = int((time.time() - t0) * 1000)
                print(json.dumps({"id": req_id, "event": "result", "data": res}), flush=True)
                continue

            weights_dir = req["weightsDir"]
            prompt_ids = req["inputIds"]
            max_new_tokens = int(req.get("maxNewTokens", 384))
            temperature = float(req.get("temperature", 0.6))
            eos_ids = req.get("eosTokenIds", [151645, 151643])

            _evict_memory_if_needed(
                mod_cache, mod_last_used, models, llm_last_used,
                cache_lock=cache_lock, keep_llm_key=weights_dir,
            )
            load_ms = 0
            with cache_lock:
                if weights_dir not in models:
                    t_l0 = time.time()
                    models[weights_dir] = LocalCausalLM(weights_dir)
                    load_ms = int((time.time() - t_l0) * 1000)
                llm_last_used[weights_dir] = time.time()
                mdl_ref = models[weights_dir]

            mdl_ref.generate_stream(
                req_id=req_id,
                prompt_ids=prompt_ids,
                max_new_tokens=max_new_tokens,
                temperature=temperature,
                eos_ids=eos_ids,
                load_ms=load_ms,
            )
        except Exception as e:
            err_str = str(e)
            payload = {"id": req_id, "event": "error", "error": err_str}
            try:
                parsed = json.loads(err_str)
                if isinstance(parsed, dict) and parsed.get("error"):
                    payload["error"] = parsed["error"]
                    if parsed.get("missingDeps"):
                        payload["missingDeps"] = parsed["missingDeps"]
            except Exception:
                pass
            print(json.dumps(payload), flush=True)


if __name__ == "__main__":
    main()
