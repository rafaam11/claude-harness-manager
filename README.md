# claude-harness-manager

Claude Code의 전역 환경(`~/.claude` 디렉토리 + `~/.claude.json`)을 한 화면에서 조회·편집·정리하는 **로컬 전용 웹 대시보드**.

- 스킬·에이전트·커맨드·플러그인·**MCP 서버**를 블럭으로 보고, 클릭하면 본문/설정까지 펼쳐 본다.
- `settings.json`을 **JSON 트리 에디터**로 안전하게 편집한다.
- 오래된 프로젝트·임시 파일을 **삭제 없이 아카이브로** 정리하고 되돌린다.

서버는 `127.0.0.1`에만 바인드되고 외부로 노출되지 않는다. 받는 사람은 **각자 자기 PC**에서 실행해 **자기 `~/.claude`**를 관리한다(데이터는 공유되지 않는다).

## 빠른 시작 (Windows)

**Node.js 20+ 만 설치돼 있으면** 더블클릭 두 번으로 끝난다.

1. **`setup.bat` 더블클릭** — 의존성 설치(`npm install`)와 GUI 런처 exe 빌드를 자동으로 수행한다.
2. 생성된 **`HarnessManagerLauncher.exe` 더블클릭** — 대시보드를 켜고 브라우저(http://127.0.0.1:5173)를 연다.

> Node.js가 없으면 [nodejs.org](https://nodejs.org) 에서 먼저 설치한다. Python/PyInstaller가 없는 PC면 `setup.bat`이 exe 빌드만 건너뛰므로, 그때는 `npm run dev`로 실행한다. macOS/Linux도 `npm run dev`를 쓴다(아래 [설치 & 실행](#설치--실행) 참고).

## 주요 기능

- **Catalog** — Skill / Agent / Command / MCP Server / Plugin을 종류별 블럭으로. 클릭 시 인라인 상세(프론트매터·마크다운 본문·연결 설정).
- **MCP 조회** — `~/.claude.json`의 mcpServers를 읽어 표시. 시크릿(env/headers)은 기본 마스킹 + 토글.
- **Config Editor** — `settings.json`을 트리/텍스트 모드로 편집. 저장 시 자동 백업·충돌 감지.
- **Cleanup** — 규칙 기반 스캔 → dry-run → 아카이브 이동(삭제 없음) → 복구.
- **안전 모델** — 경로 allowlist, 낙관적 동시성(409), `.bak` 백업, 아카이브 복구.

## 사전조건

- **Node.js 20 이상** (필수)
- (선택) GUI 런처를 쓰려면 **Windows + Python 3.x** (tkinter 포함). 다른 OS는 아래 `npm run dev`를 직접 쓴다.

## 설치 & 실행

```bash
git clone https://github.com/rafaam11/claude-harness-manager.git
cd claude-harness-manager
npm install      # 워크스페이스(server + web) 의존성 설치
npm run dev      # server(7860) + web(5173) 동시 실행
```

브라우저에서 **http://127.0.0.1:5173** 에 접속한다. 종료는 터미널에서 `Ctrl+C`.

> 저장소에 `node_modules`는 포함하지 않는다 — clone 후 반드시 `npm install`을 먼저 실행한다.

프로덕션 빌드가 필요하면(보통은 dev로 충분):

```bash
npm run build    # server: tsc 빌드, web: vite build → web/dist
```

## 사용법

좌측 네비게이션의 5개 탭으로 이동한다. 우상단 **☀ / 🌙** 로 라이트/다크 테마를 전환한다(localStorage에 저장).

### Overview

스킬·에이전트·커맨드·플러그인·프로젝트 수, stale 프로젝트·정리 후보·대형 에이전트 경고, 마지막 점검일을 요약 카드로 보여준다. Claude Code 세션이 실행 중이면 상단에 경고 배너가 뜬다(설정 저장·정리 시 충돌 주의).

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

- 상단 메뉴바에서 **tree / text / table 모드** 를 전환한다. tree에서 펼침·접기·인라인 키-값 편집·항목 추가/삭제, text에서 raw 편집을 한다.
- **정렬** 버튼으로 들여쓰기를 정리한다.
- **저장** 시 현재본을 `.bak` 로 백업(20개 로테이션)한 뒤 원자적으로 교체한다. 파일이 외부에서 바뀌면 충돌(409)을 감지해 덮어쓰지 않는다.
- 하단 **백업** 목록에서 이전 버전으로 **복원**한다.
- **`.claude.json` 은 읽기 전용** 이다(Claude Code가 상시 재작성하므로 충돌을 막기 위함 — 수동 절차로만 수정).

## GUI 런처 (Windows)

터미널 없이 켜고 끄고 싶을 때 쓴다. **Node.js는 여전히 설치돼 있어야 한다**(런처는 `npm run dev` 실행만 대행하고 Node를 번들하지 않는다).

```bash
python launcher\launcher.py        # 바로 실행
```

또는 단일 exe로 빌드:

```bash
cd launcher
./build.ps1                        # 루트에 HarnessManagerLauncher.exe 생성 → 더블클릭 실행
```

**▶ 시작** / **브라우저 열기** / **■ 중지** 버튼과 실시간 로그를 제공한다. 자세한 내용은 [`launcher/README.md`](launcher/README.md).

## 플랫폼 지원

경로는 `os.homedir()` 기준이라 어느 OS에서 받아도 그 PC의 `~/.claude`를 가리킨다. 웹 대시보드는 모든 OS에서 동작하고, 일부 보조 기능만 플랫폼별로 다르다.

| 항목 | Windows | macOS / Linux |
|---|---|---|
| 웹 대시보드 (조회·편집·정리) | 지원 | 지원 |
| Claude Code 실행 감지 | `tasklist` | `pgrep -x claude` |
| 프로젝트 원본 경로 추정 | 지원 | 미지원 (표시 생략) |
| GUI 런처 (exe/Python) | 지원 | 미지원 (`npm run dev` 직접 실행) |

## 안전장치

- 모든 파일 연산은 `~/.claude` + `~/.claude.json` 경로 allowlist 내에서만 (path-guard, 위반 시 403).
- 쓰기: baseHash 대조(불일치 409) → 구조 검증 → 평문 `.bak` 백업(20개 로테이션) → atomic rename.
- 정리: 삭제 API 없음 — 항상 archive로 move + manifest/journal 기록, 단건 복구 지원.
- 조회 전용 API(카탈로그 본문·MCP)도 경로·읽기 전용 정책을 그대로 통과한다.
- `127.0.0.1` 바인드 + Host 헤더 검사(DNS rebinding 방어), CORS 헤더 미발행.
- `.claude.json`은 읽기 전용(Claude Code가 상시 재작성 — 수동 절차로만 수정).

## 개발

- 모노레포(npm workspaces): `server`(Fastify + TS ESM), `web`(React 18 + Vite). 모든 명령은 루트에서 실행한다.
- `npm run dev` / `npm run dev:server` / `npm run dev:web` / `npm run build` / `npm run typecheck`.
- 린트 도구·단위 테스트 프레임워크는 없다. 변경 검증의 1차 관문은 `npm run typecheck`.
- e2e 스모크: dev 서버 두 개를 띄운 뒤 `python e2e-check.py`(탭 순회 + 콘솔 에러 수집 + 스크린샷).
- 코드 구조·규약은 [CLAUDE.md](CLAUDE.md) 참조.
