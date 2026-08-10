param(
    [string]$InstallRoot = "$env:LOCALAPPDATA\WeaveASR",
    [string]$Python = '',
    [switch]$RegisterStartup,
    [ValidateSet('faster-whisper-small-cuda', 'openvino-whisper-base-int8-gpu', 'openvino-whisper-base-int8-cpu')]
    [string]$DefaultModel = 'faster-whisper-small-cuda'
)

$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$appRoot = Join-Path $InstallRoot 'app'
$venvPython = Join-Path $InstallRoot '.venv\Scripts\python.exe'

if (-not $Python) {
    $Python = Get-ChildItem -LiteralPath "$env:LOCALAPPDATA\Programs\Python" -Directory -Filter 'Python*' -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending |
        ForEach-Object { Join-Path $_.FullName 'python.exe' } |
        Where-Object { Test-Path -LiteralPath $_ } |
        Select-Object -First 1
}
if (-not (Test-Path -LiteralPath $Python)) {
    throw 'Python 3.10 or newer was not found under the current user profile. Pass -Python with an explicit python.exe path.'
}
& $Python -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)"
if ($LASTEXITCODE -ne 0) { throw 'Weave Local ASR requires Python 3.10 or newer.' }

New-Item -ItemType Directory -Path $InstallRoot,$appRoot,(Join-Path $InstallRoot 'models'),(Join-Path $InstallRoot 'logs') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $sourceRoot 'server.py') -Destination (Join-Path $appRoot 'server.py') -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot 'download_openvino_model.py') -Destination (Join-Path $appRoot 'download_openvino_model.py') -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot 'requirements.txt') -Destination (Join-Path $InstallRoot 'requirements.txt') -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot 'start.ps1') -Destination (Join-Path $InstallRoot 'start.ps1') -Force

if (-not (Test-Path -LiteralPath $venvPython)) {
    & $Python -m venv (Join-Path $InstallRoot '.venv')
}

& $venvPython -m pip install --disable-pip-version-check -r (Join-Path $InstallRoot 'requirements.txt')
$env:WEAVE_ASR_HOME = $InstallRoot
& $venvPython (Join-Path $appRoot 'download_openvino_model.py')

if ($RegisterStartup) {
    $startScript = Join-Path $InstallRoot 'start.ps1'
    $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    $runCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScript`" -InstallRoot `"$InstallRoot`" -DefaultModel `"$DefaultModel`""
    New-Item -Path $runKey -Force | Out-Null
    New-ItemProperty -Path $runKey -Name 'Weave Local ASR' -Value $runCommand -PropertyType String -Force | Out-Null
}

& (Join-Path $InstallRoot 'start.ps1') -InstallRoot $InstallRoot -DefaultModel $DefaultModel
Write-Output "Weave ASR installed at $InstallRoot"
Write-Output 'Endpoint: http://127.0.0.1:8765/v1/audio/transcriptions'
Write-Output "Default model: $DefaultModel"
