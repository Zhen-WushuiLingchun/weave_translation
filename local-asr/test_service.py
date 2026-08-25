from __future__ import annotations

import argparse
import json
import mimetypes
import uuid
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def multipart(audio: Path, model: str, language: str, prompt: str) -> tuple[bytes, str]:
    boundary = f"----weave-{uuid.uuid4().hex}"
    chunks: list[bytes] = []
    for name, value in (
        ("model", model),
        ("language", language),
        ("prompt", prompt),
        ("response_format", "verbose_json"),
    ):
        chunks.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode())
    content_type = mimetypes.guess_type(audio.name)[0] or "audio/wav"
    chunks.append(
        (
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{audio.name}\"\r\n"
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode()
    )
    chunks.append(audio.read_bytes())
    chunks.append(f"\r\n--{boundary}--\r\n".encode())
    return b"".join(chunks), boundary


parser = argparse.ArgumentParser()
parser.add_argument("audio", type=Path)
parser.add_argument("--model", default="qwen3-asr-1.7b-cuda")
parser.add_argument("--url", default="http://127.0.0.1:8765/v1/audio/transcriptions")
parser.add_argument("--language", default="auto")
parser.add_argument("--prompt", default="")
args = parser.parse_args()

payload, boundary = multipart(args.audio, args.model, args.language, args.prompt)
request = Request(args.url, data=payload, method="POST", headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
try:
    with urlopen(request, timeout=600) as response:
        print(json.dumps(json.loads(response.read()), ensure_ascii=False, indent=2))
except HTTPError as error:
    print(error.read().decode("utf-8", errors="replace"))
    raise
