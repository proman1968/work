#!/usr/bin/env python3
"""
Постоянный процесс нейросетевого инференса локальных моделей (.safetensors) на базе PyTorch (zero-copy mmap + KV-Cache).
Поддерживает архитектуры Qwen3, Qwen2.5, Llama-3, DeepSeek-R1-Distill, Gemma, Mistral (включая многофайловые шарды).
Общается с Node.js-сервером WORK по протоколу JSONL (stdin -> stdout), удерживая веса модели в памяти между запросами.
"""
import base64
import glob
import io
import json
import mmap
import os
import struct
import sys
import time
import warnings
import wave

warnings.filterwarnings("ignore")

try:
    import torch
    import torch.nn.functional as F
    HAS_TORCH = True
    torch.set_num_threads(max(1, (os.cpu_count() or 4) // 2))
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

        self.embed_tokens = self.store.get("model.embed_tokens.weight")
        self.norm = self.store.get("model.norm.weight")
        self.lm_head = self.store.get("lm_head.weight")
        if self.lm_head is None:
            self.lm_head = self.embed_tokens

        self.compute_dtype = self.embed_tokens.dtype

        inv_freq = 1.0 / (
            self.rope_theta
            ** (torch.arange(0, self.head_dim, 2, dtype=torch.float32) / self.head_dim)
        )
        self.inv_freq = inv_freq

        self.layers = []
        for i in range(self.num_layers):
            p = f"model.layers.{i}"
            self.layers.append({
                "in_norm": self.store.get(f"{p}.input_layernorm.weight"),
                "q_proj": self.store.get(f"{p}.self_attn.q_proj.weight"),
                "q_bias": self.store.get(f"{p}.self_attn.q_proj.bias"),
                "k_proj": self.store.get(f"{p}.self_attn.k_proj.weight"),
                "k_bias": self.store.get(f"{p}.self_attn.k_proj.bias"),
                "v_proj": self.store.get(f"{p}.self_attn.v_proj.weight"),
                "v_bias": self.store.get(f"{p}.self_attn.v_proj.bias"),
                "o_proj": self.store.get(f"{p}.self_attn.o_proj.weight"),
                "q_norm": self.store.get(f"{p}.self_attn.q_norm.weight"),
                "k_norm": self.store.get(f"{p}.self_attn.k_norm.weight"),
                "post_norm": self.store.get(f"{p}.post_attention_layernorm.weight"),
                "gate_proj": self.store.get(f"{p}.mlp.gate_proj.weight"),
                "up_proj": self.store.get(f"{p}.mlp.up_proj.weight"),
                "down_proj": self.store.get(f"{p}.mlp.down_proj.weight"),
            })

    def _rope_cos_sin(self, positions, dtype):
        freqs = torch.outer(positions.to(torch.float32), self.inv_freq)
        emb = torch.cat((freqs, freqs), dim=-1)
        cos = emb.cos().to(dtype).unsqueeze(0).unsqueeze(0)  # [1, 1, seq, head_dim]
        sin = emb.sin().to(dtype).unsqueeze(0).unsqueeze(0)
        return cos, sin

    @_inference_mode_dec()
    def forward_step(self, input_ids, kv_cache, start_pos):
        seq_len = input_ids.shape[1]
        x = F.embedding(input_ids, self.embed_tokens)  # [1, seq, hidden]
        positions = torch.arange(start_pos, start_pos + seq_len, dtype=torch.long)
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
    def generate_stream(self, req_id, prompt_ids, max_new_tokens=384, temperature=0.6, top_p=0.9, repetition_penalty=1.08, eos_ids=None):
        eos_set = set(eos_ids or [151645, 151643])
        kv_cache = [None] * self.num_layers
        seen_tokens = list(prompt_ids)

        inp = torch.tensor([prompt_ids], dtype=torch.long)
        logits = self.forward_step(inp, kv_cache, 0)
        cur_pos = len(prompt_ids)

        for _ in range(max_new_tokens):
            next_token = self._sample(logits, seen_tokens, temperature, top_p, repetition_penalty)
            if next_token in eos_set:
                break
            seen_tokens.append(next_token)
            print(json.dumps({"id": req_id, "event": "token", "token": next_token}), flush=True)

            inp_next = torch.tensor([[next_token]], dtype=torch.long)
            logits = self.forward_step(inp_next, kv_cache, cur_pos)
            cur_pos += 1

        print(json.dumps({"id": req_id, "event": "done", "generated": cur_pos - len(prompt_ids)}), flush=True)

    def _sample(self, logits, seen_tokens, temperature, top_p, repetition_penalty):
        logits_f = logits.to(torch.float32).clone()
        if repetition_penalty and repetition_penalty != 1.0 and seen_tokens:
            uniq = torch.tensor(list(set(seen_tokens[-128:])), dtype=torch.long)
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
        return "cuda", torch.bfloat16
    return "cpu", (torch.bfloat16 if _cpu_supports_bf16() else torch.float32)


def _find_onnx_file(weights_dir):
    for sub in ("", "onnx"):
        folder = os.path.join(weights_dir, sub) if sub else weights_dir
        if not os.path.isdir(folder):
            continue
        preferred = os.path.join(folder, "model.onnx")
        if os.path.isfile(preferred):
            return preferred
        found = sorted(glob.glob(os.path.join(folder, "*.onnx")))
        if found:
            return found[0]
    return None


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
            if not _has_safetensors(weights_dir) or not HAS_TORCH:
                raise
    device, dtype = _best_device_and_dtype()
    try:
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
    kind, tok, mdl, device = _load_embed_model(weights_dir, cache)
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
        return {"embeddings": arr, "dimensions": len(arr[0]) if arr else 0}
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
    return {"embeddings": arr, "dimensions": len(arr[0]) if arr else 0}


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
            if not _has_safetensors(weights_dir) or not HAS_TORCH:
                raise
    device, dtype = _best_device_and_dtype()
    try:
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
        return {"results": []}
    kind, tok, mdl, device = _load_rerank_model(weights_dir, cache)
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
    return {"results": ranked}


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
    steps = int(req.get("steps") or 8)
    seed = int(req.get("seed") if req.get("seed") is not None else 42)
    pipe, device = _load_image_pipeline(weights_dir, cache)
    gen = torch.Generator(device=device).manual_seed(seed)
    kwargs = {"prompt": prompt, "width": w, "height": h, "num_inference_steps": steps, "generator": gen}
    if "z-image" in weights_dir.lower() or "turbo" in weights_dir.lower():
        kwargs["guidance_scale"] = 0.0
    with torch.inference_mode():
        out = pipe(**kwargs)
        img = out.images[0]
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return {"mime": "image/png", "base64": base64.b64encode(buf.getvalue()).decode("ascii")}


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


def handle_tts(req, cache):
    weights_dir = req["weightsDir"]
    text = str(req.get("text", "")).strip()
    language = str(req.get("language") or "Russian")
    instructions = str(req.get("instructions") or "").strip()
    key = ("tts", weights_dir)
    if key not in cache:
        try:
            from qwen_tts import Qwen3TTSModel
        except Exception as e:
            raise RuntimeError(json.dumps(_missing_pkg_error(e, {
                "qwen_tts": "qwen-tts",
                "soundfile": "soundfile",
            })))
        device, dtype = _best_device_and_dtype()
        mdl = Qwen3TTSModel.from_pretrained(weights_dir, device_map=device, dtype=dtype)
        cache[key] = mdl
    mdl = cache[key]
    if hasattr(mdl, "generate_voice_design") and instructions:
        wavs, sr = mdl.generate_voice_design(text=text, language=language, instruct=instructions)
    elif hasattr(mdl, "generate_custom_voice"):
        wavs, sr = mdl.generate_custom_voice(text=text, language=language, speaker=str(req.get("voice") or "serena"), instruct=instructions or None)
    else:
        wavs, sr = mdl.generate_voice_design(text=text, language=language, instruct=instructions or "Natural clear voice")
    audio = wavs[0] if isinstance(wavs, (list, tuple)) else wavs
    return {"audioBase64": _pcm_to_wav_base64(audio, sr), "sampleRate": int(sr)}


def handle_stt(req, cache):
    weights_dir = req["weightsDir"]
    audio_b64 = req.get("audioBase64", "")
    language = str(req.get("language") or "Russian")
    raw = base64.b64decode(audio_b64)
    key = ("stt", weights_dir)
    if key not in cache:
        loader = None
        try:
            from qwen_asr import Qwen3ASRModel
            device, dtype = _best_device_and_dtype()
            loader = ("qwen_asr", Qwen3ASRModel.from_pretrained(weights_dir, dtype=dtype, device_map=device))
        except Exception as e_qwen:
            try:
                from transformers import pipeline
                device, dtype = _best_device_and_dtype()
                loader = ("hf_asr", pipeline("automatic-speech-recognition", model=weights_dir, device=0 if device == "cuda" else -1, torch_dtype=dtype))
            except Exception:
                raise RuntimeError(json.dumps(_missing_pkg_error(e_qwen, {
                    "qwen_asr": "qwen-asr",
                    "soundfile": "soundfile",
                })))
        cache[key] = loader
    kind, mdl = cache[key]
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
        tf.write(raw)
        tmp_path = tf.name
    try:
        if kind == "qwen_asr":
            res = mdl.transcribe(audio=tmp_path, language=language)
            txt = res[0].text if isinstance(res, list) and res else getattr(res, "text", str(res))
        else:
            res = mdl(tmp_path)
            txt = res.get("text", "") if isinstance(res, dict) else str(res)
    finally:
        try:
            os.remove(tmp_path)
        except Exception:
            pass
    return {"text": str(txt or "").strip()}


def main():
    models = {}
    mod_cache = {}
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
            if op == "embed":
                t0 = time.time()
                res = handle_embed(req, mod_cache)
                res["durationMs"] = int((time.time() - t0) * 1000)
                print(json.dumps({"id": req_id, "event": "result", "data": res}), flush=True)
                continue
            if op == "rerank":
                t0 = time.time()
                res = handle_rerank(req, mod_cache)
                res["durationMs"] = int((time.time() - t0) * 1000)
                print(json.dumps({"id": req_id, "event": "result", "data": res}), flush=True)
                continue
            if op == "image":
                t0 = time.time()
                res = handle_image(req, mod_cache)
                res["durationMs"] = int((time.time() - t0) * 1000)
                print(json.dumps({"id": req_id, "event": "result", "data": res}), flush=True)
                continue
            if op == "tts":
                t0 = time.time()
                res = handle_tts(req, mod_cache)
                res["durationMs"] = int((time.time() - t0) * 1000)
                print(json.dumps({"id": req_id, "event": "result", "data": res}), flush=True)
                continue
            if op == "stt":
                t0 = time.time()
                res = handle_stt(req, mod_cache)
                res["durationMs"] = int((time.time() - t0) * 1000)
                print(json.dumps({"id": req_id, "event": "result", "data": res}), flush=True)
                continue

            weights_dir = req["weightsDir"]
            prompt_ids = req["inputIds"]
            max_new_tokens = int(req.get("maxNewTokens", 384))
            temperature = float(req.get("temperature", 0.6))
            eos_ids = req.get("eosTokenIds", [151645, 151643])

            if weights_dir not in models:
                models[weights_dir] = LocalCausalLM(weights_dir)

            models[weights_dir].generate_stream(
                req_id=req_id,
                prompt_ids=prompt_ids,
                max_new_tokens=max_new_tokens,
                temperature=temperature,
                eos_ids=eos_ids,
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
