"""
Qwen3-TTS — локальный сервер синтеза речи.
Пакет: qwen-tts (PyPI). Модель: Qwen3-TTS-12Hz-0.6B-CustomVoice.
Порт: 8002
"""
from contextlib import asynccontextmanager
import io
import os

import numpy as np
import scipy.io.wavfile as wavfile
import torch
from fastapi import FastAPI
from fastapi.responses import Response
from pydantic import BaseModel
from qwen_tts import Qwen3TTSModel
from typing import Optional

MODEL_NAME = "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice"
LOCAL_MODEL_DIR = os.path.join(os.path.dirname(__file__), "qwen3_tts_model")

state = {"model": None}


class TTSRequest(BaseModel):
    text: str
    language: str = "Russian"
    speaker: str = "Ryan"
    instruct: Optional[str] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[qwen3] Загрузка модели...")
    model_path = LOCAL_MODEL_DIR if os.path.exists(LOCAL_MODEL_DIR) else MODEL_NAME
    device = "cuda:0" if torch.cuda.is_available() else "cpu"
    dtype = torch.bfloat16 if device.startswith("cuda") else torch.float32
    state["model"] = Qwen3TTSModel.from_pretrained(
        model_path,
        device_map=device,
        dtype=dtype,
    )
    print("[qwen3] Модель загружена:", model_path, "device=", device)
    yield
    state["model"] = None


app = FastAPI(lifespan=lifespan)


@app.post("/tts")
async def tts(req: TTSRequest):
    model = state["model"]
    if model is None:
        return Response(content=b"", media_type="audio/wav", status_code=503)

    text = (req.text or "").strip()
    if not text:
        return Response(content=b"", media_type="audio/wav", status_code=400)

    kwargs = {
        "text": text[:2000],
        "language": req.language or "Russian",
        "speaker": req.speaker or "Ryan",
    }
    if req.instruct:
        kwargs["instruct"] = req.instruct

    wavs, sr = model.generate_custom_voice(**kwargs)
    audio_np = np.asarray(wavs[0] if isinstance(wavs, (list, tuple)) else wavs, dtype=np.float32)
    if audio_np.ndim > 1:
        audio_np = audio_np.reshape(-1)
    peak = float(np.max(np.abs(audio_np))) if audio_np.size else 0.0
    if peak > 1.0:
        audio_np = audio_np / peak

    buffer = io.BytesIO()
    wavfile.write(buffer, int(sr), audio_np)
    return Response(content=buffer.getvalue(), media_type="audio/wav")


@app.get("/health")
async def health():
    return {"status": "ok", "model_loaded": state["model"] is not None}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002)
