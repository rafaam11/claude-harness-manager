# claude-harness-manager 원클릭 셋업
# 1) npm install (필수)  2) GUI 런처 exe 빌드 (선택 — 환경 미비 시 건너뜀)
# 직접 실행: powershell -ExecutionPolicy Bypass -File setup.ps1  (또는 setup.bat 더블클릭)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Have($name) { return [bool](Get-Command $name -ErrorAction SilentlyContinue) }

Write-Host "=== claude-harness-manager 셋업 ===" -ForegroundColor Cyan

# --- 1) Node / npm ---
if (-not (Have "npm")) {
  Write-Host "[오류] npm(Node.js)을 찾을 수 없습니다." -ForegroundColor Red
  Write-Host "       https://nodejs.org 에서 Node.js 20+ 를 설치한 뒤 다시 실행하세요." -ForegroundColor Red
  exit 1
}

Write-Host "`n[1/2] npm install ..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) {
  Write-Host "[오류] npm install 에 실패했습니다." -ForegroundColor Red
  exit 1
}
Write-Host "npm install 완료." -ForegroundColor Green

# --- 2) GUI 런처 exe 빌드 (선택) ---
Write-Host "`n[2/2] GUI 런처 exe 빌드 ..." -ForegroundColor Yellow

function Skip-Build($reason) {
  Write-Host "[건너뜀] $reason" -ForegroundColor DarkYellow
  Write-Host "         앱은 'npm run dev' 로 실행하거나, GUI가 필요하면 'python launcher\launcher.py' 로 바로 띄울 수 있습니다." -ForegroundColor DarkYellow
  Write-Host "`n=== 셋업 완료 (런처 exe 제외) ===" -ForegroundColor Cyan
  exit 0
}

# Python 확인
$python = $null
foreach ($cand in @("py", "python")) { if (Have $cand) { $python = $cand; break } }
if (-not $python) { Skip-Build "Python 3 이 없어 exe 빌드를 건너뜁니다." }

# PyInstaller 확인 → 없으면 설치 시도
& $python -m PyInstaller --version *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "PyInstaller 가 없어 설치를 시도합니다 ($python -m pip install pyinstaller) ..." -ForegroundColor Yellow
  & $python -m pip install --quiet pyinstaller *> $null
  if ($LASTEXITCODE -ne 0) { Skip-Build "PyInstaller 설치에 실패했습니다." }
  Write-Host "PyInstaller 설치 완료." -ForegroundColor Green
}

# build.ps1 실행 (pyinstaller PATH 미존재 시 python -m PyInstaller 로 fallback)
try {
  & "$PSScriptRoot\launcher\build.ps1"
} catch {
  Skip-Build "exe 빌드 중 오류: $_"
}

Write-Host "`n=== 셋업 완료 ===" -ForegroundColor Cyan
Write-Host "프로젝트 루트의 HarnessManagerLauncher.exe 를 더블클릭하면 대시보드가 켜집니다." -ForegroundColor Green
