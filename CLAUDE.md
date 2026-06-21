# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

Claude Code 전역 환경(`~/.claude` 디렉토리 + `~/.claude.json`)을 관리하는 로컬 전용 **데스크톱 앱**(Electron). 스킬/에이전트/커맨드/플러그인/MCP 서버 카탈로그 조회, 설정 파일 편집(JSON 트리 에디터), 규칙 기반 정리(아카이브)를 제공한다. 또한 여러 프로젝트에 걸친 **작업 회상 대시보드(Workspace)** 로 최근 작업한 프로젝트·계획·세션 흔적을 자동으로 모아 보여주고(주말 지나 돌아왔을 때 "어디까지 했는지" 회상용), 가벼운 상태/메모를 직접 단다. 회상에서 곧바로 이어지도록 **프로젝트별 로컬 git 작업**(상태·diff·커밋 그래프·stage/commit·브랜치·merge/rebase/cherry-pick/revert·push/pull)을 Workspace 디테일 안에서 직접 수행한다(별도 앱이던 DT_GitManager를 흡수). 사용자 자신의 머신에서만 동작하며 외부로 노출되지 않는 것을 전제로 설계됐다(git 작업도 로컬 CLI 호출이며, GitHub 연동은 흡수 1차에서 제외).

설치형 NSIS 인스톨러(`Claude Harness Manager Setup x.y.z.exe`)로 배포한다. 저장소가 **public**이라 익명 자동 업데이트(electron-updater)가 가능하다 — 앱이 기동 시·"업데이트 확인" 시 GitHub 릴리스를 토큰 없이 조회해 새 버전을 **배경에서 차등 다운로드**(NSIS blockmap delta)하고, 완료되면 사이드바 배지가 **"재시작하여 적용"** 으로 바뀌어 `quitAndInstall`로 갈아끼운다(`autoInstallOnAppQuit`로 종료 시 자동 설치도 보장). 사용자는 수동 재설치를 하지 않는다. 자동 확인이 실패하면 배지가 GitHub 릴리스 페이지를 여는 fallback 링크를 제공한다. 다만 **첫 자동업데이트 릴리스인 v1.0.0은 1회 수동 설치**가 필요하다(이전 v0.4.0 설치본엔 updater가 없음).

## 명령어

단일 Electron 프로젝트(electron-vite). 모노레포가 아니다. 모든 명령은 루트에서 실행한다.

```
npm install          # 의존성 설치
npm run dev          # electron-vite dev (main/preload/renderer HMR + Electron 창)
npm run build        # typecheck + electron-vite build → out/
npm run typecheck    # tsc --noEmit (node 패스 + web 패스 2회)
npm run icon         # scripts/generate-icon.mjs → build/icon.ico·icon.png
npm run dist         # build + electron-builder --win --publish never → release/에 setup.exe + latest.yml + blockmap 생성(로컬, gh로 수동 업로드)
```

- **포트·로컬 서버 없음.** renderer ↔ main 통신은 전부 IPC다(`window.api.invoke`). dev에선 electron-vite가 renderer를 5173에 띄우지만 API 프록시는 없다.
- **린트 도구 없음**, **단위 테스트 프레임워크 없음**. 변경 검증은 `npm run typecheck`가 1차 관문, `npm run build`(esbuild 번들)가 2차다.
- **electron-builder 첫 빌드**는 winCodeSign/nsis 캐시를 받는다. Windows에서 코드서명 안 함 + 개발자 모드/관리자 권한이 없으면 winCodeSign의 macOS용 `.dylib` 심볼릭 링크 추출이 실패한다 — `~/AppData/Local/electron-builder/Cache/winCodeSign/winCodeSign-2.6.0/`에 `7za x ... '-x!darwin'`으로 darwin을 제외하고 수동 추출하면 우회된다(Windows 빌드엔 darwin 폴더가 불필요).

## 아키텍처

### 안전 모델이 이 코드베이스의 핵심

사용자의 살아있는 `~/.claude` 환경을 건드리므로, 모든 파일 변경은 다음 불변식을 통과한다. 새 기능을 추가할 때 이 경로를 우회하지 말 것.

1. **경로 allowlist** (`src/main/lib/path-guard.ts`) — 모든 파일 연산은 `guardPath()`로 경로를 resolve한 뒤 `ALLOWED_ROOTS`(`~/.claude`, `~/.claude.json`) prefix 검사를 통과해야 한다. 통과 못 하면 `PathViolationError`(403). 조회 핸들러(`/api/catalog/content` 등 경로 인자를 받는 것)도 반드시 이걸 통과한다.
2. **쓰기 직렬화** (`src/main/lib/lock.ts`) — 모든 변경 연산(`safeWrite`, archive move/restore)은 `withLock()` in-process 뮤텍스로 직렬화된다. 앱 인스턴스가 단일하다는 가정에 의존하며, `app.requestSingleInstanceLock()`이 이를 강제한다(포트 바인딩이 없으므로 이게 1차 방어, lock.ts가 2차).
3. **낙관적 동시성 + 백업** (`src/main/lib/safe-write.ts`) — 쓰기 파이프라인: 클라이언트가 보낸 `baseHash`와 현재 파일 sha256 대조(불일치 시 `ConflictError` **409**) → `validateConfig` 구조 검증 → 평문 `.bak` 백업(`BACKUP_DIR`에 20개 로테이션) → temp 파일 작성 → atomic rename.
4. **삭제 없음, 아카이브만** (`src/main/lib/archive.ts`) — 정리는 파일을 `~/.claude/archive/<날짜>/<category>/`로 **이동**하고 `manifest.json`에 기록한다. `journal.json`에 이동 전(done=false)/후(done=true)를 남겨 중단 복구를 추적. 단건 `restoreItem`으로 원위치 복원 가능. 삭제 핸들러는 의도적으로 존재하지 않는다.

쓰기 대상에는 사용자 환경 파일(settings.json 등) 외에 **앱 소유 데이터**도 있다 — Workspace의 수동 레이어 `~/.claude/harness-manager/board.json`(프로젝트: 상태·메모·이름 override(`nameOverride`)·git 저장소 경로 교정값(`repoPath`)·작업 트랙(`tracks`: 갈래별 할 일 체크리스트) / 계획: 상태·메모·계획↔프로젝트 override; `src/main/lib/board.ts`). board.json은 CC가 외부에서 재작성하지 않으므로 `baseHash` 낙관적 동시성을 쓰지 않고, `withLock` 안에서 read-modify-write 필드 머지로 lost-update만 막는다(쓰기는 동일하게 atomic rename + `.bak` 백업 통과, `validateConfig` 대신 board 전용 경량 검증). 손상 시 손상본을 옆에 백업하고 기본값으로 생존한다(페이지가 죽지 않게).

5. **git 전용 가드** (`src/main/services/git/repo-guard.ts`) — git 작업 대상은 `~/.claude` **밖**의 임의 저장소라 `guardPath`(allowlist)로는 항상 403이다. 대신 `assertGitRepo()`가 후보 경로를 절대화(빈/상대/`-`시작 거부)한 뒤 `git rev-parse --show-toplevel`로 검증해 **실제 work tree의 toplevel만** git 명령 cwd로 허용한다. 모든 `/api/git/*` 핸들러는 renderer가 보낸 경로를 직접 쓰지 않고 **projectId만** 받아 main(`services/git/index.ts`의 `resolveRepoPath`: `board.repoPath` 교정값 → recall이 transcript `cwd`에서 계산한 `realPath` → `guessOriginalPath` 순으로 후보를 만들어 `assertGitRepo` 검증)에서 해석한다. board.json 쓰기는 기존 `guardPath`+`withLock` 그대로 — 두 가드는 책임이 다르다.

### Main 프로세스 (`src/main/`, Electron + TypeScript ESM)

- 진입점 `index.ts`: `requestSingleInstanceLock`(중복 실행 차단 + `second-instance`로 기존 창 focus), `BrowserWindow`(contextIsolation, sandbox:false, preload), `setupCsp`(prod에서만), 외부 링크는 `setWindowOpenHandler`/`will-navigate`로 OS 브라우저. dev면 `loadURL`(ELECTRON_RENDERER_URL), prod면 `loadFile`.
- `ipc.ts`: **단일 채널 `api:invoke`** 디스패처가 renderer 요청을 받는다. throw 대신 `ApiResult` 봉투(`{ok:true,data}` / `{ok:false,statusCode,error}`)를 resolve해 statusCode를 무손실 전달한다(기존 Fastify setErrorHandler의 `err.statusCode ?? 500`이 여기로 들어왔다). 버전/릴리스 IPC(`app:get-version`, `app:open-releases` — `shell.openExternal`로 릴리스 페이지 오픈(자동 업데이트 실패 fallback), `app:pick-directory` — `dialog.showOpenDialog`로 git 저장소 폴더 교정)와 **자동 업데이트 IPC**(`updater:check`/`updater:quit-and-install` invoke + main이 `updater:status`로 push, `services` 아닌 `updater.ts` 위임)도 여기 등록.
- `updater.ts`: **electron-updater 배선**. `initUpdater(win)`이 `app.isPackaged`면 `autoDownload`/`autoInstallOnAppQuit`를 켜고 autoUpdater 이벤트(checking/available/not-available/download-progress/downloaded/error)를 `updater:status`로 renderer에 push, 기동 시 `checkForUpdatesAndNotify()` 1회. dev(`!app.isPackaged`)면 즉시 `idle`로 응답하고 비활성(dev는 update config 부재로 에러). `checkForUpdates`/`quitAndInstall`은 `ipc.ts`가 위임. electron-updater는 CJS라 default import 후 `{ autoUpdater }` 구조분해(번들 깨짐 우회). publish 좌표는 `package.json`의 `build.publish`(github/rafaam11) → 빌드 시 `app-update.yml`로 박힌다.
- `router.ts`: HTTP 라우트를 대체하는 **경량 라우터**. `{method, pattern, handler}[]` 테이블 + 세그먼트 매칭으로 `:name`/`:id`/`:filename` params 추출, query는 `URL.searchParams`. 핸들러는 `ctx={params,query,body}`를 받고 `reply.code(n).send({error})` 자리를 `throw new HttpError(n, msg)`로 대체한다. lib/services가 던지는 statusCode 보유 에러(path-guard 403, safe-write 409, json-validate 422, archive 404, plans 400, git repo-resolve 404)는 변환 없이 통과. git 작업은 `/api/git/*`(version/resolve/status/graph/branches/in-progress/commit[detail]/diff/commit-diff/stage/unstage/discard/commit/action/remote — 전부 projectId 기반) 라우트로 추가돼 있다. 새 엔드포인트는 이 테이블에 추가한다.
- `config.ts`: 모든 경로 상수·정책 값의 단일 출처(`ALLOWED_ROOTS`, `CONFIG_FILES`, `STALE_DAYS=30`, `AGENT_SIZE_WARN_BYTES=19KB`, `BACKUP_KEEP=20`, `TEMP_DIRS`, 그리고 Workspace용 `BOARD_FILE`, `RECALL_TAIL_BYTES=512KB`, `WORKSPACE_CACHE_TTL_MS=5s`, `PLAN_GUESS_WINDOW_MS=6h`). 포트/호스트 상수는 없다.
- `services/`: 읽기 전용 도메인 로직 — `catalog`(skills/agents/commands 프론트매터 파싱 + `readCatalogContent`로 본문·전체 프론트매터 조회), `plugins`(installed_plugins·blocklist·settings 병합), `projects`(프로젝트 디렉토리 walk·stale 계산), `scan`(정리 후보 산출), `mcp`(`~/.claude.json`의 mcpServers 파싱 — 사용자/프로젝트 스코프 모두 수용, 읽기 전용). **Workspace용 읽기 서비스**: `plans`(`~/.claude/plans` 계획 스캔·첫 `#` 헤딩 제목 파싱), `recall`(`history.jsonl` 인덱스 + 프로젝트별 최신 transcript **tail-read**(끝 512KB)로 `ai-title`·마지막 프롬프트/응답 추출 + 계획↔프로젝트 시각 상관 자동추정[sessionId→projectId 우선] + 계획 상태는 board 지정이 없으면 비보관=`완료`/보관(`_archive`)=`보관`으로 기본 추정(대부분 끝난 계획이므로; 진행중인 것만 수동 표시), 5s TTL 모듈 캐시), `tasks`(세션별 `tasks/<sessionId>/*.json` todo 조회).
- `services/git/`: **로컬 git 작업 서비스**(DT_GitManager 흡수). 시스템 `git` CLI를 직접 호출 — `GitService`(`execGit`=execFile, `resolveRepoRoot`, status 파싱)·`spawnGit`(stdin으로 commit `-F -`)·`LogService`(그래프 DAG `git log --all --topo-order`)·`DiffService`/`diffMap`(parse-diff)·`StageService`·`CommitService`·`CommitDetailService`·`BranchService`·`GraphActionsService`(checkout/merge/rebase/cherry-pick/revert/reset/tag, `--continue`류는 `GIT_EDITOR=true`로 차단)·`RemoteService`(push/pull/fetch — 진행 스트리밍/취소 제거하고 완료 대기)·`inProgress`(merge/rebase 진행 감지). `index.ts` facade가 projectId→repoPath 해석 후 각 서비스를 호출하고, `repo-guard.ts`가 경로를 검증한다. DT의 `github/`·`watcher/`(chokidar)·clone·electron-store는 1차에서 제외했다.

### Renderer (`src/renderer/src/`, React 18)

- 라우터·상태관리 라이브러리 없음. `App.tsx`가 `useState`로 탭 5개(`PAGES`)를 직접 전환한다. 테마(다크/라이트)는 `data-theme` 속성 + localStorage. 사이드바 하단에 버전 배지 + 업데이트 버튼(`components/UpdateBadge.tsx`, `window.app.onUpdaterStatus`로 main의 electron-updater 상태를 구독해 "최신/확인 중/새 버전/다운로드 %/재시작하여 적용"을 표시 — 다운로드 완료 시 클릭하면 `quitAndInstall`, 그 외엔 `checkForUpdates`, error면 `openReleases` fallback 링크).
- 런타임 의존성은 **최소를 지향하되 정당한 경우 추가**한다. 현재: 카탈로그 본문 마크다운 렌더에 `marked`, Config Editor JSON 트리/텍스트 편집에 `vanilla-jsoneditor`, git diff 파싱에 `parse-diff`(main), Git UI 아이콘에 `lucide-react`(Git 영역 한정). **zustand는 도입하지 않았다** — DT의 store 대신 Git 영역 한정 Context로 대체(아래).
- `src/api/client.ts`: `api.get/put/post` + `ApiError(status, message)` + `fmtSize`/`fmtDate`/`fmtRelative`. **공개 표면은 HTTP 시절과 동일하되 내부 전송 계층만 `window.api.invoke`로 교체됐다** — 페이지 코드는 `fetch('/api/...')`와 동일한 경로 문자열을 그대로 쓴다. main이 봉투를 resolve하면 statusCode를 복원해 `ApiError`로 던진다.
- `src/preload/index.ts`(빌드는 `src/preload`, 타입 전역은 `index.d.ts`): `contextBridge`로 `window.api`(invoke)와 `window.app`(getVersion/openReleases/openPath/pickDirectory/checkForUpdates/quitAndInstall/onUpdaterStatus — openPath는 `shell.openPath`로 프로젝트 폴더를 OS 탐색기에서 열고, pickDirectory는 git 저장소 경로 교정용 폴더 선택, updater 3종은 자동 업데이트 제어·상태 구독)을 노출.
- 페이지별 책임: `Timeline`(날짜별 세션/계획 이벤트, "N일 공백" 구분선으로 주말 갭 가시화 — 기본 진입 탭. **행 클릭 시 펼쳐** 세션은 마지막 입력/응답 스니펫, 계획은 본문 마크다운(lazy-fetch)을 보여줌), `Workspace`(작업 회상 대시보드 — **좌우 2단 마스터-디테일**: 왼쪽은 최근 활동순 프로젝트 컴팩트 카드 목록 + 맨 아래 **미연결 계획** 항목, 오른쪽은 선택된 프로젝트 상세 — 자동 회상·상태/메모·이름 변경(`nameOverride`)·폴더 열기·접이식 **트랙/할 일** 체크리스트·그 프로젝트의 **계획 목록**(컴팩트 행을 클릭하면 펼쳐 본문 마크다운·상태 변경·프로젝트 재지정; 보관 계획은 흐리게)·접이식 **메모리/파일** 브라우저(프로젝트 디렉토리 파일을 `memory` 기본·"전체 파일" 토글로 열람·내용 뷰어 — 옛 Memory 탭을 흡수). **디테일 상단 `[개요]↔[Git]` 모드 탭**: Git 모드면 디테일 영역 전체가 git 워크벤치로 변신(좌 파일목록+커밋박스 / 우 diff·그래프, 아래 Git 모드 UI 참조). 편집은 낙관적 업데이트→실패 시 재동기화, 텍스트는 blur 저장·구조 변경(추가/삭제/토글)은 즉시 저장. 타입·이름 헬퍼는 `pages/workspace-shared.ts`에서 Timeline과 공유. Workspace 탭만 `App.tsx`에서 `main.page-wide`로 전체 너비를 쓴다), `Catalog`(종류별 카드 블럭 + 단일 인라인 확장 — skill/agent/command 본문 마크다운·프론트매터, MCP 연결설정·시크릿 마스킹, plugin 상태; 모두 읽기 전용), `Cleanup`(스캔→체크박스 선택→**dry-run 먼저**→실행→manifest 복구), `ConfigEditor`(settings JSON을 `vanilla-jsoneditor` 트리/텍스트 에디터로 편집 — 저장·백업·409 충돌 로직 유지).
- **Git 모드 UI** (`pages/git/`, DT_GitManager 흡수): Workspace 디테일의 `[Git]` 탭이 마운트하는 `GitPanel`이 먼저 `/api/git/resolve`로 repoPath를 확인하고(실패 시 폴더 선택으로 `board.repoPath` 교정), 성공하면 `GitProvider`로 워크벤치를 감싼다. **DT의 zustand store 3개(repo/changes/graph)를 단일 `GitContext.tsx`의 `useGit()` Context로 합쳤다** — `GitPanel`이 프로젝트별로 재마운트되므로(상위 `ProjectDetail`이 `key={projectId}`) DT의 store reset/`loadedRepoId` 분기가 불필요해지고, 빠른 클릭 race만 seq ref로 막는다. 실시간 watcher가 없으므로 각 mutation 뒤 `refreshStatus`+`loadGraph`(+`refreshInProgress`)를 호출하고 창 포커스/visibility 복귀 시에도 갱신한다. `GitWorkbench`(리사이즈 사이드바 + Changes/History + remote 바)·`ChangesSidebar`/`FileSection`/`CommitBox`·`GraphSidebar`/`GraphSvg`/`CommitContextMenu`/`InProgressBanner`·`CommitDetail`/`DiffViewer`/`BranchSwitcher`·다이얼로그(`Confirm`/`Prompt`)가 모두 `useGit()`을 소비한다. 순수 그래프 유틸(`graphLayout`/`graphMetrics`/`headAncestors`/`relativeTime`/`initialsAvatar`)은 `src/renderer/src/git/`. git UI CSS는 `index.css`의 `.git-panel` 스코프에서 DT 변수(`--text-dim`/`--hover`/`--shadow` 등)를 harness 토큰으로 별칭 정의해 전역 충돌(특히 `--shadow` 의미 차이)을 가린다.

### IPC 계약 (`src/shared/types.ts`)

main과 preload/renderer가 함께 import하는 단일 출처(`@shared` alias). `ApiRequest`(method/url/body), `ApiResult` 봉투, `IpcChannels` 상수, `RendererApi`/`AppApi`(`pickDirectory` 포함). git 도메인 타입은 분량상 `src/shared/git-types.ts`로 분리해 `types.ts`가 re-export하며, renderer↔main 계약이 router 단일 채널이라 요청 타입은 DT의 `repoId` 대신 **`projectId` 기반**이다.

### 설정 파일 정책 (`CONFIG_FILES`)

- `settings.json`, `settings.local.json`은 **편집 가능**(`writable: true`), `~/.claude.json`은 **읽기 전용**(Claude Code가 상시 재작성하므로 충돌 방지 — 수동 절차로만 수정). 쓰기 핸들러는 `writable: false`면 403. MCP 서버 정의도 `~/.claude.json`에 있으므로 **조회만** 하고 토글/편집은 제공하지 않는다.
- 검증은 `lib/json-validate.ts`의 수동 구조 검사다. **공개 schemastore 스키마를 쓰지 않는다** — 이 환경 settings.json은 최상위에 env성 키(`MAX_THINKING_TOKENS` 등)가 있어 공개 스키마와 불일치. 목적은 "CC 기동을 깨뜨리는 저장 차단"(파싱 가능 + 핵심 키 타입 보존)뿐이다.

## 코드 규약 / 주의점

- **ESM + `.js` 확장자**: lib/services의 상대 임포트는 NodeNext 시절의 `.js` 확장자를 유지한다(소스가 `.ts`여도 `from "./config.js"`). tsconfig는 `moduleResolution: Bundler`라 타입체크가 통과하고 esbuild가 번들 시 resolve한다 — 임의로 떼지 말 것.
- **main 의존성은 `dependencies`에**: `gray-matter`·`parse-diff`는 `externalizeDepsPlugin`으로 external 처리되어 asar의 node_modules에서 require된다(둘 다 main에서 쓰므로 반드시 `dependencies`). devDependencies로 옮기면 패키징 시 빠진다. (`lucide-react`는 renderer 번들에 포함되므로 위치 무관하지만 일관성상 `dependencies`.)
- **플랫폼 분기 코드**: `cc-detect.ts`는 `process.platform`으로 Windows는 `tasklist`(claude.exe), macOS/Linux는 `pgrep -x claude`로 CC 프로세스를 감지한다. `projects.ts`의 `guessOriginalPath`는 여전히 Windows 드라이브 경로 전용 — flatten된 디렉토리명(`D--hdx-agv`)을 `D:\hdx\agv`로 역추정하고(구분자 `-`/이름 `-` 구별 불가 → 추정값), 비-Windows 이름은 `null`. (배포 타깃은 Windows NSIS다.)
- 코드 주석·식별자는 한국어 도메인 용어를 사용하는 기존 스타일을 유지한다.
- `cleanup/execute`는 `category === "warn-only"` 항목 이동을 거부한다(대형 에이전트 경고는 표시용이지 이동 후보가 아님).
- MCP 시크릿(env/headers)은 main이 값을 그대로 내려보내고 **renderer에서 마스킹+토글**한다(로컬 단독 전제). 마스킹을 우회해 로그/터미널에 값을 노출하지 말 것.
- **배포(자동 업데이트 + 수동 업로드)**: 저장소가 public이라 electron-updater 자동 업데이트를 쓴다(`build.publish`는 github/rafaam11). 빌드는 로컬에서 `npm run dist`(= `electron-builder --win --publish never`)로 돌려 `release/`에 **3종 산출물** — `Claude Harness Manager Setup x.y.z.exe`, `latest.yml`(updater가 읽는 버전 매니페스트), `*.blockmap`(차등 다운로드용) — 을 만든 뒤 GitHub 릴리스에 **3종 모두 수동 업로드**한다(`gh release create vX.Y.Z "release/...Setup x.y.z.exe" release/latest.yml release/*.blockmap`). `latest.yml`/`blockmap`을 빠뜨리면 설치된 앱의 자동 확인이 동작하지 않는다. 받는 앱은 토큰 없이 릴리스를 익명 조회해 새 버전을 배경 다운로드하고 "재시작하여 적용"으로 갈아끼운다. 코드서명이 없어 설치 시 SmartScreen 경고가 뜬다(추가 정보 → 실행). **첫 updater 릴리스 v1.0.0은 1회 수동 설치 필요**(이전 v0.4.0엔 updater 부재). dev에선 `app.isPackaged=false`라 updater가 비활성(`dev-app-update.yml`은 dev 테스트용 좌표).
