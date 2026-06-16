# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

Claude Code 전역 환경(`~/.claude` 디렉토리 + `~/.claude.json`)을 관리하는 로컬 전용 웹 대시보드. 스킬/에이전트/커맨드/플러그인/MCP 서버 카탈로그 조회, 설정 파일 편집(JSON 트리 에디터), 규칙 기반 정리(아카이브)를 제공한다. 또한 여러 프로젝트에 걸친 **작업 회상 대시보드(Workspace)** 로 최근 작업한 프로젝트·계획·세션 흔적을 자동으로 모아 보여주고(주말 지나 돌아왔을 때 "어디까지 했는지" 회상용), 가벼운 상태/메모를 직접 단다. 사용자 자신의 머신에서만 동작하며 외부로 노출되지 않는 것을 전제로 설계됐다.

## 명령어

루트는 npm workspaces 모노레포(`server`, `web`)다. 모든 명령은 루트에서 실행한다.

```
npm install          # 워크스페이스 전체 의존성 설치
npm run dev          # server(7860) + web(5173) 동시 실행 (concurrently)
npm run dev:server   # 서버만 (tsx watch)
npm run dev:web      # 웹만 (vite)
npm run build        # server tsc 빌드 + web vite 빌드
npm run typecheck    # server + web 타입체크 (tsc --noEmit)
```

- 서버 API: http://127.0.0.1:7860, 웹: http://127.0.0.1:5173 (`/api`는 vite proxy로 서버에 전달)
- **린트 도구 없음**, **단위 테스트 프레임워크 없음**. 변경 검증은 `npm run typecheck`가 1차 관문이다.
- `e2e-check.py`는 Playwright 스모크 테스트(탭 순회 + 콘솔 에러 수집 + 스크린샷). 단독 실행 전 **dev 서버 두 개가 모두 떠 있어야** 한다: `python e2e-check.py`.
- **의존성을 추가/교체하면 실행 중인 vite dev의 사전 번들 캐시가 stale해져 `504 Outdated Optimize Dep`가 날 수 있다.** dev 서버를 재시작(필요하면 `node_modules/.vite` 삭제)하면 해소된다.

## 아키텍처

### 안전 모델이 이 코드베이스의 핵심

사용자의 살아있는 `~/.claude` 환경을 건드리므로, 모든 파일 변경은 다음 불변식을 통과한다. 새 기능을 추가할 때 이 경로를 우회하지 말 것.

1. **경로 allowlist** (`server/src/lib/path-guard.ts`) — 모든 파일 연산은 `guardPath()`로 경로를 resolve한 뒤 `ALLOWED_ROOTS`(`~/.claude`, `~/.claude.json`) prefix 검사를 통과해야 한다. 통과 못 하면 `PathViolationError`(403). 조회 API(`/api/catalog/content` 등 경로 인자를 받는 라우트)도 반드시 이걸 통과한다.
2. **쓰기 직렬화** (`server/src/lib/lock.ts`) — 모든 변경 연산(`safeWrite`, archive move/restore)은 `withLock()` in-process 뮤텍스로 직렬화된다. 서버 인스턴스가 단일하다는 가정에 의존.
3. **낙관적 동시성 + 백업** (`server/src/lib/safe-write.ts`) — 쓰기 파이프라인: 클라이언트가 보낸 `baseHash`와 현재 파일 sha256 대조(불일치 시 `ConflictError` **409**) → `validateConfig` 구조 검증 → 평문 `.bak` 백업(`BACKUP_DIR`에 20개 로테이션) → temp 파일 작성 → atomic rename.
4. **삭제 없음, 아카이브만** (`server/src/lib/archive.ts`) — 정리는 파일을 `~/.claude/archive/<날짜>/<category>/`로 **이동**하고 `manifest.json`에 기록한다. `journal.json`에 이동 전(done=false)/후(done=true)를 남겨 중단 복구를 추적. 단건 `restoreItem`으로 원위치 복원 가능. DELETE API는 의도적으로 존재하지 않는다.

쓰기 대상에는 사용자 환경 파일(settings.json 등) 외에 **앱 소유 데이터**도 있다 — Workspace의 수동 레이어 `~/.claude/harness-manager/board.json`(상태·메모·계획↔프로젝트 override; `server/src/lib/board.ts`). board.json은 CC가 외부에서 재작성하지 않으므로 `baseHash` 낙관적 동시성을 쓰지 않고, `withLock` 안에서 서버측 read-modify-write 필드 머지로 lost-update만 막는다(쓰기는 동일하게 atomic rename + `.bak` 백업 통과, `validateConfig` 대신 board 전용 경량 검증). 손상 시 손상본을 옆에 백업하고 기본값으로 생존한다(페이지가 죽지 않게).

### 서버 (`server/`, Fastify + TypeScript ESM)

- 진입점 `src/index.ts`: Host 헤더가 `127.0.0.1`/`localhost`인지 검사(DNS rebinding 방어), CORS 헤더는 **의도적으로 내보내지 않음**, `statusCode` 기반 에러 핸들러.
- `src/routes/index.ts`: 모든 HTTP 라우트가 한 파일에 등록된다. 새 엔드포인트는 여기 추가하고, 실제 로직은 `services/`(조회·스캔)와 `lib/`(파일 원자성·검증)에 둔다.
- `src/config.ts`: 모든 경로 상수·정책 값의 단일 출처(`ALLOWED_ROOTS`, `CONFIG_FILES`, `STALE_DAYS=30`, `AGENT_SIZE_WARN_BYTES=19KB`, `BACKUP_KEEP=20`, `TEMP_DIRS`, 그리고 Workspace용 `BOARD_FILE`, `RECALL_TAIL_BYTES=512KB`, `WORKSPACE_CACHE_TTL_MS=5s`, `PLAN_GUESS_WINDOW_MS=6h`).
- `src/services/`: 읽기 전용 도메인 로직 — `catalog`(skills/agents/commands 프론트매터 파싱 + `readCatalogContent`로 본문·전체 프론트매터 조회), `plugins`(installed_plugins·blocklist·settings 병합), `projects`(프로젝트 디렉토리 walk·stale 계산), `scan`(정리 후보 산출), `mcp`(`~/.claude.json`의 mcpServers 파싱 — 사용자/프로젝트 스코프 모두 수용, 읽기 전용). **Workspace용 읽기 서비스**: `plans`(`~/.claude/plans` 계획 스캔·첫 `#` 헤딩 제목 파싱), `recall`(`history.jsonl` 인덱스 + 프로젝트별 최신 transcript **tail-read**(끝 512KB)로 `ai-title`·마지막 프롬프트/응답 추출 + 계획↔프로젝트 시각 상관 자동추정[sessionId→projectId 우선], 5s TTL 모듈 캐시), `tasks`(세션별 `tasks/<sessionId>/*.json` todo 조회). 조회 라우트: `/api/catalog/content`, `/api/mcp`, `/api/workspace/*`(projects·plans·plan/content·timeline + board POST 2종).

### 웹 (`web/`, React 18 + Vite)

- 라우터·상태관리 라이브러리 없음. `App.tsx`가 `useState`로 탭 6개(`PAGES`)를 직접 전환한다. 테마(다크/라이트)는 `data-theme` 속성 + localStorage.
- 런타임 의존성은 **최소를 지향하되 정당한 경우 추가**한다. 현재: 카탈로그 본문 마크다운 렌더에 `marked`, Config Editor JSON 트리/텍스트 편집에 `vanilla-jsoneditor`.
- `src/api/client.ts`: `fetch` 래퍼(`api.get/put/post`) + `ApiError`(서버 `{error}` 본문을 던짐) + `fmtSize`/`fmtDate` 포맷터. 모든 페이지가 이걸 통해 API 호출.
- 페이지별 책임: `Overview`(요약 카드), `Workspace`(작업 회상 대시보드 — 내부 서브탭 3개: **Projects**(최근순 프로젝트 카드 + 자동 회상 + 상태/메모 인라인 편집), **Plans**(계획을 상태별 4컬럼 칸반: 진행중/보류/완료/보관, 파일이 `_archive`면 항상 보관 컬럼; 프로젝트 자동연결+override·본문 마크다운), **Timeline**(날짜별 세션/계획 이벤트, "N일 공백" 구분선으로 주말 갭 가시화). 편집은 낙관적 업데이트→실패 시 재동기화, 메모는 blur 저장), `Catalog`(종류별 카드 블럭 + 단일 인라인 확장 — skill/agent/command 본문 마크다운·프론트매터, MCP 연결설정·시크릿 마스킹, plugin 상태; 모두 읽기 전용), `Memory`(프로젝트 파일 읽기 전용 브라우저), `Cleanup`(스캔→체크박스 선택→**dry-run 먼저**→실행→manifest 복구), `ConfigEditor`(settings JSON을 `vanilla-jsoneditor` 트리/텍스트 에디터로 편집 — 저장·백업·409 충돌 로직은 그대로 유지).

### 설정 파일 정책 (`CONFIG_FILES`)

- `settings.json`, `settings.local.json`은 **편집 가능**(`writable: true`), `~/.claude.json`은 **읽기 전용**(Claude Code가 상시 재작성하므로 충돌 방지 — 수동 절차로만 수정). 쓰기 라우트는 `writable: false`면 403. MCP 서버 정의도 `~/.claude.json`에 있으므로 **조회만** 하고 토글/편집은 제공하지 않는다.
- 검증은 `lib/json-validate.ts`의 수동 구조 검사다. **공개 schemastore 스키마를 쓰지 않는다** — 이 환경 settings.json은 최상위에 env성 키(`MAX_THINKING_TOKENS` 등)가 있어 공개 스키마와 불일치. 목적은 "CC 기동을 깨뜨리는 저장 차단"(파싱 가능 + 핵심 키 타입 보존)뿐이다.

## 코드 규약 / 주의점

- **서버는 ESM + NodeNext**: 상대 임포트에 반드시 `.js` 확장자를 붙인다(소스가 `.ts`여도 `from "./config.js"`). 빠뜨리면 런타임에 깨진다.
- **플랫폼 분기 코드**: `cc-detect.ts`는 `process.platform`으로 Windows는 `tasklist`(claude.exe), macOS/Linux는 `pgrep -x claude`로 CC 프로세스를 감지한다. `projects.ts`의 `guessOriginalPath`는 여전히 Windows 드라이브 경로 전용 — flatten된 디렉토리명(`D--hdx-agv`)을 `D:\hdx\agv`로 역추정하고(구분자 `-`/이름 `-` 구별 불가 → 추정값), 비-Windows 이름은 `null`.
- 코드 주석·식별자는 한국어 도메인 용어를 사용하는 기존 스타일을 유지한다.
- `cleanup/execute`는 `category === "warn-only"` 항목 이동을 거부한다(대형 에이전트 경고는 표시용이지 이동 후보가 아님).
- MCP 시크릿(env/headers)은 서버가 값을 그대로 내려보내고 **프론트에서 마스킹+토글**한다(로컬 단독 전제). 마스킹을 우회해 로그/터미널에 값을 노출하지 말 것.
