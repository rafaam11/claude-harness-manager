# HarnessManagerLauncher 빌드 스크립트
# PyInstaller로 단일 exe를 만들고 프로젝트 루트로 복사한다.
# 사용: launcher 폴더에서  ./build.ps1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# 아이콘은 있을 때만 적용
$iconArgs = @()
if (Test-Path "icon.ico") { $iconArgs = @("--icon", "icon.ico") }

# pyinstaller가 PATH에 있으면 그걸, 없으면 python -m PyInstaller로 대체
$pyiCmd = "pyinstaller"; $pyiPre = @()
if (-not (Get-Command pyinstaller -ErrorAction SilentlyContinue)) {
  $pyiCmd = if (Get-Command py -ErrorAction SilentlyContinue) { "py" } else { "python" }
  $pyiPre = @("-m", "PyInstaller")
}

& $pyiCmd @pyiPre `
  --onefile `
  --windowed `
  --name HarnessManagerLauncher `
  --clean `
  --noconfirm `
  @iconArgs `
  launcher.py
if ($LASTEXITCODE -ne 0) { throw "PyInstaller 빌드 실패 (exit $LASTEXITCODE)" }

# 빌드 산출물을 프로젝트 루트로 복사 → exe가 루트의 package.json을 자동 인식(무설정 동작)
Copy-Item "dist\HarnessManagerLauncher.exe" "..\HarnessManagerLauncher.exe" -Force
Write-Host ""
Write-Host "빌드 완료: $((Resolve-Path '..\HarnessManagerLauncher.exe').Path)"
