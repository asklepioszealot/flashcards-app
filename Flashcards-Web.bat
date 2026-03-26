@echo off
setlocal

cd /d "%~dp0"

start "" powershell -NoProfile -WindowStyle Hidden -Command ^
  "$url='http://127.0.0.1:4173'; for($i=0; $i -lt 120; $i++){ try { Invoke-WebRequest $url -UseBasicParsing | Out-Null; Start-Process $url; exit 0 } catch { Start-Sleep -Milliseconds 500 } }; Start-Process $url"

npm run web

