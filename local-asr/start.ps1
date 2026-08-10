param(
    [string]$InstallRoot = "$env:LOCALAPPDATA\WeaveASR",
    [int]$Port = 8765,
    [ValidateSet('faster-whisper-small-cuda', 'openvino-whisper-base-int8-gpu', 'openvino-whisper-base-int8-cpu')]
    [string]$DefaultModel = 'faster-whisper-small-cuda'
)

$ErrorActionPreference = 'Stop'
$python = Join-Path $InstallRoot '.venv\Scripts\python.exe'
$appRoot = Join-Path $InstallRoot 'app'
$logRoot = Join-Path $InstallRoot 'logs'

if (-not (Test-Path -LiteralPath $python)) {
    throw "Weave ASR Python environment is missing: $python"
}

$listener = $null
for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
    if (-not $listener) {
        break
    }
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 1
        if ($health.service -eq 'Weave Local ASR') {
            return
        }
    } catch {
        # A previous instance can need a moment to release the listener after it is stopped.
    }
    Start-Sleep -Milliseconds 250
}
if ($listener) {
    throw "Port $Port is already occupied by another process."
}

New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$env:WEAVE_ASR_HOME = $InstallRoot
$env:WEAVE_ASR_DEFAULT_MODEL = $DefaultModel
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'

$arguments = @(
    '-m', 'uvicorn', 'server:app',
    '--host', '127.0.0.1',
    '--port', $Port,
    '--app-dir', $appRoot,
    '--log-level', 'info'
)

Start-Process -FilePath $python `
    -ArgumentList $arguments `
    -WorkingDirectory $appRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logRoot 'service.out.log') `
    -RedirectStandardError (Join-Path $logRoot 'service.err.log')
