# 카탈로그 블럭화 + MCP 서버 (1단계) 설계

> 상태: 브레인스토밍 확정안. 구현 플랜(writing-plans) 입력.
> 날짜: 2026-06-11

## Context

harness-manager 웹 대시보드는 현재 `.claude` 폴더 정보를 테이블로 "나열"하는 수준이다.
특히 `Catalog`/`Overview`는 순수 읽기 테이블이고, MCP 서버는 백엔드에서 전혀 다루지 않는다.
사용자는 이를 더 기능적이고 보기 좋은 UI로 확장하길 원한다.

전체 작업은 **2트랙 단계적**으로 진행한다.
- **1단계 (이 문서):** 카탈로그 블럭화 + MCP 서버 — 둘 다 "블럭 리스트 + 인라인 상세" 동일 패턴 공유. **전체 읽기 전용.**
- **2단계 (별도):** JSON 편집 강화(ConfigEditor, CodeMirror 도입). 이 문서 범위 밖.

목표: Catalog를 카드 블럭 + 클릭 시 인라인 상세(프론트매터·본문)로 바꾸고, MCP 서버를 같은 화면에 통합해 조회·상세를 제공한다.

## 확정 디자인 결정 (비주얼 브레인스토밍 결과)

| 항목 | 결정 |
|---|---|
| 리스트 레이아웃 | **종류별 그룹 + 카드** — Skills / Agents / Commands / MCP Servers 섹션, 각 섹션에 카드 그리드 |
| 상세 보기 배치 | **인라인 확장(아코디언)** — 카드를 클릭하면 그 자리에서 펼쳐짐 (한 번에 하나만) |
| 상세 본문 | **마크다운 렌더** — 프론트매터 표 + 경로 + 메타(크기/수정일) + 렌더된 본문 |
| MCP 통합 | 카탈로그의 "MCP Servers" 섹션으로 합류. 본문 대신 **연결 설정**(stdio: command/args/env · http/sse: url/headers) 표시 |
| MCP 시크릿 | **마스킹 + 보기 토글** — env/header 값은 기본 `••••`, 눈 아이콘 클릭 시 표시 |
| MCP 활성 | **읽기 전용(표시만). 토글/편집 없음** — 끄려면 `~/.claude.json` 쓰기가 필요한데, 이 앱은 그 파일을 의도적으로 읽기 전용으로 두므로 제외(조사 결과 §미해결 참조) |
| 카탈로그 항목 편집 | 없음. Skill/Agent/Command는 **조회 + 상세(read-only)** 만 |

## 화면 구성

- `Catalog` 페이지를 4개 섹션(Skills / Agents / Commands / MCP Servers)으로 재구성. 각 섹션 헤더에 개수 표시.
- 카드: 타입 배지 + 이름 + 설명(1~2줄 clamp) + 메타(크기·수정일·경고). MCP 카드는 타입 태그(stdio/http) + 상태 표시(읽기 전용).
- 카드 클릭 → 인라인 확장. 한 번에 하나만 펼치는 단일 확장(기존 펼친 항목은 접힘).
- 확장 상세:
  - **Skill/Agent/Command:** 경로(mono) · 메타 · 프론트매터 표(전체 키-값) · 본문(마크다운 렌더).
  - **MCP:** 출처(.claude.json) · 연결 설정 표 · env/headers(마스킹+토글). **쓰기 액션 없음.**

## 데이터 / 백엔드 변경 (server/) — 전부 읽기 전용

ESM + NodeNext 규약 유지(상대 임포트 `.js` 확장자). 새 엔드포인트는 `routes/index.ts`에 등록,
로직은 `services/`(조회)에 둔다. **이번 단계는 쓰기 라우트를 추가하지 않는다.**

1. **catalog 서비스 확장** (`services/catalog.ts`)
   - 현재 프론트매터 `description` 하나만 추출 → **gray-matter `data` 객체 전체**를 반환하도록 확장(`frontmatter: Record<string, unknown>`).
   - 기존 `CatalogItem` 필드(name/kind/description/path/size/mtime/warn)는 유지(하위 호환).

2. **본문 조회 API (신규, 읽기)**
   - `GET /api/catalog/content?path=<절대경로>` → `{ raw, frontmatter, size, mtime }`.
   - 경로는 반드시 `guardPath()` 통과(ALLOWED_ROOTS = ~/.claude). 위반 시 403.
   - 대용량 방어: 기존 `readProjectFile`의 2MB→256KB truncate 패턴 재사용.

3. **MCP 서비스 (신규, 읽기)** (`services/mcp.ts`)
   - `~/.claude.json`을 읽어 `mcpServers` 정의를 항목 배열로 산출:
     `{ name, scope, transport: "stdio"|"http"|"sse", command?, args?, env?, url?, headers? }`.
   - **저장 위치 확인 필요:** 사용자 스코프 MCP가 최상위 `mcpServers`인지 `projects.<path>.mcpServers`인지는
     실제 파일 구조를 보고 확정(구현 플랜 1번 작업). 둘 다 수용하도록 파싱.
   - `.claude.json`은 **읽기만**(읽기 전용 정책 불변).
   - `GET /api/mcp` → 위 배열. env/headers 값은 그대로 포함(로컬 전용, 마스킹은 프론트). 보안 노트 참조.

## 프론트엔드 변경 (web/)

- `pages/Catalog.tsx` 재작성: 테이블 → 섹션 + 카드 + 인라인 확장.
- 공통 컴포넌트 신설: `CatalogBlock`(카드), `BlockDetail`(확장 상세). MCP는 `BlockDetail`의 변형(본문 대신 설정 표).
- **마크다운 렌더러 도입**: 경량 라이브러리(예: `marked`) — JSON 에디터의 CodeMirror와 동일하게 "의존성 최소" 규약의 의도적 예외.
  렌더 입력은 로컬 ~/.claude 파일이나, 안전하게 기본 sanitize 적용.
- `api/client.ts`: 신규 읽기 엔드포인트 호출 추가(본문 조회, MCP 목록).
- 시크릿 마스킹/보기 토글은 클라이언트 상태로 처리.

## 안전 모델 준수

- **1단계는 쓰기 작업이 전혀 없다.** 본문 조회·MCP 조회 모두 읽기 전용.
- 경로 인자는 전부 `guardPath()` 통과.
- `.claude.json`은 읽기만(읽기 전용 정책 불변). safe-write/archive 경로는 건드리지 않음.

## 보안 노트 — MCP 시크릿

- "보기 토글"을 지원하려면 서버가 env/header **실제 값**을 클라이언트로 보내야 한다.
  127.0.0.1 바인드 + 로컬 단독 사용 전제이므로 허용 가능한 트레이드오프로 본다.
- 기본 표시는 항상 마스킹(`••••`). 사용자가 명시적으로 토글해야 노출.

## 미해결 → 해소 / 잔여

1. ~~MCP 활성/비활성 토글 메커니즘~~ → **해소.** 조사 결과: settings.json만으로 사용자 스코프 MCP를 토글할 수
   없고 `~/.claude.json`의 `disabledMcpServers` 배열을 직접 써야 함. 이 앱의 `.claude.json` 읽기 전용 정책과
   충돌하므로 **토글은 1단계에서 제외(read-only 확정).**
2. **MCP 도구(tools) 개수 표시.** 정적 `.claude.json` 정의에는 tools 목록이 없다(런타임 연결 시 확인).
   1단계에서는 표시 보류.
3. **MCP 저장 위치**(최상위 vs projects별)는 구현 첫 작업에서 실제 파일로 확정.

## 범위 밖 (1단계)

- 2단계: JSON 편집 강화(ConfigEditor + CodeMirror).
- 카탈로그/메모리 검색·필터·정렬, Overview 카드 클릭 이동.
- 카탈로그 파일 편집·삭제, MCP 활성 토글/편집.
- 테마(이미 구현 완료).

## 검증

- `npm run typecheck` (server + web) — 1차 관문.
- `npm run dev` 후 수동 확인: 4개 섹션 렌더, 카드 인라인 확장, 본문 마크다운 렌더,
  MCP 연결 설정·시크릿 마스킹/토글 표시(쓰기 없음).
- `python e2e-check.py` 스모크(탭 순회 + 콘솔 에러 수집).
