import io

import edge_tts
from fastapi import FastAPI
from fastapi.responses import Response
from pydantic import BaseModel

app = FastAPI(title="BP Learning TTS")

VOICES = {"fr-FR-DeniseNeural", "ar-MA-MounaNeural"}
DEFAULT_VOICE = "fr-FR-DeniseNeural"
MAX_TEXT = 1500


class TTSRequest(BaseModel):
    text: str
    voice: str = DEFAULT_VOICE


@app.get("/health")
async def health():
    return {"ok": True, "service": "bp-learning-tts"}


@app.post("/tts")
async def tts(req: TTSRequest):
    text = req.text.strip()[:MAX_TEXT]
    if not text:
        return Response(content=b"", status_code=400)
    voice = req.voice if req.voice in VOICES else DEFAULT_VOICE
    try:
        communicate = edge_tts.Communicate(text, voice)
        buffer = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk.get("type") == "audio":
                buffer.write(chunk.get("data", b""))
        audio = buffer.getvalue()
    except Exception:
        return Response(content=b"", status_code=502)
    if not audio:
        return Response(content=b"", status_code=502)
    return Response(content=audio, media_type="audio/mpeg")
