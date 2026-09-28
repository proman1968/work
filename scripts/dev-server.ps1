# Перезапуск dev-сервера WORK на отдельном порту (для UI-проверок): scripts/dev-server.ps1 [-Port 8011]
param([int]$Port = 8011)
$pidFile = Join-Path $env:TEMP 'work-dev-server.pid'
if (Test-Path $pidFile) {
    $old = Get-Content $pidFile
    Stop-Process -Id $old -Force -ErrorAction SilentlyContinue
}
$env:WORK_DEV = 'true'
$env:WORK_PORT = "$Port"
$env:WORK_STUN_PORT = "$($Port + 1000)"
$root = Split-Path $PSScriptRoot -Parent
$p = Start-Process -FilePath node -ArgumentList 'sources/work.js' -WorkingDirectory $root `
    -RedirectStandardOutput (Join-Path $env:TEMP 'work-dev.out') -RedirectStandardError (Join-Path $env:TEMP 'work-dev.err') `
    -PassThru -WindowStyle Hidden
$p.Id | Out-File $pidFile
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    try {
        Invoke-WebRequest -UseBasicParsing "http://localhost:$Port/favicon.ico" -TimeoutSec 2 | Out-Null
        Write-Output "WORK dev: http://localhost:$Port (pid $($p.Id))"
        exit 0
    }
    catch { }
}
Write-Output "не поднялся; см. $env:TEMP\work-dev.err"
exit 1
