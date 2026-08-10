# 本地 faster-whisper ASR 配置

织语不会捆绑或后台安装语音识别程序。你可以连接任何实现 OpenAI-compatible `POST /v1/audio/transcriptions` 的本机服务；以下示例使用 `faster-whisper`，并只监听 `127.0.0.1`。

## 1. 创建 Python 环境

需要 Python 3.10+。在单独目录中执行：

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install faster-whisper fastapi uvicorn python-multipart
```

CUDA 环境可使用 `device="cuda", compute_type="float16"`；纯 CPU 可改为 `device="cpu", compute_type="int8"`。模型文件首次使用时由 faster-whisper 下载，请核对其来源和磁盘占用。

## 2. 暴露兼容接口

创建一个本地 FastAPI 服务，接收 multipart 表单中的 `file`、`model`、`language` 和 `response_format`，调用 `WhisperModel.transcribe`，并返回：

```json
{
  "text": "complete transcript",
  "segments": [
    { "start": 0.2, "end": 2.8, "text": "first sentence" }
  ]
}
```

时间戳必须相对于当前上传的音频分片。织语会将它们映射回播放器时间、去除相邻分片重叠，并生成 `SubtitleCue`。如果服务只返回 `{"text":"..."}` 或纯文本，织语也能使用，但时间会按文本长度近似分配。

启动服务时只监听本机：

```powershell
uvicorn server:app --host 127.0.0.1 --port 8000
```

不要把无鉴权服务绑定到 `0.0.0.0`。faster-whisper 的模型参数与设备要求见其[官方仓库](https://github.com/SYSTRAN/faster-whisper)。

## 3. 在织语中配置

1. 打开“服务与模型”，新增 OpenAI-compatible 连接。
2. Audio Transcriptions 地址填写 `http://127.0.0.1:8000/v1/audio/transcriptions`，API Key 留空。
3. 新增模型并勾选 `audioTranscription`；模型标识填写本地服务接受的名称。
4. 在“任务路由”中将“语音识别”指向该模型。
5. 打开 YouTube 或 Bilibili 无字幕视频，点击侧边坞中的“开启字幕翻译”，随后点击“生成并翻译字幕”。

## 接口与隐私边界

- 音频为 16 kHz、单声道、16-bit PCM WAV。
- 语音活动分片通常为 3–15 秒，并包含约 0.75 秒重叠。
- 原始分片只存在于扩展内存，接口返回后立即释放。
- 本地服务的日志、缓存和模型下载行为由该服务自行负责；织语无法替它清理或加密。
