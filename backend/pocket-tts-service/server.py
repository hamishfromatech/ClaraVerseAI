"""
Pocket-TTS Service
A Python-based text-to-speech service using Kyutai's pocket-tts
"""
import os
import logging
from typing import Optional
from datetime import datetime

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import uvicorn
import numpy as np
import torch

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = FastAPI(title="Pocket-TTS Service")

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration
PORT = int(os.getenv("PORT", "3006"))
DEFAULT_HF_TOKEN = os.getenv("HF_TOKEN")
MODELS_DIR = "/app/models"
CUSTOM_VOICES_DIR = "/app/custom_voices"
os.makedirs(CUSTOM_VOICES_DIR, exist_ok=True)
DEFAULT_VOICE = "alba"

# Available built-in voices with HuggingFace URLs
AVAILABLE_VOICES = [
    {"id": "alba", "name": "Alba", "description": "Female voice, casual tone", "url": "hf://kyutai/tts-voices/alba-mackenna/casual.wav"},
    {"id": "marius", "name": "Marius", "description": "Male voice, casual tone", "url": "hf://kyutai/tts-voices/marius-pontmercy/casual.wav"},
    {"id": "javert", "name": "Javert", "description": "Male voice, serious tone", "url": "hf://kyutai/tts-voices/javert-serious.wav"},
    {"id": "jean", "name": "Jean", "description": "Male voice, warm tone", "url": "hf://kyutai/tts-voices/jean-valjean-warm.wav"},
    {"id": "fantine", "name": "Fantine", "description": "Female voice, gentle tone", "url": "hf://kyutai/tts-voices/fantine-gentle.wav"},
    {"id": "cosette", "name": "Cosette", "description": "Female voice, youthful tone", "url": "hf://kyutai/tts-voices/cosette-youthful.wav"},
    {"id": "eponine", "name": "Eponine", "description": "Female voice, expressive tone", "url": "hf://kyutai/tts-voices/eponine-expressive.wav"},
    {"id": "azelma", "name": "Azelma", "description": "Female voice, soft tone", "url": "hf://kyutai/tts-voices/azelma-soft.wav"},
]

# Model cache - pocket-tts loads models lazily
from pocket_tts import TTSModel
from huggingface_hub import login as hf_login

# Global model instance
_model_instance: Optional[TTSModel] = None

# Voice state cache for built-in voices
_voice_state_cache: dict[str, dict] = {}

# Whether HF token has been set
_hf_token_set = False


def get_model(hf_token: Optional[str] = None) -> TTSModel:
    """Get or create the pocket-tts model instance (cached)."""
    global _model_instance, _hf_token_set

    if _model_instance is not None:
        return _model_instance

    # Set HF token if provided (must be done before loading model)
    if hf_token and not _hf_token_set:
        try:
            hf_login(token=hf_token)
            _hf_token_set = True
            logger.info("HuggingFace token set successfully for model loading")
        except Exception as e:
            logger.warning(f"Failed to set HuggingFace token: {e}")

    logger.info("Loading pocket-tts model...")

    try:
        _model_instance = TTSModel.load_model(
            variant="b6369a24",
            temp=0.7,
            lsd_decode_steps=1,
            noise_clamp=None,
            eos_threshold=-4.0
        )
        logger.info(f"Pocket-TTS model loaded successfully (sample_rate: {_model_instance.sample_rate} Hz)")
        return _model_instance
    except Exception as e:
        logger.error(f"Failed to load pocket-tts model: {e}")
        raise


def get_voice_state(voice: str = DEFAULT_VOICE, hf_token: Optional[str] = None) -> dict:
    """
    Get voice state for a built-in voice.

    Args:
        voice: Voice name from AVAILABLE_VOICES
        hf_token: Optional HuggingFace token for gated models

    Returns:
        Model state for the voice
    """
    # Set HF token if provided
    global _hf_token_set
    if hf_token and not _hf_token_set:
        try:
            hf_login(token=hf_token)
            _hf_token_set = True
            logger.info("HuggingFace token set successfully")
        except Exception as e:
            logger.warning(f"Failed to set HuggingFace token: {e}")

    # Check cache first
    if voice in _voice_state_cache:
        return _voice_state_cache[voice]

    # Find voice URL
    voice_data = next((v for v in AVAILABLE_VOICES if v["id"] == voice), None)
    if not voice_data:
        logger.warning(f"Voice '{voice}' not available, using '{DEFAULT_VOICE}'")
        voice_data = next((v for v in AVAILABLE_VOICES if v["id"] == DEFAULT_VOICE), None)

    try:
        model = get_model(hf_token=hf_token)
        # Use HuggingFace URL for built-in voice
        voice_state = model.get_state_for_audio_prompt(voice_data["url"], truncate=False)
        logger.info(f"Voice state loaded for '{voice}' from {voice_data['url']}")
        # Cache the voice state
        _voice_state_cache[voice] = voice_state
        return voice_state
    except Exception as e:
        logger.error(f"Failed to load voice state for '{voice}': {e}")
        raise


class TTSRequest(BaseModel):
    text: str
    voice: Optional[str] = None  # Built-in voice name (alba, marius, etc.)
    custom_voice_id: Optional[str] = None  # ID of custom uploaded voice
    hf_token: Optional[str] = None  # HuggingFace token for gated models (defaults to HF_TOKEN env var)


class HealthResponse(BaseModel):
    status: str
    service: str
    model_loaded: bool
    sample_rate: Optional[int] = None
    available_voices: list[dict]


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    return HealthResponse(
        status="ok",
        service="pocket-tts",
        model_loaded=_model_instance is not None,
        sample_rate=_model_instance.sample_rate if _model_instance else None,
        available_voices=AVAILABLE_VOICES
    )


@app.get("/voices")
async def list_voices():
    """
    List available built-in voices and custom uploaded voices.

    Returns:
        Dictionary with built-in voices and custom voices
    """
    # List custom voices from directory
    custom_voices = []
    for filename in os.listdir(CUSTOM_VOICES_DIR):
        if filename.endswith(('.wav', '.mp3', '.flac', '.m4a')):
            custom_voices.append({
                "id": f"custom_{filename}",
                "name": filename,
                "description": "Custom uploaded voice",
                "is_custom": True
            })

    return {
        "built_in": AVAILABLE_VOICES,
        "custom": custom_voices
    }


@app.post("/tts")
async def text_to_speech(request: TTSRequest):
    """
    Convert text to speech with streaming.

    Args:
        request: TTSRequest with text and optional voice

    Returns:
        Streamed WAV audio file (chunks generated as they're ready)
    """
    # Validate text
    if not request.text or not request.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    # Limit text length to prevent excessive generation
    if len(request.text) > 10000:
        raise HTTPException(status_code=400, detail="Text is too long (max 10000 characters)")

    try:
        logger.info(f"Generating speech (streaming) for {len(request.text)} characters with voice: {request.voice or DEFAULT_VOICE}")

        # Use HF token from request or fall back to environment variable
        hf_token = request.hf_token or DEFAULT_HF_TOKEN

        model = get_model(hf_token=hf_token)

        # Get voice state
        voice_state = None
        voice_to_use = request.voice or DEFAULT_VOICE

        # Check if it's a custom voice (starts with "custom_")
        if request.custom_voice_id:
            # Custom voice handling - extract filename from custom_voice_id
            custom_voice_filename = request.custom_voice_id.replace("custom_", "")
            custom_voice_path = os.path.join(CUSTOM_VOICES_DIR, custom_voice_filename)

            if not os.path.exists(custom_voice_path):
                raise HTTPException(status_code=404, detail=f"Custom voice file not found: {custom_voice_filename}")

            logger.info(f"Using custom voice: {custom_voice_path}")
            voice_state = model.get_state_for_audio_prompt(custom_voice_path, truncate=False)
        else:
            # Use built-in voice
            voice_state = get_voice_state(voice_to_use, hf_token=hf_token)

        # Generate audio using streaming
        sample_rate = model.sample_rate
        byte_depth = 2  # 16-bit
        bytes_per_second = sample_rate * byte_depth

        # Keep track of total samples for WAV header
        total_samples = 0

        import struct

        # Collect chunks first to calculate proper WAV header
        # This is necessary because WAV format requires the total size in the header
        # For true streaming without header, we would need to use a different format
        audio_chunks = []

        for chunk in model.generate_audio_stream(
            voice_state,
            request.text,
            frames_after_eos=2,
            copy_state=True
        ):
            # Convert chunk to int16
            chunk_array = chunk.cpu().numpy()
            chunk_samples = len(chunk_array)
            total_samples += chunk_samples

            # Normalize to [-1, 1] range first if needed
            if chunk_array.dtype != np.int16:
                chunk_normalized = np.clip(chunk_array, -1.0, 1.0)
                chunk_int16 = (chunk_normalized * 32767).astype(np.int16)
            else:
                chunk_int16 = chunk_array

            audio_chunks.append(chunk_int16)

        # Concatenate all chunks and convert to bytes
        full_audio = np.concatenate(audio_chunks)
        data_size = len(full_audio) * byte_depth
        final_total_size = 36 + data_size

        logger.info(f"Generated audio: {total_samples} samples ({total_samples/sample_rate:.2f} seconds)")

        # Create WAV file in memory with streaming
        def generate_wav():
            # Write WAV header
            yield b"RIFF"
            yield struct.pack("<I", final_total_size)
            yield b"WAVE"
            yield b"fmt "
            yield struct.pack("<I", 16)  # PCM chunk size
            yield struct.pack("<H", 1)   # Audio format (PCM)
            yield struct.pack("<H", 1)   # Number of channels (mono)
            yield struct.pack("<I", sample_rate)
            yield struct.pack("<I", bytes_per_second)
            yield struct.pack("<H", 2)   # Block align
            yield struct.pack("<H", 16)  # Bits per sample
            yield b"data"
            yield struct.pack("<I", data_size)

            # Write audio data in chunks for streaming
            for chunk in audio_chunks:
                yield chunk.tobytes()

        return StreamingResponse(
            generate_wav(),
            media_type="audio/wav",
            headers={
                "Content-Disposition": f'attachment; filename="tts_{datetime.now().strftime("%Y%m%d_%H%M%S")}.wav"',
                "X-Sample-Rate": str(sample_rate),
                "X-Duration": str(total_samples / sample_rate),
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"TTS generation error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"TTS generation failed: {str(e)}")


@app.post("/voices/upload")
async def upload_custom_voice(file: UploadFile = File(...)):
    """
    Upload a custom voice audio file for voice cloning.

    Args:
        file: Audio file (WAV, MP3, FLAC, M4A)

    Returns:
        Custom voice ID
    """
    # Validate file type
    allowed_extensions = ['.wav', '.mp3', '.flac', '.m4a']
    file_ext = os.path.splitext(file.filename)[1].lower()

    if file_ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type. Allowed: {', '.join(allowed_extensions)}"
        )

    # Validate file size (max 10MB)
    file_size = 0
    chunk_size = 8192
    while chunk := await file.read(chunk_size):
        file_size += len(chunk)
        if file_size > 10 * 1024 * 1024:  # 10MB
            raise HTTPException(status_code=400, detail="File too large (max 10MB)")
    await file.seek(0)  # Reset file pointer

    try:
        # Save the file
        safe_filename = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{file.filename}"
        file_path = os.path.join(CUSTOM_VOICES_DIR, safe_filename)

        with open(file_path, "wb") as f:
            content = await file.read()
            f.write(content)

        logger.info(f"Custom voice uploaded: {safe_filename} ({file_size} bytes)")

        return {
            "id": f"custom_{safe_filename}",
            "name": safe_filename,
            "description": "Custom uploaded voice",
            "is_custom": True,
            "size": file_size
        }

    except Exception as e:
        logger.error(f"Failed to upload custom voice: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to upload voice file: {str(e)}")


@app.delete("/voices/{voice_id}")
async def delete_custom_voice(voice_id: str):
    """
    Delete a custom voice audio file.

    Args:
        voice_id: ID of the custom voice to delete

    Returns:
        Success message
    """
    if not voice_id.startswith("custom_"):
        raise HTTPException(status_code=400, detail="Can only delete custom voices")

    custom_voice_filename = voice_id.replace("custom_", "")
    custom_voice_path = os.path.join(CUSTOM_VOICES_DIR, custom_voice_filename)

    if not os.path.exists(custom_voice_path):
        raise HTTPException(status_code=404, detail="Custom voice not found")

    try:
        os.remove(custom_voice_path)
        logger.info(f"Custom voice deleted: {custom_voice_filename}")

        return {"message": "Voice deleted successfully"}

    except Exception as e:
        logger.error(f"Failed to delete custom voice: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete voice: {str(e)}")


if __name__ == "__main__":
    logger.info("Starting Pocket-TTS Service...")
    # Model will be loaded on first request with HF token for authentication
    logger.info("Pocket-TTS service ready (model will load on first request)")
    uvicorn.run(app, host="0.0.0.0", port=PORT)