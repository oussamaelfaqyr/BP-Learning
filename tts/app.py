import io
import re

import edge_tts
from fastapi import FastAPI
from fastapi.responses import Response
from pydantic import BaseModel

app = FastAPI(title="BP Learning TTS")

VOICES = {
    "fr-FR-VivienneMultilingualNeural",
    "fr-FR-RemyMultilingualNeural",
    "fr-FR-DeniseNeural",
    "ar-MA-MounaNeural",
    "ar-MA-JamalNeural",
}
DEFAULT_VOICE = "fr-FR-VivienneMultilingualNeural"
MAX_TEXT = 1500


class TTSRequest(BaseModel):
    text: str
    voice: str = DEFAULT_VOICE
    rate: str = "-4%"
    pitch: str = "+0Hz"


@app.get("/health")
async def health():
    return {"ok": True, "service": "bp-learning-tts"}


@app.post("/tts")
async def tts(req: TTSRequest):
    text = req.text.strip()[:MAX_TEXT]
    if not text:
        return Response(content=b"", status_code=400)
    
    # Auto-detect Arabic characters to route to Moroccan Arabic voice if voice is a French default
    voice = req.voice
    if voice == "fr-FR-DeniseNeural" or voice == "fr-FR-VivienneMultilingualNeural":
        if re.search(r"[\u0600-\u06FF]", text):
            voice = "ar-MA-MounaNeural"

    if voice not in VOICES:
        voice = DEFAULT_VOICE
    try:
        communicate = edge_tts.Communicate(
            text,
            voice,
            rate=req.rate,
            pitch=req.pitch
        )
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
