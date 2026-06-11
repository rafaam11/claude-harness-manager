@echo off
REM claude-harness-manager 원클릭 셋업 (더블클릭 실행)
REM npm install 후 GUI 런처 exe를 빌드한다. 환경이 미비하면 빌드만 건너뛴다.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
echo.
pause
