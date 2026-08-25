from __future__ import annotations

from types import SimpleNamespace

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


def test_release_pipeline_removes_cached_model(monkeypatch) -> None:
    marker = object()
    server._pipelines["qwen3-asr-1.7b-cuda"] = marker
    monkeypatch.setattr(server, "DEFAULT_MODEL", "qwen3-asr-1.7b-cuda")

    import asyncio

    result = asyncio.run(server.unload())

    assert result == {"status": "ok", "model": "qwen3-asr-1.7b-cuda", "unloaded": True}
    assert "qwen3-asr-1.7b-cuda" not in server._pipelines
