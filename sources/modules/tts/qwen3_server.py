"""
Qwen3-TTS — локальный сервер синтеза речи.
Модель: Qwen/Qwen3-TTS-12Hz-0.6B-Base
Порт: 8002
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.responses import Response
from pydantic import BaseModel
from transformers import AutoConfig, AutoModel, AutoProcessor
import torch
import numpy as np
import io
import scipy.io.wavfile as wavfile
import os

MODEL_NAME = "Qwen/Qwen3-TTS-12Hz-0.6B-Base"
LOCAL_MODEL_DIR = os.path.join(os.path.dirname(__file__), "qwen3_tts_model")

state = {"model": None, "processor": None}


class TTSRequest(BaseModel):
    text: str
    voice: str = "default"
    speed: float = 1.0


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Загрузка модели при старте
    print("[qwen3] Загрузка модели...")
    model_path = LOCAL_MODEL_DIR if os.path.exists(LOCAL_MODEL_DIR) else MODEL_NAME
    state["processor"] = AutoProcessor.from_pretrained(
        model_path, trust_remote_code=True
    )
    config = AutoConfig.from_pretrained(
        model_path, trust_remote_code=True
    )
    state["model"] = AutoModel.from_pretrained(
        model_path, config=config, trust_remote_code=True
    )
    state["model"].eval()
    print("[qwen3] Модель загружена")
    yield
    state["model"] = None
    state["processor"] = None


app = FastAPI(lifespan=lifespan)


@app.post("/tts")
async def tts(req: TTSRequest):
    model = state["model"]
    processor = state["processor"]
    if model is None or processor is None:
        return Response(content=b"", media_type="audio/wav", status_code=503)

    inputs = processor(
        text=req.text,
        return_tensors="pt",
        sampling_rate=24000,
    )

    with torch.no_grad():
        generated = model.generate(**inputs, max_new_tokens=1024)

    audio_np = generated.cpu().numpy()
    if audio_np.ndim > 1:
        audio_np = audio_np[0]

    if audio_np.dtype != np.float32:
        audio_np = audio_np.astype(np.float32)
    peak = np.max(np.abs(audio_np))
    if peak > 0:
        audio_np = audio_np / peak

    buffer = io.BytesIO()
    wavfile.write(buffer, 24000, audio_np)
    return Response(content=buffer.getvalue(), media_type="audio/wav")


@app.get("/health")
async def health():
    return {"status": "ok", "model_loaded": state["model"] is not None}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002)