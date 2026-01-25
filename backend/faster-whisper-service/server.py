"""
Faster-Whisper STT Service
A Python-based transcription service using faster-whisper (CTranslate2)
"""
import os
import logging
import asyncio
from pathlib import Path
from typing import Optional
from datetime import datetime

from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = FastAPI(title="Faster-Whisper STT Service")

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration
PORT = int(os.getenv("PORT", "3005"))
DEFAULT_MODEL = os.getenv("WHISPER_MODEL", "small")
MODELS_DIR = Path("/app/models")
UPLOADS_DIR = Path("/app/uploads")
MODELS_DIR.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

# Model cache - faster-whisper loads models lazily
from faster_whisper import WhisperModel

# Global model instance
_model_instance: Optional[WhisperModel] = None
_current_model_name: Optional[str] = None

# Available models in faster-whisper
AVAILABLE_MODELS = [
    "tiny", "tiny.en", "base", "base.en",
    "small", "small.en", "medium", "medium.en",
    "large-v1", "large-v2", "large-v3",
    "large"
]

# Language codes mapping (whisper uses 2-letter codes)
LANGUAGE_CODES = {
    "en": "english",
    "es": "spanish",
    "fr": "french",
    "de": "german",
    "it": "italian",
    "pt": "portuguese",
    "ru": "russian",
    "ja": "japanese",
    "ko": "korean",
    "zh": "chinese",
}

def get_model(model_name: str = DEFAULT_MODEL) -> WhisperModel:
    """Get or create the whisper model instance (cached)."""
    global _model_instance, _current_model_name

    # Use cached instance if same model
    if _model_instance is not None and _current_model_name == model_name:
        return _model_instance

    logger.info(f"Loading faster-whisper model: {model_name}")

    # Determine compute type based on available hardware
    compute_type = "float16"
    device = "cuda"

    try:
        import torch
        if not torch.cuda.is_available():
            logger.info("CUDA not available, using CPU")
            compute_type = "int8"
            device = "cpu"
    except ImportError:
        logger.info("PyTorch not available, using CPU")
        compute_type = "int8"
        device = "cpu"

    # Download model to local directory if not present
    model_path = MODELS_DIR / model_name

    try:
        if model_path.exists():
            logger.info(f"Using local model from: {model_path}")
            _model_instance = WhisperModel(
                str(model_path),
                device=device,
                compute_type=compute_type,
            )
        else:
            logger.info(f"Downloading model: {model_name}")
            _model_instance = WhisperModel(
                model_name,
                device=device,
                compute_type=compute_type,
                download_root=str(MODELS_DIR),
            )
            # Create symlink for easier reuse
            if not model_path.exists():
                # Find the actual downloaded path
                downloaded_path = list(MODELS_DIR.glob(f"{model_name}*"))
                if downloaded_path:
                    try:
                        model_path.symlink_to(downloaded_path[0])
                    except OSError:
                        pass  # Windows may not support symlinks

    except Exception as e:
        logger.error(f"Failed to load model {model_name}: {e}")
        raise

    _current_model_name = model_name
    logger.info(f"Model {model_name} loaded successfully")
    return _model_instance


class TranscribeResponse(BaseModel):
    text: str
    language: str


class HealthResponse(BaseModel):
    status: str
    service: str
    model: Optional[str] = None


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    return HealthResponse(
        status="ok",
        service="faster-whisper-stt",
        model=_current_model_name
    )


@app.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(
    file: UploadFile = File(...),
    language: str = Form("en"),
    model: str = Form(DEFAULT_MODEL)
):
    """
    Transcribe an audio file.

    Args:
        file: Audio file to transcribe
        language: Language code (default: 'en')
        model: Model name (default: 'small')

    Returns:
        Transcription text with language
    """
    # Validate model name
    if model not in AVAILABLE_MODELS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid model '{model}'. Available: {', '.join(AVAILABLE_MODELS)}"
        )

    # Create temp file path
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    temp_filename = f"{timestamp}_{file.filename}"
    temp_path = UPLOADS_DIR / temp_filename
    wav_path = UPLOADS_DIR / f"{temp_filename}.wav"

    try:
        # Save uploaded file
        logger.info(f"Received file: {file.filename} ({file.size} bytes)")
        with open(temp_path, "wb") as f:
            content = await file.read()
            f.write(content)

        # Convert to 16kHz mono WAV using ffmpeg
        logger.info("Converting to 16kHz mono WAV...")
        convert_cmd = [
            "ffmpeg",
            "-i", str(temp_path),
            "-ar", "16000",
            "-ac", "1",
            "-c:a", "pcm_s16le",
            "-af", "highpass=f=200,lowpass=f=3000,loudnorm",
            "-y",
            str(wav_path)
        ]
        process = await asyncio.create_subprocess_exec(
            *convert_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await process.communicate()

        if process.returncode != 0:
            error_msg = stderr.decode() if stderr else "Unknown error"
            logger.error(f"FFmpeg conversion failed: {error_msg}")
            raise HTTPException(status_code=500, detail="Failed to process audio format")

        # Check if WAV file was created and has content
        if not wav_path.exists() or wav_path.stat().st_size < 100:
            raise HTTPException(status_code=500, detail="FFmpeg produced empty WAV file")

        logger.info(f"WAV file created: {wav_path.stat().st_size} bytes")

        # Get model and transcribe
        logger.info(f"Transcribing with model '{model}' (language: {language})...")
        whisper_model = get_model(model)

        segments, info = whisper_model.transcribe(
            str(wav_path),
            language=language if language in LANGUAGE_CODES else None,
            beam_size=5,
            vad_filter=True,  # Voice activity detection for better accuracy
            vad_parameters={
                "min_silence_duration_ms": 100,
                "speech_pad_ms": 30
            }
        )

        # Combine all segments
        text_parts = []
        for segment in segments:
            if segment.text.strip():
                text_parts.append(segment.text.strip())

        text = " ".join(text_parts)

        logger.info(f"Transcription complete: {len(text)} characters")

        return TranscribeResponse(text=text, language=language)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Transcription error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")

    finally:
        # Clean up temporary files
        for path in [temp_path, wav_path]:
            if path.exists():
                try:
                    path.unlink()
                except Exception as e:
                    logger.warning(f"Failed to delete temp file {path}: {e}")


if __name__ == "__main__":
    logger.info("Starting Faster-Whisper STT Service...")
    uvicorn.run(app, host="0.0.0.0", port=PORT)