# claude-harness-manager

Claude Code 전역 환경(`~/.claude`)을 관리하는 로컬 웹 대시보드.

## 사전조건

- **Node.js 20 이상** — pull 후 `npm install`로 워크스페이스 의존성을 설치한다 (저장소에 `node_modules` 미포함).
- GUI 런처(`launcher/`)를 쓰려면 **Windows + Python 3.x** (tkinter 포함). 다른 OS는 아래 `npm run dev`를 직접 사용한다.

## 실행

```
npm install
npm run dev
```

- 서버: http://127.0.0.1:7860 (API)
- 웹: http://127.0.0.1:5173 (`/api`는 서버로 proxy)

## 기능

| 페이지 | 내용 |
|---|---|
| Overview | 스킬·에이전트·플러그인·프로젝트 수, stale 경고, 마지막 점검일 |
| Catalog | 플러그인 활성 상태, 개인 스킬·에이전트·커맨드 목록 (19KB 경고) |
| Memory | 프로젝트별 트랜스크립트·메모리 브라우저 (읽기 전용) |
| Cleanup | 규칙 기반 정리 후보 스캔 → dry-run → 아카이브 이동 → manifest 복구 |
| Config Editor | settings.json·settings.local.json 편집 (.claude.json은 읽기 전용) |

## 플랫폼 지원

경로는 `os.homedir()` 기준이라 어느 OS에서 pull해도 그 PC의 `~/.claude`를 가리킨다. 웹 대시보드는 모든 OS에서 동작하고, 일부 보조 기능만 플랫폼별로 다르다.

| 항목 | Windows | macOS / Linux |
|---|---|---|
| 웹 대시보드 (조회·편집·정리) | 지원 | 지원 |
| Claude Code 실행 감지 | `tasklist` | `pgrep -x claude` |
| 프로젝트 원본 경로 추정 | 지원 | 미지원 (표시 생략) |
| GUI 런처 (exe/Python) | 지원 | 미지원 (`npm run dev` 직접 실행) |

## 안전장치

- 모든 파일 연산은 `~/.claude` + `~/.claude.json` 경로 allowlist 내에서만 (path-guard)
- 쓰기: baseHash 대조(불일치 409) → 구조 검증 → 평문 .bak 백업(20개 로테이션) → atomic rename
- 정리: 삭제 API 없음 — 항상 archive로 move + manifest/journal 기록, 단건 복구 지원
- 127.0.0.1 바인드 + Host 헤더 검사 (DNS rebinding 방어)
- `.claude.json`은 읽기 전용 (Claude Code가 상시 재작성 — 수동 절차로만 수정)
