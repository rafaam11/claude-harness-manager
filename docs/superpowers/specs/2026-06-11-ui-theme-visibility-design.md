# 하네스 매니저 웹 UI — 다크/라이트 테마 + 가시성 개선 설계

작성일: 2026-06-11
상태: 설계 확정(비주얼 브레인스토밍 완료), 구현 계획 대기

## Context

harness-manager 웹 대시보드(React)의 UI를 다듬는다. 기능에는 만족하나 두 가지가 부족하다:
1. **테마 선택지 없음** — `web/src/index.css`가 다크 테마 하드코딩.
2. **가시성 부족** — 본문/보조 텍스트 대비가 약하고, 카드 경계가 흐릿하며, 숫자(핵심 지표)의 시각적 위계가 약하다.

비주얼 컴패니언으로 Overview 화면을 목업 비교하며 방향을 확정했다. 아래는 그 결과다.

## 확정된 디자인 결정

| 항목 | 결정 | 근거(브레인스토밍) |
|---|---|---|
| 가시성 방향 | 개선안 A (대비·위계·여백 강화) | 현재 vs 개선안 비교에서 A 선택 |
| 숫자 위계 | 카드 값 **35px / weight 800** | 32 vs 38 비교 후 중간(35px) |
| 라이트 테마 | **뉴트럴 화이트** (순백 바탕) | 웜/뉴트럴/쿨 비교에서 뉴트럴 선택 |
| 테마 토글 | nav 제목 옆 **아이콘 버튼** (☀/🌙) | 세그먼트/아이콘/텍스트 비교에서 아이콘 |
| 토글 동작 | 클릭 즉시 전환, `localStorage`로 유지 | — |
| 강조색(accent) | 테라코타 유지, 테마별 명도 조정 | — |

## 색상 팔레트 (CSS 변수 토큰)

테마는 `:root`(다크 기본) + `:root[data-theme="light"]`(라이트 override) 두 세트로 정의한다. 가시성 개선을 위해 **다크 값도 기존보다 대비를 높여 조정**한다.

### 코어 토큰

| 토큰 | 다크 (개선) | 기존 다크 | 라이트 (뉴트럴) |
|---|---|---|---|
| `--bg` | `#0f1318` | #14161a | `#ffffff` |
| `--panel` | `#171b22` | #1d2026 | `#f7f8fa` |
| `--card` | `#1c2230` | (=panel) | `#f7f8fa` |
| `--border` | `#313742` | #2e323a | `#e2e5ea` |
| `--text` | `#f3f5f9` | #d7dae0 | `#1c2026` |
| `--muted` | `#9aa3b2` | #8b909a | `#6b7280` |
| `--accent` | `#e8825f` | #d97757 | `#c75f3f` |
| `--active-bg` | `#222834` | #262a31 | `#eceef2` |
| `--editor-bg` | `#0b0e12` | #0f1114 | `#f4f5f7` |
| `--shadow` | `0 1px 3px rgba(0,0,0,.4)` | (없음) | `0 1px 2px rgba(20,30,40,.05)` |

### 상태색 토큰 (배너·태그·경고 카드)

현재 하드코딩된 배너/태그 배경(`#3a2e1a`, `#1d3324`, `#3a1f1f`, `#262a31` 등)을 토큰으로 추출한다.

| 토큰 | 다크 | 라이트 |
|---|---|---|
| `--ok` / `--ok-bg` | `#5fb878` / `#1d3324` | `#2e7d4f` / `#e8f5ec` |
| `--warn` / `--warn-bg` | `#f0a73c` / `#2a2117` | `#b8791a` / `#fdf4e3` |
| `--err` / `--err-bg` | `#e25d5d` / `#3a1f1f` | `#c0392b` / `#fdecea` |
| 경고 카드 border | `#5a4423` | `#f0dcae` |

## 구현 영역

### 1. `web/src/index.css` (주 작업)
- **토큰 정리**: 현재 `:root`의 변수를 위 팔레트로 확장하고, 본문에 하드코딩된 색(`#262a31`, `#0f1114`, `#3a2e1a`, `#1d3324`, `#3a1f1f`, `color:#fff` 등)을 전부 `var(--...)`로 치환한다.
- **라이트 세트 추가**: `:root[data-theme="light"] { ... }`에 라이트 값 override.
- **가시성 조정**:
  - `.card` — `box-shadow: var(--shadow)`, `border`를 `--border`로 또렷하게, padding 소폭 확대.
  - `.card .value` — `font-size: 35px; font-weight: 800; line-height: 1.05;`(기존 24px).
  - `.card .label` — `text-transform: uppercase; letter-spacing: .5px;` 유지·소형.
  - `.cards` gap 소폭 확대.
  - 경고 카드(`.card.warn`)는 `--warn-bg`/경고 border로 배경째 구분.
  - `nav button.active` — 강조선을 `border-left: 3px solid var(--accent)`로(현재 border-right). 본문 `--text` 밝기 상향.
  - `textarea.editor`, `pre.viewer` 배경을 `--editor-bg` 토큰으로.
- **전역 전환**: `body`에 `transition: background-color .15s, color .15s` 정도로 토글 시 부드럽게(과하지 않게).

### 2. `web/src/App.tsx` (토글 상태)
- `useState<"dark"|"light">`로 테마 상태. 초기값은 `localStorage.getItem("hm-theme")`, 없으면 `"dark"`.
- `useEffect`로 `document.documentElement.setAttribute("data-theme", theme)` + `localStorage.setItem`.
- nav `<h1>Harness Manager</h1>` 옆에 토글 아이콘 버튼(☀/🌙) 추가. 현재 테마에 따라 아이콘/`aria-label` 전환.

### 3. `web/index.html` (선택 — FOUC 방지)
- 초기 로드 시 라이트인데 다크로 깜빡이는 것을 막으려면, `<head>`에 인라인 스크립트로 `localStorage` 값을 읽어 `data-theme`를 즉시 설정. 사소하면 생략 가능(기본 다크라 영향 적음).

## 재사용 / 따를 패턴
- 기존 변수 명명(`--bg`, `--panel`, `--accent`, `--ok/warn/err`)을 그대로 확장 — 새 네이밍 도입 최소화.
- 색은 모두 컴포넌트가 아니라 `index.css` 토큰에서만 관리(페이지 .tsx는 className만 사용하는 현 구조 유지).
- 토글 상태는 App.tsx 한 곳 — 페이지 컴포넌트는 테마를 모름.

## 검증
1. `npm run dev` 후 토글 클릭 → 다크↔라이트 즉시 전환, 새로고침/재실행 후에도 선택 유지(localStorage).
2. 5개 페이지(Overview·Catalog·Memory·Cleanup·ConfigEditor) 각각 **두 테마 모두**에서 색 깨짐·대비 부족·읽기 불가 영역 없는지 육안 확인.
3. 라이트에서 배너(ok/warn/err)·태그·경고 카드·에디터/뷰어 배경이 모두 라이트 톤으로 바뀌는지(하드코딩 잔존 색 없는지) 확인.
4. Overview 카드 숫자가 35px/800으로 위계가 살아있는지 확인.
5. (선택) `e2e-check.py`로 양 테마 스크린샷 캡처해 비교.

## 범위 밖
- 레이아웃/내비게이션 구조 변경 없음 — 색·대비·위계·토글에 집중.
- 컴포넌트 분해/리팩토링 없음.
- 시스템 테마(`prefers-color-scheme`) 자동 추종은 이번 범위 밖(기본 다크 + 수동 토글). 추후 옵션.
