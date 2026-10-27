#!/usr/bin/env python3
"""
Постоянный процесс нейросетевого инференса локальных моделей (.safetensors) на базе PyTorch (zero-copy mmap + KV-Cache).
Поддерживает архитектуры Qwen3, Qwen2.5, Llama-3, DeepSeek-R1-Distill, Gemma, Mistral (включая многофайловые шарды).
Общается с Node.js-сервером WORK по протоколу JSONL (stdin -> stdout), удерживая веса модели в памяти между запросами.
"""
import glob
import json
import mmap
import os
import struct
import sys
import warnings

warnings.filterwarnings("ignore")

import torch
import torch.nn.functional as F

torch.set_num_threads(max(1, (os.cpu_count() or 4) // 2))

DTYPE_MAP = {
    "BF16": torch.bfloat16,
    "F16": torch.float16,
    "F32": torch.float32,
    "I64": torch.int64,
    "I32": torch.int32,
}


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

    @torch.inference_mode()
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

    @torch.inference_mode()
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


def main():
    models = {}
    print(json.dumps({"event": "ready"}), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id = ""
        try:
            req = json.loads(line)
            req_id = req.get("id", "")
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
            print(json.dumps({"id": req_id, "event": "error", "error": str(e)}), flush=True)


if __name__ == "__main__":
    main()
