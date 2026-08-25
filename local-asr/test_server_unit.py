from __future__ import annotations

import asyncio
from types import SimpleNamespace
import weakref

import numpy as np
import server


def test_qwen_models_are_exposed_without_removing_legacy_models() -> None:
    assert "qwen3-asr-1.7b-cuda" in server.MODEL_SPECS
    assert "qwen3-asr-0.6b-cuda" in server.MODEL_SPECS
    assert "openvino-whisper-base-int8-gpu" in server.MODEL_SPECS
    assert server.MODEL_SPECS["qwen3-asr-1.7b-cuda"].backend == "qwen3-asr"


def test_qwen_language_mapping_supports_course_languages() -> None:
    assert server._qwen_language(None) is None
    assert server._qwen_language("auto") is None
    assert server._qwen_language("zh-CN") == "Chinese"
    assert server._qwen_language("en-US") == "English"
    assert server._qwen_language("yue") == "Cantonese"


def test_qwen_transcription_maps_context_and_timestamps() -> None:
    captured: dict = {}

    class Pipeline:
        def transcribe(self, **kwargs):
            captured.update(kwargs)
            return [
                SimpleNamespace(
                    language="English",
                    text="Cosmological collider.",
                    time_stamps=[
                        SimpleNamespace(
                            start_time=0.25,
                            end_time=1.75,
                            text="Cosmological collider.",
                        )
                    ],
                )
            ]

    audio = np.zeros(32_000, dtype=np.float32)
    text, segments, language = server._qwen3_transcribe(
        Pipeline(), audio, "en", "Vocabulary: cosmological collider"
    )

    assert text == "Cosmological collider."
    assert language == "English"
    assert captured["language"] == "English"
    assert captured["context"] == "Vocabulary: cosmological collider"
    assert captured["return_time_stamps"] is True
    assert captured["audio"][1] == 16_000
    assert segments == [
        {"id": 0, "start": 0.25, "end": 1.75, "text": "Cosmological collider."}
    ]


def test_qwen_transcription_falls_back_to_whole_audio_segment() -> None:
    class Pipeline:
        def transcribe(self, **kwargs):
            return [SimpleNamespace(language="Chinese", text="测试。", time_stamps=[])]

    text, segments, language = server._qwen3_transcribe(
        Pipeline(), np.zeros(16_000, dtype=np.float32), "zh", ""
    )

    assert text == "测试。"
    assert language == "Chinese"
    assert segments == [{"id": 0, "start": 0.0, "end": 1.0, "text": "测试。"}]


def test_timestamp_normalizer_accepts_milliseconds() -> None:
    assert server._timestamp_seconds(1_500, duration=2.0) == 1.5
    assert server._timestamp_seconds(-1, duration=2.0) == 0.0
    assert server._timestamp_seconds(9, duration=2.0) == 2.0


def test_qwen_default_redirects_former_default_ids(monkeypatch) -> None:
    monkeypatch.setattr(server, "DEFAULT_MODEL", "qwen3-asr-1.7b-cuda")
    assert server._resolve_model_spec("openvino-whisper-base-int8-gpu").id == "qwen3-asr-1.7b-cuda"
    assert server._resolve_model_spec("faster-whisper-small-cuda").id == "qwen3-asr-1.7b-cuda"
    assert server._resolve_model_spec("qwen3-asr-0.6b-cuda").id == "qwen3-asr-0.6b-cuda"


def test_release_pipeline_removes_cached_model_and_last_reference(monkeypatch) -> None:
    class Pipeline:
        pass

    released: list[bool] = []
    monkeypatch.setattr(server, "_release_cuda_cache_sync", lambda: released.append(True))
    server._queued_requests.clear()
    server._active_requests.clear()
    pipeline = Pipeline()
    reference = weakref.ref(pipeline)
    server._pipelines["qwen3-asr-1.7b-cuda"] = pipeline
    del pipeline
    monkeypatch.setattr(server, "DEFAULT_MODEL", "qwen3-asr-1.7b-cuda")

    result = asyncio.run(server.unload())

    assert result == {"status": "ok", "model": "qwen3-asr-1.7b-cuda", "unloaded": True}
    assert "qwen3-asr-1.7b-cuda" not in server._pipelines
    assert reference() is None
    assert released == [True]


def test_safe_unload_does_not_interrupt_queued_or_active_work(monkeypatch) -> None:
    model_id = "qwen3-asr-1.7b-cuda"
    monkeypatch.setattr(server, "DEFAULT_MODEL", model_id)
    server._pipelines[model_id] = object()
    server._queued_requests[model_id] = 1

    result = asyncio.run(server.unload(if_idle=True))

    assert result == {
        "status": "busy",
        "model": model_id,
        "unloaded": False,
        "active_requests": 0,
        "queued_requests": 1,
    }
    assert model_id in server._pipelines
    server._queued_requests.clear()
    server._pipelines.clear()


def test_health_reports_model_lifecycle_without_loading(monkeypatch) -> None:
    model_id = "qwen3-asr-1.7b-cuda"
    monkeypatch.setattr(server, "DEFAULT_MODEL", model_id)
    monkeypatch.setattr(server, "IDLE_UNLOAD_SECONDS", 120.0)
    server._pipelines.clear()
    server._queued_requests.clear()
    server._active_requests.clear()

    payload = asyncio.run(server.health())

    assert payload["loaded_models"] == []
    assert payload["active_requests"] == 0
    assert payload["queued_requests"] == 0
    assert payload["idle_unload_seconds"] == 120.0


def test_pipeline_is_loaded_once_and_reused(monkeypatch) -> None:
    spec = server.MODEL_SPECS["qwen3-asr-1.7b-cuda"]
    server._pipelines.clear()
    server._load_locks.clear()
    loads: list[str] = []
    marker = object()

    def fake_load(requested):
        loads.append(requested.id)
        return marker

    monkeypatch.setattr(server, "_load_pipeline_sync", fake_load)

    async def exercise():
        first = await server._get_pipeline(spec)
        second = await server._get_pipeline(spec)
        return first, second

    first, second = asyncio.run(exercise())

    assert first is marker
    assert second is marker
    assert loads == [spec.id]
    server._pipelines.clear()
