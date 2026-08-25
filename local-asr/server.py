from __future__ import annotations

import asyncio
import io
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import numpy as np
import soundfile as sf
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from scipy.signal import resample_poly


HOME = Path(os.environ.get("WEAVE_ASR_HOME", Path.home() / "AppData" / "Local" / "WeaveASR"))
MODEL_ROOT = Path(os.environ.get("WEAVE_ASR_MODEL_ROOT", HOME / "models"))
OPENVINO_MODEL = Path(
    os.environ.get("WEAVE_ASR_OPENVINO_MODEL", MODEL_ROOT / "openvino-whisper-base-int8")
)
OPENVINO_MODEL_FP16 = Path(
    os.environ.get("WEAVE_ASR_OPENVINO_MODEL_FP16", MODEL_ROOT / "openvino-whisper-base-fp16")
)
FASTER_WHISPER_SMALL = Path(
    os.environ.get("WEAVE_ASR_FASTER_WHISPER_SMALL", MODEL_ROOT / "faster-whisper-small")
)
OV_CACHE = Path(os.environ.get("WEAVE_ASR_OV_CACHE", HOME / "cache" / "openvino"))
ENABLE_NPU = os.environ.get("WEAVE_ASR_ENABLE_NPU", "0") == "1"
DEFAULT_MODEL = os.environ.get("WEAVE_ASR_DEFAULT_MODEL", "faster-whisper-small-cuda").strip()
MAX_UPLOAD_BYTES = int(os.environ.get("WEAVE_ASR_MAX_UPLOAD_BYTES", str(512 * 1024 * 1024)))
QWEN3_ASR_17B = os.environ.get("WEAVE_ASR_QWEN3_ASR_17B", "Qwen/Qwen3-ASR-1.7B")
QWEN3_ASR_06B = os.environ.get("WEAVE_ASR_QWEN3_ASR_06B", "Qwen/Qwen3-ASR-0.6B")
QWEN3_ALIGNER = os.environ.get(
    "WEAVE_ASR_QWEN3_ALIGNER", "Qwen/Qwen3-ForcedAligner-0.6B"
)
QWEN_DEFAULT_COMPAT_ALIASES = {
    item.strip()
    for item in os.environ.get(
        "WEAVE_ASR_QWEN_DEFAULT_COMPAT_ALIASES",
        "faster-whisper-small-cuda,openvino-whisper-base-int8-gpu",
    ).split(",")
    if item.strip()
}


@dataclass(frozen=True)
class ModelSpec:
    id: str
    backend: Literal["openvino", "faster-whisper", "qwen3-asr"]
    device: str
    model_name: str
    compute_type: str = ""
    description: str = ""


_MODEL_LIST = [
    ModelSpec(
        "qwen3-asr-1.7b-cuda",
        "qwen3-asr",
        "cuda:0",
        QWEN3_ASR_17B,
        "bfloat16",
        "Qwen3-ASR 1.7B with forced alignment; quality local default",
    ),
    ModelSpec(
        "qwen3-asr-0.6b-cuda",
        "qwen3-asr",
        "cuda:0",
        QWEN3_ASR_06B,
        "bfloat16",
        "Qwen3-ASR 0.6B with forced alignment; lower-memory fallback",
    ),
    ModelSpec(
        "faster-whisper-small-cuda",
        "faster-whisper",
        "cuda",
        "small",
        "float16",
        "RTX CUDA, balanced local default",
    ),
    ModelSpec(
        "openvino-whisper-base-int8-gpu",
        "openvino",
        "GPU.0",
        "whisper-base-int8",
        description="Intel integrated GPU",
    ),
    ModelSpec(
        "openvino-whisper-base-int8-cpu",
        "openvino",
        "CPU",
        "whisper-base-int8",
        description="Intel CPU fallback",
    ),
]
if ENABLE_NPU:
    _MODEL_LIST.append(
        ModelSpec(
            "openvino-whisper-base-fp16-npu",
            "openvino",
            "NPU",
            "whisper-base-fp16",
            description="Intel AI Boost experimental mode; validate output before use",
        )
    )

MODEL_SPECS = {
    spec.id: spec
    for spec in _MODEL_LIST
}
if DEFAULT_MODEL not in MODEL_SPECS:
    raise RuntimeError(
        f"Unknown WEAVE_ASR_DEFAULT_MODEL '{DEFAULT_MODEL}'. "
        f"Available models: {', '.join(MODEL_SPECS)}"
    )


app = FastAPI(title="Weave Local ASR", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[],
    allow_origin_regex=r"^chrome-extension://[a-p]{32}$",
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

_pipelines: dict[str, Any] = {}
_load_locks: dict[str, asyncio.Lock] = {}
_inference_locks: dict[str, asyncio.Lock] = {}
_dll_handles: list[Any] = []


def _resolve_model_spec(requested_model: str) -> ModelSpec | None:
    """Redirect known former defaults when this service defaults to Qwen3-ASR."""

    if DEFAULT_MODEL.startswith("qwen3-asr-") and requested_model in QWEN_DEFAULT_COMPAT_ALIASES:
        return MODEL_SPECS.get(DEFAULT_MODEL)
    return MODEL_SPECS.get(requested_model)


def _available_openvino_devices() -> list[str]:
    try:
        import openvino as ov

        return list(ov.Core().available_devices)
    except Exception:
        return []


def _add_nvidia_dll_directories() -> None:
    if os.name != "nt" or not hasattr(os, "add_dll_directory"):
        return
    site_packages = Path(sys.prefix) / "Lib" / "site-packages"
    candidates = (
        site_packages / "nvidia" / "cudnn" / "bin",
        site_packages / "nvidia" / "cublas" / "bin",
        Path(os.environ.get("CUDA_PATH", "")) / "bin" if os.environ.get("CUDA_PATH") else None,
    )
    for candidate in candidates:
        if candidate and candidate.is_dir():
            _dll_handles.append(os.add_dll_directory(str(candidate)))


def _decode_audio(payload: bytes) -> tuple[np.ndarray, float]:
    try:
        audio, sample_rate = sf.read(io.BytesIO(payload), dtype="float32", always_2d=True)
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"Unsupported audio payload: {error}") from error
    if audio.size == 0:
        raise HTTPException(status_code=400, detail="Audio payload is empty.")
    mono = audio.mean(axis=1)
    if sample_rate != 16_000:
        divisor = int(np.gcd(sample_rate, 16_000))
        mono = resample_poly(mono, 16_000 // divisor, sample_rate // divisor).astype(np.float32)
    mono = np.clip(mono, -1.0, 1.0).astype(np.float32, copy=False)
    return mono, len(mono) / 16_000


def _language_token(language: str | None) -> str | None:
    normalized = (language or "").strip().lower().replace("_", "-")
    if not normalized or normalized in {"auto", "und"}:
        return None
    aliases = {"zh-cn": "zh", "zh-tw": "zh", "en-us": "en", "en-gb": "en"}
    code = aliases.get(normalized, normalized.split("-", 1)[0])
    return f"<|{code}|>"


def _qwen_language(language: str | None) -> str | None:
    """Map common API language hints to Qwen3-ASR's canonical names."""

    normalized = (language or "").strip().lower().replace("_", "-")
    if not normalized or normalized in {"auto", "und"}:
        return None
    aliases = {
        "zh": "Chinese",
        "zh-cn": "Chinese",
        "zh-tw": "Chinese",
        "cmn": "Chinese",
        "yue": "Cantonese",
        "en": "English",
        "en-us": "English",
        "en-gb": "English",
    }
    return aliases.get(normalized, normalized.split("-", 1)[0])


def _load_pipeline_sync(spec: ModelSpec) -> Any:
    if spec.backend == "qwen3-asr":
        import torch
        from qwen_asr import Qwen3ASRModel

        if not torch.cuda.is_available():
            raise RuntimeError("Qwen3-ASR CUDA backend requested but CUDA is unavailable.")
        return Qwen3ASRModel.from_pretrained(
            spec.model_name,
            dtype=torch.bfloat16,
            device_map=spec.device,
            max_inference_batch_size=1,
            max_new_tokens=4096,
            forced_aligner=QWEN3_ALIGNER,
            forced_aligner_kwargs={
                "dtype": torch.bfloat16,
                "device_map": spec.device,
            },
        )

    if spec.backend == "openvino":
        model_path = OPENVINO_MODEL_FP16 if spec.model_name.endswith("fp16") else OPENVINO_MODEL
        if not model_path.joinpath("openvino_encoder_model.xml").exists():
            raise RuntimeError(f"OpenVINO model is not installed at {model_path}")
        available = _available_openvino_devices()
        if spec.device not in available:
            raise RuntimeError(f"OpenVINO device {spec.device} is unavailable; detected: {available}")
        import openvino_genai

        OV_CACHE.mkdir(parents=True, exist_ok=True)
        return openvino_genai.WhisperPipeline(
            model_path,
            spec.device,
            CACHE_DIR=str(OV_CACHE / spec.device.lower()),
        )

    _add_nvidia_dll_directories()
    from faster_whisper import WhisperModel

    if not FASTER_WHISPER_SMALL.joinpath("model.bin").exists():
        raise RuntimeError(f"faster-whisper model is not installed at {FASTER_WHISPER_SMALL}")
    return WhisperModel(
        str(FASTER_WHISPER_SMALL),
        device=spec.device,
        compute_type=spec.compute_type,
    )


async def _get_pipeline(spec: ModelSpec) -> Any:
    if spec.id in _pipelines:
        return _pipelines[spec.id]
    lock = _load_locks.setdefault(spec.id, asyncio.Lock())
    async with lock:
        if spec.id not in _pipelines:
            _pipelines[spec.id] = await asyncio.to_thread(_load_pipeline_sync, spec)
    return _pipelines[spec.id]


def _openvino_transcribe(
    pipeline: Any,
    audio: np.ndarray,
    language: str | None,
    prompt: str,
) -> tuple[str, list[dict[str, Any]], str | None]:
    options: dict[str, Any] = {
        "max_new_tokens": 448,
        "task": "transcribe",
        "return_timestamps": True,
    }
    token = _language_token(language)
    if token:
        options["language"] = token
    if prompt.strip():
        options["initial_prompt"] = prompt.strip()[:1000]
    result = pipeline.generate(audio.tolist(), **options)
    result_texts = getattr(result, "texts", None)
    if result_texts:
        text = str(result_texts[0]).strip()
    elif hasattr(result, "text"):
        text = str(result.text).strip()
    else:
        text = str(result).strip()
    segments: list[dict[str, Any]] = []
    for index, chunk in enumerate(getattr(result, "chunks", None) or []):
        chunk_text = str(getattr(chunk, "text", "")).strip()
        segments.append(
            {
                "id": index,
                "start": float(getattr(chunk, "start_ts", 0.0)),
                "end": float(getattr(chunk, "end_ts", 0.0)),
                "text": chunk_text,
            }
        )
    return text, segments, language


def _faster_whisper_transcribe(
    pipeline: Any,
    audio: np.ndarray,
    language: str | None,
    prompt: str,
) -> tuple[str, list[dict[str, Any]], str | None]:
    normalized_language = (language or "").strip().lower()
    segments_iter, info = pipeline.transcribe(
        audio,
        language=None if normalized_language in {"", "auto", "und"} else normalized_language.split("-", 1)[0],
        initial_prompt=prompt.strip()[:1000] or None,
        beam_size=5,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 250},
        word_timestamps=False,
    )
    duration = len(audio) / 16_000
    segments = [
        {
            "id": index,
            "start": min(duration, max(0.0, float(segment.start))),
            "end": min(duration, max(float(segment.start), float(segment.end))),
            "text": segment.text.strip(),
        }
        for index, segment in enumerate(segments_iter)
        if segment.text.strip()
    ]
    text = " ".join(segment["text"] for segment in segments).strip()
    return text, segments, getattr(info, "language", None)


def _timestamp_seconds(value: Any, *, duration: float) -> float:
    """Normalize aligner timestamp scalars, tolerating seconds or milliseconds."""

    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    if number > max(60.0, duration * 10.0):
        number /= 1000.0
    return min(duration, max(0.0, number))


def _qwen3_transcribe(
    pipeline: Any,
    audio: np.ndarray,
    language: str | None,
    prompt: str,
) -> tuple[str, list[dict[str, Any]], str | None]:
    duration = len(audio) / 16_000
    kwargs: dict[str, Any] = {
        "audio": (audio, 16_000),
        "language": _qwen_language(language),
        "return_time_stamps": True,
    }
    if prompt.strip():
        kwargs["context"] = prompt.strip()[:4_000]
    results = pipeline.transcribe(**kwargs)
    if not results:
        return "", [], language
    result = results[0]
    text = str(getattr(result, "text", "") or "").strip()
    detected_language = str(getattr(result, "language", "") or "").strip() or language
    segments: list[dict[str, Any]] = []
    for index, stamp in enumerate(getattr(result, "time_stamps", None) or []):
        start = _timestamp_seconds(getattr(stamp, "start_time", 0.0), duration=duration)
        end = _timestamp_seconds(getattr(stamp, "end_time", start), duration=duration)
        segments.append(
            {
                "id": index,
                "start": start,
                "end": max(start, end),
                "text": str(getattr(stamp, "text", "") or "").strip(),
            }
        )
    if text and not segments:
        segments = [{"id": 0, "start": 0.0, "end": duration, "text": text}]
    return text, segments, detected_language


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": app.title,
        "version": app.version,
        "openvino_devices": _available_openvino_devices(),
        "default_model": DEFAULT_MODEL,
        "loaded_models": sorted(_pipelines),
        "models": [spec.id for spec in MODEL_SPECS.values()],
    }


@app.get("/v1/models")
async def models() -> dict[str, Any]:
    return {
        "object": "list",
        "data": [
            {
                "id": spec.id,
                "object": "model",
                "owned_by": "local",
                "backend": spec.backend,
                "device": spec.device,
                "description": spec.description,
            }
            for spec in MODEL_SPECS.values()
        ],
    }


@app.post("/v1/audio/transcriptions", response_model=None)
async def transcriptions(
    file: UploadFile = File(...),
    model: str = Form(DEFAULT_MODEL),
    language: str | None = Form(None),
    response_format: str = Form("verbose_json"),
    prompt: str = Form(""),
) -> Response:
    spec = _resolve_model_spec(model)
    if spec is None:
        raise HTTPException(status_code=400, detail=f"Unknown model '{model}'. Use GET /v1/models.")
    if response_format not in {"verbose_json", "json", "text"}:
        raise HTTPException(status_code=400, detail="response_format must be verbose_json, json, or text.")
    payload = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(payload) > MAX_UPLOAD_BYTES:
        limit_mib = MAX_UPLOAD_BYTES / (1024 * 1024)
        raise HTTPException(
            status_code=413,
            detail=f"Audio payload exceeds the {limit_mib:g} MiB local safety limit.",
        )
    audio, duration = await asyncio.to_thread(_decode_audio, payload)
    pipeline = await _get_pipeline(spec)
    inference_lock = _inference_locks.setdefault(spec.id, asyncio.Lock())
    started = time.perf_counter()
    async with inference_lock:
        try:
            if spec.backend == "qwen3-asr":
                text, segments, detected_language = await asyncio.to_thread(
                    _qwen3_transcribe, pipeline, audio, language, prompt
                )
            elif spec.backend == "openvino":
                text, segments, detected_language = await asyncio.to_thread(
                    _openvino_transcribe, pipeline, audio, language, prompt
                )
            else:
                text, segments, detected_language = await asyncio.to_thread(
                    _faster_whisper_transcribe, pipeline, audio, language, prompt
                )
        except HTTPException:
            raise
        except Exception as error:
            raise HTTPException(status_code=500, detail=f"{spec.id} transcription failed: {error}") from error
    processing_ms = round((time.perf_counter() - started) * 1000, 1)
    if response_format == "text":
        return PlainTextResponse(text)
    if response_format == "json":
        return JSONResponse({"text": text})
    return JSONResponse(
        {
            "task": "transcribe",
            "language": detected_language or language or "auto",
            "duration": round(duration, 3),
            "text": text,
            "segments": segments,
            "model": spec.id,
            "backend": spec.backend,
            "device": spec.device,
            "processing_ms": processing_ms,
        }
    )
