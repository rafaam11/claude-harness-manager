# 다크/라이트 테마 + 가시성 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 하네스 매니저 웹 대시보드에 다크/라이트 테마 토글을 추가하고, 다크 테마의 대비·카드 위계·여백을 높여 가시성을 개선한다.

**Architecture:** 모든 색을 `index.css`의 CSS 변수(토큰)로 통일하고 `:root`(다크) + `:root[data-theme="light"]`(라이트) 두 세트로 정의한다. `App.tsx`가 테마 상태를 `localStorage`와 `<html data-theme>`에 반영하고, nav 제목 옆 아이콘 버튼으로 토글한다. 페이지 컴포넌트는 테마를 모른다(className만 사용하는 기존 구조 유지).

**Tech Stack:** React 18 + Vite + 순수 CSS 변수. 추가 의존성 없음.

**참고 스펙:** `docs/superpowers/specs/2026-06-11-ui-theme-visibility-design.md` (색상 팔레트 표 포함)

**검증 노트:** 이 저장소엔 단위 테스트가 없다. 각 Task는 `npm run typecheck -w web`(타입/빌드 안전)과 브라우저 육안 확인으로 검증한다. dev 서버는 `npm run dev`(또는 런처 exe)로 띄운다.

---

### Task 1: index.css — 토큰화 + 라이트 세트 + 가시성 조정

현재 `web/src/index.css`는 다크 하드코딩이다. 파일 **전체를 아래 내용으로 교체**한다(토큰 추출 + 라이트 override + 카드/숫자/경고/active 조정 일괄).

**Files:**
- Modify(전체 교체): `web/src/index.css`

- [ ] **Step 1: index.css를 아래 내용으로 전체 교체**

```css
:root {
  /* 코어 토큰 (다크 = 기본) */
  --bg: #0f1318;
  --panel: #171b22;
  --card: #1c2230;
  --border: #313742;
  --text: #f3f5f9;
  --muted: #9aa3b2;
  --accent: #e8825f;
  --active-bg: #222834;
  --editor-bg: #0b0e12;
  --shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
  --on-accent: #fff;
  /* 상태색 토큰 */
  --ok: #5fb878;
  --ok-bg: #1d3324;
  --warn: #f0a73c;
  --warn-bg: #2a2117;
  --warn-border: #5a4423;
  --err: #e25d5d;
  --err-bg: #3a1f1f;
  font-family: "Segoe UI", "Malgun Gothic", sans-serif;
}

:root[data-theme="light"] {
  --bg: #ffffff;
  --panel: #f7f8fa;
  --card: #f7f8fa;
  --border: #e2e5ea;
  --text: #1c2026;
  --muted: #6b7280;
  --accent: #c75f3f;
  --active-bg: #eceef2;
  --editor-bg: #f4f5f7;
  --shadow: 0 1px 2px rgba(20, 30, 40, 0.05);
  --on-accent: #fff;
  --ok: #2e7d4f;
  --ok-bg: #e8f5ec;
  --warn: #b8791a;
  --warn-bg: #fdf4e3;
  --warn-border: #f0dcae;
  --err: #c0392b;
  --err-bg: #fdecea;
}

* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  transition: background-color 0.15s ease, color 0.15s ease;
}

.layout { display: flex; min-height: 100vh; }
nav {
  width: 200px; background: var(--panel); border-right: 1px solid var(--border);
  padding: 16px 0; flex-shrink: 0;
}
.nav-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 16px 12px;
}
.nav-head h1 { font-size: 15px; margin: 0; color: var(--accent); }
.theme-toggle {
  width: 26px; height: 26px; flex-shrink: 0; display: inline-flex;
  align-items: center; justify-content: center; cursor: pointer;
  background: var(--active-bg); border: 1px solid var(--border);
  border-radius: 6px; color: var(--text); font-size: 13px; line-height: 1;
}
.theme-toggle:hover { border-color: var(--accent); }
nav button.nav-item {
  display: block; width: 100%; text-align: left; padding: 9px 16px;
  background: none; border: none; color: var(--muted); font-size: 14px; cursor: pointer;
}
nav button.nav-item.active {
  color: var(--text); background: var(--active-bg);
  border-left: 3px solid var(--accent); padding-left: 13px;
}
nav button.nav-item:hover { color: var(--text); }

main { flex: 1; padding: 24px; max-width: 1100px; }
h2 { font-size: 18px; margin: 0 0 16px; }
h3 { font-size: 15px; margin: 20px 0 8px; }

table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--border); }
th { color: var(--muted); font-weight: 500; }
td.num { text-align: right; font-variant-numeric: tabular-nums; }

.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 14px; }
.card {
  background: var(--card); border: 1px solid var(--border); border-radius: 9px;
  padding: 16px; box-shadow: var(--shadow);
}
.card .label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }
.card .value { font-size: 35px; font-weight: 800; line-height: 1.05; margin-top: 4px; }
.card.warn { background: var(--warn-bg); border-color: var(--warn-border); }
.card.warn .label { color: var(--warn); }
.card.warn .value { color: var(--warn); }

.banner { padding: 10px 14px; border-radius: 6px; margin-bottom: 14px; font-size: 13px; }
.banner.warn { background: var(--warn-bg); border: 1px solid var(--warn); }
.banner.err { background: var(--err-bg); border: 1px solid var(--err); }
.banner.ok { background: var(--ok-bg); border: 1px solid var(--ok); }

textarea.editor {
  width: 100%; min-height: 480px; background: var(--editor-bg); color: var(--text);
  border: 1px solid var(--border); border-radius: 6px; padding: 12px;
  font-family: Consolas, monospace; font-size: 13px; line-height: 1.5; resize: vertical;
}

button.btn {
  background: var(--accent); color: var(--on-accent); border: none; border-radius: 6px;
  padding: 8px 16px; font-size: 13px; cursor: pointer; margin-right: 8px;
}
button.btn:disabled { opacity: 0.45; cursor: default; }
button.btn.ghost { background: transparent; border: 1px solid var(--border); color: var(--text); }
button.btn.danger { background: var(--err); }

.tag { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 11px; }
.tag.ok { background: var(--ok-bg); color: var(--ok); }
.tag.warn { background: var(--warn-bg); color: var(--warn); }
.tag.muted { background: var(--active-bg); color: var(--muted); }

.mono { font-family: Consolas, monospace; font-size: 12px; }
.muted { color: var(--muted); }
pre.viewer {
  background: var(--editor-bg); border: 1px solid var(--border); border-radius: 6px;
  padding: 12px; font-size: 12px; max-height: 420px; overflow: auto; white-space: pre-wrap;
}
```

> 변경 요지: ① 하드코딩 색(`#262a31`, `#0f1114`, `#3a2e1a`, `#1d3324`, `#3a1f1f`, `#fff`)을 토큰으로 추출 ② `[data-theme="light"]` 세트 추가 ③ 카드 `box-shadow`/radius 9px/padding 16px ④ `.card .value` 35px·800 ⑤ 경고 카드 배경색 구분 ⑥ nav active를 `border-left`로 + `.nav-item` 클래스 도입(Task 2와 짝) ⑦ `.nav-head`/`.theme-toggle` 추가.

- [ ] **Step 2: 타입/빌드 확인**

Run: `npm run typecheck -w web`
Expected: 에러 없이 통과(CSS는 타입 영향 없음 — 빌드가 깨지지 않음만 확인).

- [ ] **Step 3: 커밋**

```bash
git add web/src/index.css
git commit -m "style(web): tokenize colors, add light theme set, boost dark visibility"
```

---

### Task 2: App.tsx — 테마 상태 + 토글 아이콘 버튼

nav 버튼에 `.nav-item` 클래스를 부여하고(Task 1 CSS와 짝), 제목 옆에 ☀/🌙 토글 버튼을 추가한다. 테마는 `localStorage`에 저장하고 `<html data-theme>`로 반영한다.

**Files:**
- Modify: `web/src/App.tsx`

- [ ] **Step 1: App.tsx를 아래 내용으로 전체 교체**

```tsx
import { useEffect, useState } from "react";
import { api } from "./api/client";
import Overview from "./pages/Overview";
import Catalog from "./pages/Catalog";
import Memory from "./pages/Memory";
import Cleanup from "./pages/Cleanup";
import ConfigEditor from "./pages/ConfigEditor";

const PAGES = {
  overview: { label: "Overview", el: <Overview /> },
  catalog: { label: "Catalog", el: <Catalog /> },
  memory: { label: "Memory", el: <Memory /> },
  cleanup: { label: "Cleanup", el: <Cleanup /> },
  configs: { label: "Config Editor", el: <ConfigEditor /> },
} as const;

type PageKey = keyof typeof PAGES;
type Theme = "dark" | "light";

export default function App() {
  const [page, setPage] = useState<PageKey>("overview");
  const [ccRunning, setCcRunning] = useState(false);
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("hm-theme") as Theme) || "dark",
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("hm-theme", theme);
  }, [theme]);

  useEffect(() => {
    const check = () =>
      api
        .get<{ running: boolean }>("/api/cc-status")
        .then((s) => setCcRunning(s.running))
        .catch(() => {});
    check();
    const t = setInterval(check, 10000);
    return () => clearInterval(t);
  }, []);

  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");

  return (
    <div className="layout">
      <nav>
        <div className="nav-head">
          <h1>Harness Manager</h1>
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            title={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
            aria-label={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
          >
            {theme === "dark" ? "☀" : "🌙"}
          </button>
        </div>
        {(Object.keys(PAGES) as PageKey[]).map((k) => (
          <button
            key={k}
            className={`nav-item${page === k ? " active" : ""}`}
            onClick={() => setPage(k)}
          >
            {PAGES[k].label}
          </button>
        ))}
      </nav>
      <main>
        {ccRunning && (
          <div className="banner warn">
            Claude Code 세션이 실행 중입니다 — 설정 저장·정리 실행 시 충돌에 주의하세요.
          </div>
        )}
        {PAGES[page].el}
      </main>
    </div>
  );
}
```

> 변경 요지: ① `theme` 상태 + `localStorage("hm-theme")` 초기화 ② `useEffect`로 `data-theme`/저장 동기화 ③ 제목을 `.nav-head`로 감싸고 토글 버튼 추가 ④ 페이지 버튼 className에 `nav-item` 추가(active는 `nav-item active`). 기존 cc-status 폴링 로직은 그대로.

- [ ] **Step 2: 타입 확인**

Run: `npm run typecheck -w web`
Expected: 통과(`Theme` 유니온, className 모두 정상).

- [ ] **Step 3: 동작 확인**

`npm run dev` 후 http://127.0.0.1:5173 에서:
- nav 제목 옆 아이콘 클릭 → 다크↔라이트 즉시 전환.
- 새로고침 후에도 마지막 테마 유지(localStorage).
- nav active 항목이 좌측 강조선으로 표시.

- [ ] **Step 4: 커밋**

```bash
git add web/src/App.tsx
git commit -m "feat(web): add dark/light theme toggle in nav"
```

---

### Task 3: index.html — 초기 테마 FOUC 방지

라이트 사용자가 새로고침 시 다크로 한 번 깜빡이는 것을 막기 위해, 앱 로드 전에 `data-theme`를 즉시 설정한다.

**Files:**
- Modify: `web/index.html`

- [ ] **Step 1: `</head>` 직전에 인라인 스크립트 추가**

`web/index.html`의 `<head>` 안, `</head>` 바로 위에 아래를 삽입:

```html
    <script>
      (function () {
        try {
          var t = localStorage.getItem("hm-theme");
          if (t) document.documentElement.setAttribute("data-theme", t);
        } catch (e) {}
      })();
    </script>
```

삽입 후 `<head>`는 다음과 같다:

```html
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Claude Harness Manager</title>
    <script>
      (function () {
        try {
          var t = localStorage.getItem("hm-theme");
          if (t) document.documentElement.setAttribute("data-theme", t);
        } catch (e) {}
      })();
    </script>
  </head>
```

- [ ] **Step 2: 확인**

`npm run dev` 후 라이트로 전환 → 새로고침 시 다크 깜빡임 없이 라이트로 바로 뜨는지 확인.

- [ ] **Step 3: 커밋**

```bash
git add web/index.html
git commit -m "fix(web): set theme before paint to avoid FOUC"
```

---

### Task 4: 통합 검증 (양 테마 × 전체 페이지)

**Files:** 없음(검증 전용, 문제 발견 시 Task 1~3 수정).

- [ ] **Step 1: dev 서버 기동**

`npm run dev` (또는 루트 `HarnessManagerLauncher.exe`로 [시작]).

- [ ] **Step 2: 두 테마 × 5개 페이지 육안 확인**

각 페이지를 다크/라이트 모두에서 확인. 깨진 색(하드코딩 잔존), 대비 부족, 읽기 불가 영역이 없어야 한다:
- **Overview** — 카드 숫자 35px 위계, 경고 카드 색 배경, 라이트에서 카드 그림자.
- **Catalog** — 테이블·태그(ok/warn/muted) 색.
- **Memory** — `pre.viewer` 배경이 테마 따라 변하는지.
- **Cleanup** — 배너(warn/ok/err), `.btn.danger`, 태그.
- **Config Editor** — `textarea.editor` 배경/글자색이 테마 따라 변하는지.

- [ ] **Step 3: (선택) e2e 스모크로 스크린샷 캡처**

`python e2e-check.py` (dev 서버가 떠 있어야 함) → `e2e-overview.png` 등으로 렌더 확인. 콘솔 에러 "없음"인지 확인.

- [ ] **Step 4: 문제 없으면 종료, 있으면 해당 Task 파일 수정 후 재커밋**

발견된 잔존 하드코딩/대비 문제를 `index.css`에서 토큰으로 마저 고치고:

```bash
git add web/src/index.css
git commit -m "style(web): fix leftover hardcoded colors found in review"
```

---

## Self-Review (작성자 점검 결과)

- **스펙 커버리지:** 가시성 A(Task1 카드/대비/여백)·숫자 35px(Task1 `.card .value`)·라이트 뉴트럴(Task1 `[data-theme=light]`)·토글 아이콘(Task2)·localStorage(Task2)·하드코딩 토큰화(Task1)·FOUC(Task3)·양 테마 검증(Task4) — 스펙 요구사항 모두 대응됨.
- **Placeholder 스캔:** 모든 코드 스텝에 완전한 코드 포함, TBD/“적절히 처리” 없음.
- **타입/이름 일관성:** `Theme` 유니온, `hm-theme` 키, `data-theme` 속성, `.nav-item`/`.theme-toggle`/`.nav-head` 클래스가 Task 1(CSS)과 Task 2(JSX)에서 동일하게 사용됨.
