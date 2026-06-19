# claude-harness-manager

Claude Code의 전역 환경(`~/.claude` 디렉토리 + `~/.claude.json`)을 한 화면에서 조회·편집·정리하는 **로컬 전용 데스크톱 앱**(Electron).

- 스킬·에이전트·커맨드·플러그인·**MCP 서버**를 블럭으로 보고, 클릭하면 본문/설정까지 펼쳐 본다.
- `settings.json`을 **JSON 트리 에디터**로 안전하게 편집한다.
- 오래된 프로젝트·임시 파일을 **삭제 없이 아카이브로** 정리하고 되돌린다.
- 여러 프로젝트의 최근 작업·계획·세션을 **작업 회상 대시보드(Workspace)** 로 모아 본다.

네트워크 포트를 열지 않고(렌더러↔백엔드는 Electron IPC), 모든 파일 연산은 `~/.claude` 경로 안에서만 일어난다. 받는 사람은 **각자 자기 PC**에서 실행해 **자기 `~/.claude`**를 관리한다(데이터는 공유되지 않는다).

## 빠른 시작 (Windows)

1. [Releases](https://github.com/digitrack-inc/claude-harness-manager/releases)에서 **`Claude Harness Manager Setup x.y.z.exe`** 를 내려받아 실행한다.
2. 서명되지 않은 빌드라 Windows SmartScreen 경고가 뜰 수 있다 — **추가 정보 → 실행**으로 진행한다.
3. 설치 후 바탕화면/시작 메뉴의 **Claude Harness Manager** 로 실행한다. **Node.js 설치는 필요 없다**(Electron에 런타임이 내장됨).

## 업데이트

앱 좌측 하단의 현재 버전 배지 옆 **"업데이트 확인"** 버튼을 누르면 GitHub Releases에서 새 버전을 확인하고, 있으면 자동으로 내려받는다. 다운로드가 끝나면 버튼이 **"재시작하여 적용"** 으로 바뀌고, 누르면 앱을 재시작하며 새 버전이 적용된다. 앱을 켤 때도 조용히 한 번 확인한다.

## 주요 기능

- **Catalog** — Skill / Agent / Command / MCP Server / Plugin을 종류별 블럭으로. 클릭 시 인라인 상세(프론트매터·마크다운 본문·연결 설정).
- **MCP 조회** — `~/.claude.json`의 mcpServers를 읽어 표시. 시크릿(env/headers)은 기본 마스킹 + 토글.
- **Config Editor** — `settings.json`을 트리/텍스트 모드로 편집. 저장 시 자동 백업·충돌 감지.
- **Cleanup** — 규칙 기반 스캔 → dry-run → 아카이브 이동(삭제 없음) → 복구.
- **Workspace** — 프로젝트 회상·계획 칸반·타임라인.
- **안전 모델** — 경로 allowlist, 낙관적 동시성(409), `.bak` 백업, 아카이브 복구.

## 사용법

좌측 네비게이션의 6개 탭으로 이동한다. 우상단 **☀ / 🌙** 로 라이트/다크 테마를 전환한다(localStorage에 저장).

### Overview
스킬·에이전트·커맨드·플러그인·프로젝트 수, stale 프로젝트·정리 후보·대형 에이전트 경고, 마지막 점검일을 요약 카드로 보여준다. Claude Code 세션이 실행 중이면 상단에 경고 배너가 뜬다(설정 저장·정리 시 충돌 주의).

### Workspace
**Projects**(최근순 프로젝트 카드 + 자동 회상 + 상태/메모), **Plans**(상태별 4컬럼 칸반), **Timeline**(날짜별 세션/계획 이벤트, 공백 구분선)으로 "어디까지 했는지"를 회상한다.

### Catalog
종류별 섹션(**Skills / Agents / Commands / MCP Servers / Plugins**)으로 나뉘며, 각 항목은 카드 블럭이다. 카드를 클릭하면 그 자리에서 상세가 펼쳐진다(한 번에 하나). **모두 읽기 전용**이다.

- **Skill / Agent / Command** — 경로·크기·수정일 + **프론트매터 표** + **마크다운으로 렌더된 본문**. 19KB를 넘는 에이전트는 ⚠ 표시.
- **MCP Servers** — 연결 설정(stdio: `command`/`args`/`env`, http/sse: `url`/`headers`). **`env`·`headers` 값은 `••••`로 가려지고 👁 를 누르면 노출**된다.
- **Plugins** — 활성 상태(enabled / disabled / project / blocked) + 설치 스코프·버전.

### Memory
`~/.claude/projects`의 프로젝트 목록(읽기 전용 브라우저). 프로젝트 행을 클릭 → 파일 목록 → 파일을 클릭 → 내용을 본다. 30일 이상 미활동 프로젝트는 stale로 표시되고, 대형 파일은 앞부분만 로드한다.

### Cleanup
오래된 데이터를 **삭제하지 않고** 아카이브로 옮긴다.

1. **재스캔** — 정리 후보를 규칙으로 찾는다(임시 디렉토리 30일+, stale 프로젝트, 대형 에이전트는 경고용).
2. 옮길 항목을 체크하고 **dry-run** 으로 "무엇이 어디로 가는지" 먼저 확인한다.
3. **실행 — 아카이브로 이동** — `~/.claude/archive/<날짜>/<category>/` 로 이동하고 manifest에 기록한다.
4. 아래 manifest 목록에서 **복원** 으로 원위치 되돌린다.

> 대형 에이전트 경고(`warn-only`)는 표시용이므로 이동 대상이 아니다.

### Config Editor
`settings.json` / `settings.local.json` 을 **JSON 트리 에디터**(vanilla-jsoneditor)로 편집한다.

- 상단 메뉴바에서 **tree / text / table 모드** 를 전환한다.
- **저장** 시 현재본을 `.bak` 로 백업(20개 로테이션)한 뒤 원자적으로 교체한다. 파일이 외부에서 바뀌면 충돌(409)을 감지해 덮어쓰지 않는다.
- 하단 **백업** 목록에서 이전 버전으로 **복원**한다.
- **`.claude.json` 은 읽기 전용** 이다(Claude Code가 상시 재작성하므로 충돌을 막기 위함 — 수동 절차로만 수정).

## 안전장치

- 모든 파일 연산은 `~/.claude` + `~/.claude.json` 경로 allowlist 내에서만 (path-guard, 위반 시 403).
- 쓰기: baseHash 대조(불일치 409) → 구조 검증 → 평문 `.bak` 백업(20개 로테이션) → atomic rename.
- 정리: 삭제 없음 — 항상 archive로 move + manifest/journal 기록, 단건 복구 지원.
- 조회 전용(카탈로그 본문·MCP)도 경로·읽기 전용 정책을 그대로 통과한다.
- 네트워크 포트 미개방 — renderer↔main은 Electron IPC(`window.api.invoke`). 단일 인스턴스 락으로 중복 실행 차단.
- `.claude.json`은 읽기 전용(Claude Code가 상시 재작성 — 수동 절차로만 수정).

## 개발

단일 Electron 프로젝트(electron-vite). 모든 명령은 루트에서 실행한다.

```bash
git clone https://github.com/digitrack-inc/claude-harness-manager.git
cd claude-harness-manager
npm install
npm run dev        # electron-vite dev (main/preload/renderer HMR + Electron 창)
```

| 스크립트 | 설명 |
|---|---|
| `npm run dev` | electron-vite 개발 모드 |
| `npm run build` | typecheck + 프로덕션 번들(`out/`) |
| `npm run typecheck` | TypeScript 타입 검사(node + web 2패스) |
| `npm run icon` | `build/icon.ico`·`icon.png` 재생성 |
| `npm run dist` | Windows 설치본 빌드 + GitHub Releases 퍼블리시(`release/`, `GH_TOKEN` 필요) |

- 린트 도구·단위 테스트 프레임워크는 없다. 변경 검증의 1차 관문은 `npm run typecheck`, 2차는 `npm run build`.
- 릴리스: 버전 bump 후 `GH_TOKEN`(repo write PAT)을 셸에 export하고 `npm run dist`. electron-updater가 동작하려면 Release에 `latest.yml`이 함께 올라가야 하므로 드래그앤드롭 대신 `--publish always` 경로를 쓴다.
- 코드 구조·규약은 [CLAUDE.md](CLAUDE.md) 참조.
