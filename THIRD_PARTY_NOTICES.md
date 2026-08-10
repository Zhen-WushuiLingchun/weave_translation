# Third-party notices

织语的发行构建包含以下直接开源依赖。具体版本由 `pnpm-lock.yaml` 固定；各项目仍遵循其原许可证。

| Project | Version | License | Use in Weave |
| --- | --- | --- | --- |
| [React](https://github.com/facebook/react) | `19.2.8` | MIT | Extension interface runtime |
| [React DOM](https://github.com/facebook/react) | `19.2.8` | MIT | Extension interface rendering |
| [KaTeX](https://github.com/KaTeX/KaTeX) | `0.18.1` | MIT | Local LaTeX parsing and MathML rendering |

## Optional local ASR environment

`local-asr/install.ps1` installs its Python environment separately under `%LOCALAPPDATA%`; these packages are not included in the Chrome extension ZIP.

| Project | Version | License | Use |
| --- | --- | --- | --- |
| [OpenVINO](https://github.com/openvinotoolkit/openvino) / [OpenVINO GenAI](https://github.com/openvinotoolkit/openvino.genai) | `2026.3.0` / `2026.3.0.0` | Apache-2.0 | CPU, Intel GPU and experimental NPU Whisper inference |
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper) / [CTranslate2](https://github.com/OpenNMT/CTranslate2) | `1.2.1` / `4.8.1` | MIT | NVIDIA CUDA Whisper inference |
| FastAPI / Uvicorn | `0.116.1` / `0.35.0` | MIT / BSD-3-Clause | Localhost OpenAI-compatible HTTP service |
| NumPy / SciPy / SoundFile | `2.3.3` / `1.16.2` / `0.13.1` | BSD family | Audio decoding, normalization and resampling |
| NVIDIA cuDNN / cuBLAS CUDA 12 Python packages | `9.14.0.64` / `12.9.2.10` | NVIDIA Software License | CUDA runtime libraries installed from PyPI; subject to NVIDIA's package license terms |
