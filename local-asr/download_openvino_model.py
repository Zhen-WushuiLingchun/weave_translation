from __future__ import annotations

import os
from pathlib import Path

from huggingface_hub import snapshot_download


home = Path(os.environ.get("WEAVE_ASR_HOME", Path.home() / "AppData" / "Local" / "WeaveASR"))
model_root = Path(os.environ.get("WEAVE_ASR_MODEL_ROOT", home / "models"))
downloads = (
    ("OpenVINO/whisper-base-int8-ov", model_root / "openvino-whisper-base-int8"),
    ("OpenVINO/whisper-base-fp16-ov", model_root / "openvino-whisper-base-fp16"),
    ("Systran/faster-whisper-small", model_root / "faster-whisper-small"),
)

for repo_id, target in downloads:
    target.mkdir(parents=True, exist_ok=True)
    options = {"cache_dir": model_root / "huggingface"} if repo_id.startswith("Systran/") else {}
    path = snapshot_download(repo_id=repo_id, local_dir=target, revision="main", **options)
    print(f"{repo_id} -> {path}")
