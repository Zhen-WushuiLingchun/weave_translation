# 织语本地 ASR 服务

仓库中的 `local-asr/` 提供一个可选的 OpenAI-compatible 本地服务。它实现
`POST /v1/audio/transcriptions`，只监听 `127.0.0.1`，可供织语的无字幕视频功能调用。
扩展 ZIP 不会捆绑 Python、模型或驱动；只有主动执行安装脚本才会下载它们。

## 安装

需要 Windows、Python 3.10+。在仓库根目录运行：

```powershell
.\local-asr\install.ps1 -RegisterStartup
```

脚本会在 `%LOCALAPPDATA%\WeaveASR` 创建独立虚拟环境，安装固定版本依赖，下载
multilingual Whisper 模型，并使用当前用户的 `HKCU\...\Run` 项实现登录后启动。
不需要管理员权限，也不会修改系统 Python。完整安装通常占用约 3–4 GB。

安装后的接口：

```text
http://127.0.0.1:8765/v1/audio/transcriptions
```

健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:8765/health | ConvertTo-Json -Depth 4
```

日志位于 `%LOCALAPPDATA%\WeaveASR\logs`。服务最大接受 10 MiB 的单个音频分片，
不会持久保存收到的音频。

## 可选模型与设备

| 模型标识 | 后端 | 用途 |
| --- | --- | --- |
| `faster-whisper-small-cuda` | NVIDIA CUDA FP16 | 默认；准确率与延迟较均衡 |
| `openvino-whisper-base-int8-gpu` | Intel 核显 `GPU.0` | 低功耗核显模式 |
| `openvino-whisper-base-int8-cpu` | Intel CPU INT8 | 稳定回退 |

OpenVINO 官方支持 Whisper 在 NPU 上运行，但 NPU 驱动、模型精度与 OpenVINO
版本的组合必须在本机验证。为避免“设备执行成功但文本为空/损坏”，NPU 路由默认
不公开。验证通过后可在启动服务前设置 `WEAVE_ASR_ENABLE_NPU=1`，使用
`openvino-whisper-base-fp16-npu`；不要仅凭接口返回 200 判断 NPU 可用。
驱动应从 [Intel 官方 NPU Driver 页面](https://www.intel.com/content/www/us/en/download/794734/intel-npu-driver-windows.html)
获取，并优先遵循整机厂商兼容性说明。

设备枚举可用下列命令检查：

```powershell
@'
import openvino as ov
core = ov.Core()
for device in core.available_devices:
    print(device, core.get_property(device, "FULL_DEVICE_NAME"))
'@ | & "$env:LOCALAPPDATA\WeaveASR\.venv\Scripts\python.exe" -
```

## 在织语中配置

1. 打开“服务与模型”，新增 OpenAI-compatible 连接。
2. Audio Transcriptions 地址填写 `http://127.0.0.1:8765/v1/audio/transcriptions`，API Key 留空。
3. 新增模型，填写上表中的模型标识并勾选 `audioTranscription`。
4. 在“任务路由”中把“语音识别”指向该模型。
5. 先点击“测试语音连接”，再到 YouTube/Bilibili 无字幕视频中点击“生成字幕”。

服务支持 `verbose_json`、`json` 和 `text` 三种响应格式。`verbose_json` 会返回相对于
当前分片的 segment 时间戳，织语再将它映射到播放器时间轴。

## 运行边界

- 织语发送的是 16 kHz、单声道、16-bit PCM WAV，通常为 3–15 秒分片。
- CUDA/OpenVINO 模型在第一次请求时会编译或热身；应以第二次及后续请求衡量持续延迟。
- CUDA 通常优先追求准确率和吞吐量；核显/NPU 更适合希望减少独显占用的场景。
- NPU 推理返回空文本、重复标点或乱码时，应停用 NPU，并检查 Intel NPU 驱动与模型版本。
- 本地服务只开放给 Chrome 扩展来源的跨域请求；命令行等无 `Origin` 请求仍可用于诊断。
