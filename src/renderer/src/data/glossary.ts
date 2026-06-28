import type { LucideIcon } from "lucide-react";
import {
  LayoutPanelLeft,
  Component,
  Palette,
  MessageSquare,
  BrainCircuit,
  Code2,
  Database,
  GitBranch,
  PackageOpen,
} from "lucide-react";

// 바이브코딩 용어집 — 순수 정적 표시 데이터(renderer 직접 번들). IPC/main 불필요.
// 3단계 트리: 대분류(domain) > 소분류(subcat) > 용어(term). domain은 데이터에 저장하지 않고
// SUBCAT_META[subcat].domain에서 도출한다(비정규화 방지).

export type DomainId = "ui" | "ai" | "dev" | "collab";
export type SubcatId =
  | "layout" // 화면 골격·배치
  | "component" // 개별 위젯/컨트롤
  | "style" // 색·여백·모션·CSS 개념
  | "prompt" // AI 지시문·예시·기법
  | "model" // 모델 특성·한도·동작
  | "concept" // 일반 코딩 개념
  | "data" // 데이터 모양·저장·구조
  | "git" // 버전 관리 워크플로
  | "ops"; // 빌드·배포·환경·도구 연결

export interface GlossaryTerm {
  id: string; // slug, 안정 키 (React key + 펼침 Set 키 겸용)
  term: string; // 영어 원어 — AI에 그대로 입력 (예: "Modal")
  termKo: string; // 한국어 병기 (예: "모달"). 빈 문자열 허용
  subcat: SubcatId;
  definition: string; // 한 줄 정의(한국어) — 행에 항상 노출
  detail?: string; // 펼침 상세(한국어)
  example?: string; // 초보자용 예시 프롬프트(한국어)
  aliases?: string[]; // 검색·추천 감지용 한글 동의어/영문 변형 (표시 X)
  sketchId?: string; // 미니 SVG 스케치 참조 (layout/component만)
}

export const DOMAIN_META: Record<DomainId, { label: string; icon: LucideIcon }> = {
  ui: { label: "화면 UI", icon: LayoutPanelLeft },
  ai: { label: "AI 활용", icon: MessageSquare },
  dev: { label: "개발 기초", icon: Code2 },
  collab: { label: "도구·협업", icon: GitBranch },
};

export const DOMAIN_ORDER: DomainId[] = ["ui", "ai", "dev", "collab"];

// 소분류 메타: 소속 대분류 + 라벨 + lucide 아이콘 + 배지 클래스(.bdg-g-*).
export const SUBCAT_META: Record<
  SubcatId,
  { domain: DomainId; label: string; icon: LucideIcon; badge: string }
> = {
  layout: { domain: "ui", label: "레이아웃", icon: LayoutPanelLeft, badge: "bdg-g-layout" },
  component: { domain: "ui", label: "UI 요소", icon: Component, badge: "bdg-g-component" },
  style: { domain: "ui", label: "스타일·상호작용", icon: Palette, badge: "bdg-g-style" },
  prompt: { domain: "ai", label: "프롬프트 작성", icon: MessageSquare, badge: "bdg-g-prompt" },
  model: { domain: "ai", label: "컨텍스트·모델", icon: BrainCircuit, badge: "bdg-g-model" },
  concept: { domain: "dev", label: "기본 개념", icon: Code2, badge: "bdg-g-dev" },
  data: { domain: "dev", label: "데이터·구조", icon: Database, badge: "bdg-g-data" },
  git: { domain: "collab", label: "버전 관리", icon: GitBranch, badge: "bdg-g-git" },
  ops: { domain: "collab", label: "빌드·배포·환경", icon: PackageOpen, badge: "bdg-g-ops" },
};

export const SUBCAT_ORDER: SubcatId[] = [
  "layout",
  "component",
  "style",
  "prompt",
  "model",
  "concept",
  "data",
  "git",
  "ops",
];

// 대분류별 소분류 묶음(트리 렌더 편의) — SUBCAT_ORDER에서 파생.
export const SUBCATS_BY_DOMAIN: Record<DomainId, SubcatId[]> = DOMAIN_ORDER.reduce(
  (acc, d) => {
    acc[d] = SUBCAT_ORDER.filter((s) => SUBCAT_META[s].domain === d);
    return acc;
  },
  {} as Record<DomainId, SubcatId[]>,
);

// subcat → "대분류 > 소분류" 경로 문자열 (breadcrumb). glossary/lite 공용.
export function breadcrumbOf(subcat: SubcatId): string {
  const m = SUBCAT_META[subcat];
  return `${DOMAIN_META[m.domain].label} > ${m.label}`;
}

export const GLOSSARY: GlossaryTerm[] = [
  // ── 화면 UI > 레이아웃 (layout) ──────────────────────
  {
    id: "header",
    term: "Header",
    termKo: "헤더",
    subcat: "layout",
    definition: "화면 맨 위에 고정되는 영역. 로고·제목·주요 메뉴가 들어간다.",
    detail:
      "거의 모든 페이지 상단에 공통으로 들어가는 띠. 그 안에 메뉴 모음을 넣으면 그 메뉴 부분을 '내비게이션 바(Navbar)'라고 부른다.",
    example: "로고를 왼쪽에, 로그인 버튼을 오른쪽에 둔 상단 헤더를 만들어줘.",
    aliases: ["상단", "상단바", "머리말", "top bar"],
    sketchId: "header",
  },
  {
    id: "navbar",
    term: "Navbar",
    termKo: "내비게이션 바",
    subcat: "layout",
    definition: "페이지를 이동하는 메뉴 링크들을 한 줄로 모아둔 막대.",
    detail:
      "보통 헤더 안에 가로로 배치된다. 화면이 좁아지면 메뉴를 '햄버거 메뉴(Hamburger Menu)' 아이콘 속으로 접어 넣는다.",
    example: "홈·소개·연락처 링크가 있는 가로 내비게이션 바를 상단에 만들어줘.",
    aliases: ["내비바", "메뉴바", "navigation", "nav", "네비게이션"],
    sketchId: "navbar",
  },
  {
    id: "sidebar",
    term: "Sidebar",
    termKo: "사이드바",
    subcat: "layout",
    definition: "화면 왼쪽이나 오른쪽에 세로로 붙는 보조 메뉴/패널 영역.",
    detail:
      "내비게이션이나 필터를 세로로 길게 담는다. 좁은 화면에선 평소엔 숨겼다가 버튼으로 밀어서 여는 'drawer(서랍)' 형태로 만들기도 한다.",
    example: "왼쪽에 메뉴 항목들이 세로로 나열된 사이드바를 만들어줘.",
    aliases: ["측면", "옆 메뉴", "사이드 메뉴", "side panel", "drawer"],
    sketchId: "sidebar",
  },
  {
    id: "hero",
    term: "Hero Section",
    termKo: "히어로 섹션",
    subcat: "layout",
    definition: "페이지 맨 위, 큰 제목·이미지·버튼으로 첫인상을 주는 넓은 영역.",
    detail:
      "랜딩 페이지에서 방문자가 가장 먼저 보는 큰 배너. 보통 한 줄 슬로건 + 설명 + '시작하기' 같은 핵심 버튼(CTA)으로 구성한다.",
    example: "큰 제목과 '시작하기' 버튼이 있는 히어로 섹션을 페이지 맨 위에 만들어줘.",
    aliases: ["대문", "배너", "메인 배너", "jumbotron", "히어로"],
    sketchId: "hero",
  },
  {
    id: "footer",
    term: "Footer",
    termKo: "푸터",
    subcat: "layout",
    definition: "화면 맨 아래 영역. 저작권·링크·연락처 등을 담는다.",
    detail:
      "헤더의 반대편. 회사 정보, 약관 링크, SNS 아이콘 등 부차적이지만 매 페이지에 있어야 하는 내용을 모은다.",
    example: "저작권 문구와 SNS 아이콘이 있는 푸터를 화면 맨 아래에 만들어줘.",
    aliases: ["하단", "바닥글", "맨 아래", "bottom"],
    sketchId: "footer",
  },
  {
    id: "hamburger-menu",
    term: "Hamburger Menu",
    termKo: "햄버거 메뉴",
    subcat: "layout",
    definition: "가로줄 세 개(☰) 모양 버튼. 누르면 숨겨둔 메뉴가 펼쳐진다.",
    detail:
      "모바일처럼 좁은 화면에서 메뉴를 접어 넣을 때 쓴다. 세 줄이 햄버거 같다고 이 이름이 붙었다.",
    example: "모바일에서 누르면 메뉴가 펼쳐지는 햄버거 메뉴 버튼을 오른쪽 위에 만들어줘.",
    aliases: ["햄버거", "세 줄 메뉴", "☰", "menu icon"],
    sketchId: "hamburger-menu",
  },
  {
    id: "grid",
    term: "Grid",
    termKo: "그리드",
    subcat: "layout",
    definition: "내용을 바둑판처럼 행과 열로 가지런히 배치하는 격자 레이아웃.",
    detail:
      "상품 목록, 사진첩처럼 같은 모양의 카드를 여러 줄로 정렬할 때 쓴다. 화면 너비에 따라 열 개수를 바꾸면 '반응형(Responsive)' 그리드가 된다.",
    example: "상품 카드를 한 줄에 3개씩 그리드로 배치해줘.",
    aliases: ["격자", "바둑판", "그리드 레이아웃"],
    sketchId: "grid",
  },
  {
    id: "card",
    term: "Card",
    termKo: "카드",
    subcat: "layout",
    definition: "이미지·제목·설명을 한 덩어리로 묶은 네모난 상자 단위.",
    detail:
      "상품, 게시글, 프로필처럼 '하나의 항목'을 보기 좋게 묶는 기본 단위. 보통 그림자나 테두리로 배경과 구분한다.",
    example: "사진·제목·설명·버튼이 들어간 상품 카드를 만들어줘.",
    aliases: ["카드뷰", "박스", "타일", "tile"],
    sketchId: "card",
  },
  {
    id: "layout",
    term: "Layout",
    termKo: "레이아웃",
    subcat: "layout",
    definition: "화면 안에서 요소들을 어디에 어떻게 배치할지 정한 전체 골격.",
    detail:
      "헤더·본문·사이드바·푸터를 어떤 위치에 둘지 정하는 큰 틀. '2단 레이아웃', '좌측 사이드바 레이아웃'처럼 구조를 말로 지정하면 좋다.",
    example: "왼쪽 사이드바, 오른쪽 본문으로 나뉜 2단 레이아웃으로 만들어줘.",
    aliases: ["배치", "구조", "화면 구성", "골격"],
  },
  {
    id: "responsive",
    term: "Responsive",
    termKo: "반응형",
    subcat: "layout",
    definition: "화면 크기(PC·태블릿·폰)에 맞춰 배치가 자동으로 바뀌는 방식.",
    detail:
      "넓은 화면에선 가로로 펼치고 좁은 화면에선 세로로 쌓는 식으로 적응한다. '모바일에서도 잘 보이게'라는 요청이 곧 반응형이다.",
    example: "이 페이지를 모바일에서도 깨지지 않게 반응형으로 만들어줘.",
    aliases: ["반응형 디자인", "모바일 대응", "responsive design", "adaptive"],
  },

  // ── 화면 UI > UI 요소 (component) ─────────────────────
  {
    id: "modal",
    term: "Modal",
    termKo: "모달",
    subcat: "component",
    definition: "화면 위에 떠서 배경을 어둡게 가리는 팝업 창. 닫기 전까지 다른 조작을 막는다.",
    detail:
      "로그인·확인·설정처럼 '지금 이걸 먼저 처리하라'는 흐름에 쓴다. 배경 클릭이나 X로 닫는다. 배경을 안 막는 비슷한 건 '팝오버(Popover)'.",
    example: "삭제 버튼을 누르면 '정말 삭제할까요?' 확인 모달을 띄워줘.",
    aliases: ["팝업", "대화상자", "다이얼로그", "popup", "dialog"],
    sketchId: "modal",
  },
  {
    id: "breadcrumb",
    term: "Breadcrumb",
    termKo: "이동 경로",
    subcat: "component",
    definition: "'홈 > 카테고리 > 상품'처럼 현재 위치를 단계별로 보여주는 작은 경로 표시.",
    detail:
      "지금 사이트의 어디에 있는지, 어디서 왔는지 알려준다. 각 단계를 누르면 상위로 돌아갈 수 있다. 헨젤과 그레텔의 빵 부스러기에서 따온 이름이다.",
    example: "페이지 상단에 '홈 > 게시판 > 글쓰기' 형태의 이동 경로를 넣어줘.",
    aliases: ["경로", "빵부스러기", "위치 표시", "breadcrumbs"],
    sketchId: "breadcrumb",
  },
  {
    id: "tooltip",
    term: "Tooltip",
    termKo: "툴팁",
    subcat: "component",
    definition: "요소에 마우스를 올리면 잠깐 뜨는 작은 설명 말풍선.",
    detail:
      "아이콘 버튼처럼 뜻이 헷갈리는 것에 짧은 힌트를 줄 때 쓴다. 클릭이 아니라 '올렸을 때'만 나타나고 떼면 사라진다.",
    example: "이 아이콘 버튼에 마우스를 올리면 '저장'이라고 알려주는 툴팁을 달아줘.",
    aliases: ["말풍선", "힌트", "설명 풍선", "hint"],
    sketchId: "tooltip",
  },
  {
    id: "accordion",
    term: "Accordion",
    termKo: "아코디언",
    subcat: "component",
    definition: "제목을 누르면 그 아래 내용이 접혔다 펼쳐지는 목록.",
    detail:
      "FAQ(자주 묻는 질문)처럼 제목만 죽 보여주다가 누른 항목만 펼쳐 보여줄 때 쓴다. 아코디언 악기가 접혔다 펴지는 모습에서 따왔다.",
    example: "질문을 누르면 답변이 펼쳐지는 FAQ 아코디언을 만들어줘.",
    aliases: ["접이식", "펼침 목록", "collapse", "foldable", "토글 목록"],
    sketchId: "accordion",
  },
  {
    id: "dropdown",
    term: "Dropdown",
    termKo: "드롭다운",
    subcat: "component",
    definition: "누르면 아래로 목록이 펼쳐져 그중 하나를 고르는 메뉴.",
    detail:
      "여러 선택지 중 하나를 고를 때 자리를 아낀다. 글자를 입력하며 거르는 형태는 '콤보박스(Combobox)', 단순 선택은 'Select'라고도 부른다.",
    example: "국가를 고를 수 있는 드롭다운 메뉴를 만들어줘.",
    aliases: ["드롭다운 메뉴", "선택 메뉴", "select", "콤보박스", "펼침 메뉴"],
    sketchId: "dropdown",
  },
  {
    id: "tab",
    term: "Tab",
    termKo: "탭",
    subcat: "component",
    definition: "여러 화면을 제목 버튼으로 전환하는 가로 메뉴. 한 번에 하나만 보인다.",
    detail:
      "같은 공간에서 '개요 / 리뷰 / 문의'처럼 내용을 갈아끼울 때 쓴다. 브라우저 위쪽 탭과 같은 개념이다.",
    example: "'설명·리뷰·배송' 세 개의 탭으로 내용을 전환하게 만들어줘.",
    aliases: ["탭 메뉴", "탭바", "tabs", "탭 전환"],
    sketchId: "tab",
  },
  {
    id: "badge",
    term: "Badge",
    termKo: "배지",
    subcat: "component",
    definition: "아이콘이나 항목 위에 붙는 작은 숫자·점 표시(예: 알림 개수).",
    detail:
      "'새 알림 3개'처럼 상태를 작게 강조한다. 메뉴 항목 옆 'NEW' 라벨, 장바구니 아이콘 위 숫자가 대표적이다.",
    example: "알림 아이콘 위에 안 읽은 개수를 빨간 배지로 표시해줘.",
    aliases: ["뱃지", "라벨", "알림 점", "카운트", "label"],
    sketchId: "badge",
  },
  {
    id: "toast",
    term: "Toast",
    termKo: "토스트 알림",
    subcat: "component",
    definition: "화면 구석에 잠깐 떴다가 스르륵 사라지는 짧은 알림 메시지.",
    detail:
      "'저장되었습니다' 같은 결과를 방해 없이 알릴 때 쓴다. 토스트가 튀어 오르듯 나타난다고 이 이름이 붙었다. 사용자의 확인을 강제하지 않는다.",
    example: "저장에 성공하면 '저장 완료' 토스트를 화면 아래에 잠깐 띄워줘.",
    aliases: ["스낵바", "알림 메시지", "snackbar", "notification", "토스트"],
    sketchId: "toast",
  },
  {
    id: "carousel",
    term: "Carousel",
    termKo: "캐러셀",
    subcat: "component",
    definition: "이미지/카드를 좌우로 한 장씩 넘겨 보는 슬라이드.",
    detail:
      "배너나 추천 상품을 자동 또는 화살표로 넘기며 보여준다. '슬라이더'라고도 한다. 회전목마(carousel)처럼 돈다고 붙은 이름.",
    example: "메인 배너 이미지를 좌우로 넘길 수 있는 캐러셀로 만들어줘.",
    aliases: ["슬라이더", "슬라이드", "회전 배너", "slider", "슬라이드쇼"],
    sketchId: "carousel",
  },
  {
    id: "pagination",
    term: "Pagination",
    termKo: "페이지네이션",
    subcat: "component",
    definition: "긴 목록을 여러 페이지로 나누고 '1 2 3 …' 번호로 이동하게 하는 장치.",
    detail:
      "게시판처럼 항목이 많을 때 페이지를 쪼갠다. 끝까지 스크롤하면 자동으로 더 불러오는 방식은 '무한 스크롤(Infinite scroll)'이라 다르게 부른다.",
    example: "게시글 목록을 한 페이지에 10개씩 보여주고 아래에 페이지 번호를 달아줘.",
    aliases: ["페이지 번호", "페이징", "paging", "페이지 나누기"],
    sketchId: "pagination",
  },
  {
    id: "skeleton",
    term: "Skeleton",
    termKo: "스켈레톤",
    subcat: "component",
    definition: "내용을 불러오는 동안 회색 뼈대 모양으로 미리 보여주는 로딩 자리표시.",
    detail:
      "빈 화면 대신 글/이미지가 들어올 자리를 회색 막대로 보여줘 '곧 뜬다'는 느낌을 준다. 빙글 도는 '스피너'보다 답답함이 덜하다.",
    example: "데이터를 불러오는 동안 카드 자리에 스켈레톤 로딩을 보여줘.",
    aliases: ["스켈레톤 로딩", "로딩 자리표시", "skeleton loader", "placeholder loading"],
    sketchId: "skeleton",
  },
  {
    id: "placeholder",
    term: "Placeholder",
    termKo: "플레이스홀더",
    subcat: "component",
    definition: "입력칸이 비었을 때 옅게 보이는 안내 문구(예: '이메일을 입력하세요').",
    detail:
      "무엇을 적어야 하는지 예시로 알려준다. 입력을 시작하면 사라진다. 칸 위에 항상 떠 있는 '라벨(Label)'과는 다르다.",
    example: "이메일 입력칸에 'you@example.com' 플레이스홀더를 넣어줘.",
    aliases: ["입력 힌트", "안내 문구", "예시 문구", "hint text"],
    sketchId: "placeholder",
  },

  // ── AI 활용 > 프롬프트 작성 (prompt) ──────────────────
  {
    id: "prompt",
    term: "Prompt",
    termKo: "프롬프트",
    subcat: "prompt",
    definition: "AI에게 무엇을 해달라고 적어 보내는 지시문/요청문.",
    detail:
      "구체적일수록 결과가 좋아진다. '무엇을, 어떤 형식으로, 어떤 조건에서'를 함께 적는 것이 핵심이다. 바이브코딩은 이 프롬프트를 잘 쓰는 일이다.",
    example: "로그인 폼을 만들어줘 — 이메일·비밀번호 칸과 파란 로그인 버튼 포함.",
    aliases: ["지시문", "요청문", "명령어", "질문", "instruction"],
  },
  {
    id: "system-prompt",
    term: "System Prompt",
    termKo: "시스템 프롬프트",
    subcat: "prompt",
    definition: "AI의 역할·말투·규칙을 미리 정해두는 밑바탕 지시문.",
    detail:
      "'너는 친절한 한국어 교사야' 같이 대화 전체에 깔리는 설정이다. 매 요청마다 반복하지 않아도 계속 적용된다.",
    example: "시스템 프롬프트로 '항상 한국어로, 초보자 눈높이로 설명'을 설정해줘.",
    aliases: ["시스템 메시지", "역할 지정", "system message", "persona"],
  },
  {
    id: "few-shot",
    term: "Few-shot",
    termKo: "퓨샷 예시",
    subcat: "prompt",
    definition: "원하는 결과의 예시 몇 개를 함께 보여줘 형식을 따라 하게 하는 방법.",
    detail:
      "'이런 입력엔 이런 출력'을 2~3개 보여주면 AI가 패턴을 흉내 낸다. 예시 없이 말로만 시키는 건 '제로샷(Zero-shot)'이라고 한다.",
    example: "예시 두 개를 줄 테니 같은 형식으로 나머지도 만들어줘.",
    aliases: ["예시 제공", "few shot", "fewshot", "예제 학습"],
  },
  {
    id: "chain-of-thought",
    term: "Chain-of-thought",
    termKo: "생각의 사슬",
    subcat: "prompt",
    definition: "답을 바로 내지 말고 단계별로 생각을 적어가며 풀게 하는 기법.",
    detail:
      "'차근차근 단계별로 생각해줘'를 붙이면 복잡한 추론·계산의 정확도가 올라간다. 과정을 보여주니 어디서 틀렸는지 점검도 쉽다.",
    example: "이 문제를 단계별로 생각하면서(chain-of-thought) 풀이 과정을 보여줘.",
    aliases: ["단계별 사고", "차근차근 생각", "cot", "생각의 사슬", "사고의 연쇄"],
  },
  {
    id: "zero-shot",
    term: "Zero-shot",
    termKo: "제로샷",
    subcat: "prompt",
    definition: "예시를 주지 않고 지시만으로 시키는 방식.",
    detail:
      "예시 몇 개를 주는 '퓨샷(Few-shot)'의 반대. 간단한 작업엔 충분하지만, 형식이 까다로우면 퓨샷이 더 안정적이다.",
    example: "예시 없이 바로(zero-shot) 이 문장의 감정을 긍정/부정으로 분류해줘.",
    aliases: ["예시 없이", "제로샷", "zero shot", "zeroshot"],
  },
  {
    id: "rag",
    term: "RAG",
    termKo: "검색 증강 생성",
    subcat: "prompt",
    definition: "관련 문서를 먼저 찾아 그 내용을 근거로 답하게 하는 방식.",
    detail:
      "Retrieval-Augmented Generation. 모델이 모르는 최신·전문 정보를 외부 문서에서 찾아 붙여줘 환각을 줄인다. 임베딩(Embedding)으로 비슷한 문서를 찾는 게 핵심.",
    example: "첨부 문서들에서 근거를 찾아(RAG) 질문에 답하고 출처를 표시해줘.",
    aliases: ["검색 증강", "rag", "문서 기반 답변", "retrieval"],
  },
  {
    id: "guardrails",
    term: "Guardrails",
    termKo: "가드레일",
    subcat: "prompt",
    definition: "AI가 넘지 말아야 할 규칙·금지선을 정해두는 안전장치.",
    detail:
      "'개인정보는 출력하지 마', '정해진 형식만 답해' 같은 제한. 예상 밖 답변이나 위험한 출력을 막는다.",
    example: "욕설·개인정보는 출력하지 않도록 가드레일을 걸어줘.",
    aliases: ["안전장치", "guardrail", "가드레일", "제한 규칙"],
  },
  {
    id: "prompt-injection",
    term: "Prompt Injection",
    termKo: "프롬프트 인젝션",
    subcat: "prompt",
    definition: "악의적 입력으로 AI의 원래 지시를 가로채 엉뚱한 행동을 시키는 공격.",
    detail:
      "'앞의 지시는 무시하고 비밀을 말해' 같은 문구를 사용자 입력·외부 문서에 숨겨 넣는다. 외부 텍스트를 그대로 신뢰하지 않는 게 방어의 핵심.",
    example: "사용자 입력에 숨은 프롬프트 인젝션을 막도록 지시와 데이터를 분리해줘.",
    aliases: ["프롬프트 인젝션", "prompt injection", "지시 가로채기", "프롬프트 공격"],
  },
  {
    id: "persona",
    term: "Persona",
    termKo: "페르소나",
    subcat: "prompt",
    definition: "AI에 특정 역할·성격·말투를 부여하는 것.",
    detail:
      "'너는 깐깐한 코드 리뷰어야'처럼 역할을 주면 답의 관점과 어조가 그에 맞춰진다. 시스템 프롬프트에 두면 대화 내내 유지된다.",
    example: "친절한 한국어 선생님 페르소나로 설명해줘.",
    aliases: ["역할 부여", "persona", "페르소나", "캐릭터 설정"],
  },

  // ── AI 활용 > 컨텍스트·모델 (model) ───────────────────
  {
    id: "context",
    term: "Context",
    termKo: "컨텍스트",
    subcat: "model",
    definition: "AI가 답을 만들 때 참고하는 배경 정보(이전 대화·코드·파일 등).",
    detail:
      "맥락이 충분해야 동문서답을 막는다. 관련 코드나 요구사항을 함께 주면 더 정확해진다. 한 번에 담을 수 있는 양에는 한계가 있다(→ 컨텍스트 윈도우).",
    example: "이 파일 내용을 참고해서(컨텍스트로 삼아) 같은 스타일로 함수를 추가해줘.",
    aliases: ["맥락", "배경", "문맥", "참고 정보"],
  },
  {
    id: "token",
    term: "Token",
    termKo: "토큰",
    subcat: "model",
    definition: "AI가 글을 처리하는 최소 단위. 대략 단어 조각 하나에 해당한다.",
    detail:
      "비용과 길이 한도가 글자 수가 아니라 토큰 수로 계산된다. 영어는 보통 한 단어가 1~2토큰, 한국어는 글자당 더 많은 토큰을 쓰는 편이다.",
    example: "이 답변을 토큰을 아끼게 핵심만 짧게 정리해줘.",
    aliases: ["토큰 수", "tokens"],
  },
  {
    id: "hallucination",
    term: "Hallucination",
    termKo: "환각",
    subcat: "model",
    definition: "AI가 사실이 아닌 내용을 그럴듯하게 지어내는 현상.",
    detail:
      "존재하지 않는 함수, 틀린 인용을 자신 있게 말할 수 있다. 중요한 정보는 항상 직접 확인해야 한다. 근거 자료를 함께 주면 줄어든다.",
    example: "추측하지 말고, 확실하지 않으면 '모른다'고 답해줘.",
    aliases: ["환각 현상", "거짓 생성", "할루시네이션", "made up"],
  },
  {
    id: "temperature",
    term: "Temperature",
    termKo: "온도",
    subcat: "model",
    definition: "AI 답변의 무작위성/창의성 정도를 조절하는 값. 낮으면 일관, 높으면 다양.",
    detail:
      "0에 가까우면 매번 비슷하고 안정적인 답, 높이면 더 자유롭고 변화 많은 답이 나온다. 코드·사실엔 낮게, 아이디어 발상엔 높게 쓰는 편이다.",
    example: "정확한 답이 필요하니 온도를 낮게 설정해서 답해줘.",
    aliases: ["temperature", "창의성", "무작위성", "랜덤성"],
  },
  {
    id: "context-window",
    term: "Context Window",
    termKo: "컨텍스트 윈도우",
    subcat: "model",
    definition: "AI가 한 번에 기억하고 참고할 수 있는 최대 글 분량(토큰 한도).",
    detail:
      "이 한도를 넘으면 앞부분 내용을 잊는다. 긴 대화나 큰 파일을 다룰 땐 핵심만 추려 주는 게 좋다. 창(window) 크기에 비유한 말이다.",
    example: "대화가 길어졌으니 지금까지 핵심만 요약해서 컨텍스트를 줄여줘.",
    aliases: ["컨텍스트 길이", "context length", "기억 한도", "토큰 한도"],
  },
  {
    id: "fine-tuning",
    term: "Fine-tuning",
    termKo: "파인튜닝",
    subcat: "model",
    definition: "기존 AI 모델을 특정 데이터로 추가 학습시켜 용도에 맞게 다듬는 것.",
    detail:
      "회사 말투나 전문 분야에 특화시킬 때 쓴다. 프롬프트만으로 부족할 때 고려한다. 비용과 데이터가 필요해 초보 단계에선 보통 프롬프트로 해결한다.",
    example: "(참고) 우리 도메인에 맞추려면 파인튜닝이 필요한지 판단해줘.",
    aliases: ["미세조정", "추가 학습", "finetuning", "fine tune"],
  },
  {
    id: "embedding",
    term: "Embedding",
    termKo: "임베딩",
    subcat: "model",
    definition: "글·이미지의 의미를 숫자 목록(벡터)으로 바꾼 표현. 의미 비교·검색에 쓴다.",
    detail:
      "비슷한 뜻의 문장은 비슷한 숫자가 된다. 이를 이용해 '의미가 가까운 문서 찾기'(검색·추천)를 한다. 검색형 AI(RAG)의 핵심 재료다.",
    example: "문서들을 임베딩해서 질문과 의미가 비슷한 문단을 찾아줘.",
    aliases: ["벡터", "embedding", "의미 벡터", "벡터화"],
  },
  {
    id: "agent",
    term: "Agent",
    termKo: "에이전트",
    subcat: "model",
    definition: "스스로 도구를 골라 쓰며 여러 단계를 거쳐 목표를 수행하는 AI.",
    detail:
      "한 번 답하고 끝이 아니라 '검색→실행→확인'을 반복한다. Claude Code도 파일을 읽고 고치는 코딩 에이전트다.",
    example: "이 작업을 끝까지 스스로 처리하는 에이전트처럼 진행해줘.",
    aliases: ["에이전트", "agent", "자동 수행", "ai 에이전트"],
  },
  {
    id: "function-calling",
    term: "Function Calling",
    termKo: "함수 호출",
    subcat: "model",
    definition: "AI가 정해진 함수·도구를 골라 호출하도록 하는 기능.",
    detail:
      "AI가 직접 코드를 실행하는 게 아니라 '이 함수를 이 인자로 부르겠다'는 요청을 내고 앱이 실행해 결과를 돌려준다. 도구 사용(tool use)의 토대.",
    example: "날씨 조회 함수를 정의하고 함수 호출(function calling)로 오늘 기온을 받아줘.",
    aliases: ["함수 호출", "function calling", "툴 콜", "도구 호출", "tool use"],
  },
  {
    id: "multimodal",
    term: "Multimodal",
    termKo: "멀티모달",
    subcat: "model",
    definition: "글뿐 아니라 이미지·음성·영상 등 여러 형태를 함께 다루는 모델.",
    detail:
      "스크린샷을 보고 설명하거나 그림을 읽어 코드로 옮기는 일이 가능하다. 'multi(여러) + modal(형태)'.",
    example: "이 화면 스크린샷을 보고(멀티모달) 같은 UI를 코드로 만들어줘.",
    aliases: ["멀티모달", "multimodal", "이미지 입력", "그림 이해"],
  },
  {
    id: "vector-db",
    term: "Vector DB",
    termKo: "벡터 데이터베이스",
    subcat: "model",
    definition: "임베딩(의미 벡터)을 저장하고 비슷한 것을 빠르게 찾는 데이터베이스.",
    detail:
      "RAG에서 '질문과 의미가 가까운 문서'를 찾는 저장소다. Pinecone·pgvector 등이 있다.",
    example: "문서 임베딩을 벡터 DB에 저장하고 유사 문서를 검색해줘.",
    aliases: ["벡터 디비", "vector db", "벡터 데이터베이스", "벡터 저장소", "pinecone"],
  },

  // ── 개발 기초 > 기본 개념 (concept) ───────────────────
  {
    id: "api",
    term: "API",
    termKo: "에이피아이",
    subcat: "concept",
    definition: "프로그램끼리 데이터를 주고받기 위해 정해둔 약속/창구.",
    detail:
      "식당의 메뉴판에 비유된다 — 무엇을 요청하면 무엇을 돌려주는지 정해져 있다. '날씨 API를 불러와' = 외부 서비스에 데이터를 요청한다는 뜻.",
    example: "날씨 API에서 오늘 기온을 받아와 화면에 표시해줘.",
    aliases: ["에이피아이", "인터페이스", "연동", "endpoint", "api 호출"],
  },
  {
    id: "variable",
    term: "Variable",
    termKo: "변수",
    subcat: "concept",
    definition: "값을 담아두고 이름으로 꺼내 쓰는 저장 공간.",
    detail:
      "'사용자 이름', '총합'처럼 바뀔 수 있는 값을 이름표 붙여 보관한다. 한 번 정하면 안 바뀌는 값은 '상수(Constant)'라고 한다.",
    example: "합계를 'total'이라는 변수에 담아서 계산해줘.",
    aliases: ["변수명", "값", "variable", "상수"],
  },
  {
    id: "function",
    term: "Function",
    termKo: "함수",
    subcat: "concept",
    definition: "특정 작업을 묶어 이름 붙여둔 명령 덩어리. 필요할 때 불러 재사용한다.",
    detail:
      "'입력을 받아 → 처리 → 결과를 돌려주는' 작은 기계. 같은 일을 여러 번 할 때 한 번 만들어 두고 부른다.",
    example: "두 숫자를 더해 돌려주는 함수를 만들어줘.",
    aliases: ["메서드", "function", "method", "기능 함수"],
  },
  {
    id: "framework",
    term: "Framework",
    termKo: "프레임워크",
    subcat: "concept",
    definition: "앱을 빠르게 만들도록 뼈대와 규칙을 미리 갖춰둔 개발 도구 모음.",
    detail:
      "빈 땅이 아니라 골조가 세워진 집에서 시작하는 셈. React, Next.js 등이 대표적이다. 더 작은 부품 묶음은 '라이브러리(Library)'라 부른다.",
    example: "React 프레임워크로 이 화면을 만들어줘.",
    aliases: ["프레임웍", "framework", "개발 틀"],
  },
  {
    id: "library",
    term: "Library",
    termKo: "라이브러리",
    subcat: "concept",
    definition: "이미 만들어진 기능을 가져다 쓰는 코드 묶음(부품 상자).",
    detail:
      "날짜 처리, 차트 그리기처럼 흔한 기능을 직접 안 짜고 빌려 쓴다. 프레임워크가 '집 골조'라면 라이브러리는 '필요할 때 꺼내는 도구'에 가깝다.",
    example: "차트 라이브러리를 써서 막대그래프를 그려줘.",
    aliases: ["라이브러리", "패키지", "library", "package", "모듈"],
  },
  {
    id: "frontend",
    term: "Frontend",
    termKo: "프론트엔드",
    subcat: "concept",
    definition: "사용자가 눈으로 보고 직접 만지는 화면 쪽 부분.",
    detail:
      "버튼·글자·색처럼 '보이는 모든 것'. 화면 뒤에서 데이터를 처리·저장하는 부분은 '백엔드(Backend)'다. 둘이 데이터를 주고받으며 동작한다.",
    example: "이건 프론트엔드 화면만 먼저 만들어줘. 데이터 연결은 나중에 할게.",
    aliases: ["프론트", "클라이언트", "frontend", "화면단", "UI단"],
  },
  {
    id: "backend",
    term: "Backend",
    termKo: "백엔드",
    subcat: "concept",
    definition: "화면 뒤에서 데이터 저장·계산·인증을 담당하는 서버 쪽 부분.",
    detail:
      "사용자에겐 안 보이지만 로그인 확인, 데이터베이스 읽기/쓰기 같은 핵심 일을 한다. 보이는 화면(프론트엔드)의 요청을 받아 처리해 돌려준다.",
    example: "로그인 정보를 확인하는 백엔드 처리를 추가해줘.",
    aliases: ["백엔드", "서버", "server", "backend", "서버단"],
  },
  {
    id: "state",
    term: "State",
    termKo: "상태",
    subcat: "concept",
    definition: "화면이 기억하는 현재 값(예: 입력한 글자, 켜짐/꺼짐, 선택한 항목).",
    detail:
      "상태가 바뀌면 화면도 따라 바뀐다. '로그인됨/안 됨', '다크 모드 켜짐'처럼 지금 어떤지를 담는다. React 등에서 핵심 개념이다.",
    example: "체크박스를 켜고 끄는 상태를 만들어 화면에 반영해줘.",
    aliases: ["상태값", "state", "현재 상태"],
  },
  {
    id: "bug",
    term: "Bug",
    termKo: "버그",
    subcat: "concept",
    definition: "프로그램이 의도와 다르게 동작하는 오류/결함.",
    detail:
      "버튼이 안 눌리거나 값이 틀리게 나오는 것 등. 원인을 찾아 고치는 일을 '디버깅(Debugging)'이라 한다.",
    example: "버튼을 눌러도 반응이 없는 버그가 있어 — 원인을 찾아 고쳐줘.",
    aliases: ["오류", "에러", "결함", "bug", "디버깅"],
  },
  {
    id: "refactoring",
    term: "Refactoring",
    termKo: "리팩터링",
    subcat: "concept",
    definition: "동작은 그대로 두고 코드 구조만 더 깔끔하게 정리하는 작업.",
    detail:
      "겉보기 기능은 안 바뀌지만 읽기 쉽고 고치기 편해진다. 어질러진 방을 기능 변화 없이 정돈하는 것과 같다.",
    example: "기능은 그대로 두고 이 함수를 더 읽기 쉽게 리팩터링해줘.",
    aliases: ["리팩토링", "코드 정리", "refactor", "구조 개선"],
  },

  // ── 개발 기초 > 데이터·구조 (data) ────────────────────
  {
    id: "database",
    term: "Database",
    termKo: "데이터베이스",
    subcat: "data",
    definition: "데이터를 체계적으로 저장하고 꺼내 쓰는 보관소.",
    detail:
      "회원 정보, 게시글처럼 오래 남겨야 할 데이터를 표(테이블) 형태 등으로 저장한다. 흔히 'DB'라고 줄여 부른다.",
    example: "작성한 글을 데이터베이스에 저장하고 목록으로 불러와줘.",
    aliases: ["DB", "디비", "database", "저장소", "데이터 저장"],
  },

  // ── 도구·협업 > 버전 관리 (git) ───────────────────────
  {
    id: "commit",
    term: "Commit",
    termKo: "커밋",
    subcat: "git",
    definition: "코드 변경 내용을 한 묶음으로 저장하며 남기는 기록 지점.",
    detail:
      "게임의 세이브 포인트와 같다. 각 커밋엔 '무엇을 바꿨는지' 메시지를 단다. 문제가 생기면 이전 커밋으로 되돌릴 수 있다.",
    example: "지금까지 작업을 '로그인 기능 추가' 메시지로 커밋해줘.",
    aliases: ["커밋", "commit", "저장 지점", "변경 기록"],
  },
  {
    id: "branch",
    term: "Branch",
    termKo: "브랜치",
    subcat: "git",
    definition: "원본을 건드리지 않고 따로 떼어내 작업하는 평행 작업 갈래.",
    detail:
      "새 기능을 안전하게 시험할 때 가지를 친다. 완성되면 원래 갈래(보통 main)에 다시 합치는데, 이를 '머지(Merge)'라고 한다.",
    example: "'결제 기능'용 새 브랜치를 만들어 거기서 작업해줘.",
    aliases: ["브랜치", "branch", "가지", "작업 갈래", "머지"],
  },
  {
    id: "repository",
    term: "Repository",
    termKo: "리포지토리",
    subcat: "git",
    definition: "프로젝트의 코드와 변경 이력 전체를 보관하는 저장소.",
    detail:
      "흔히 'repo(레포)'라 줄여 부른다. GitHub의 한 프로젝트가 하나의 리포지토리다. 커밋·브랜치가 모두 이 안에 쌓인다.",
    example: "이 프로젝트를 GitHub 리포지토리로 올려줘.",
    aliases: ["레포", "repo", "repository", "저장소", "깃 저장소"],
  },

  // ── 도구·협업 > 빌드·배포·환경 (ops) ──────────────────
  {
    id: "mcp",
    term: "MCP",
    termKo: "엠씨피",
    subcat: "ops",
    definition: "AI가 외부 도구·데이터(파일, DB, API 등)에 연결되게 해주는 표준 규약.",
    detail:
      "Model Context Protocol의 약자. AI에 'USB 포트'를 달아 주는 것에 비유된다. MCP 서버를 붙이면 AI가 그 도구를 직접 쓸 수 있다.",
    example: "이 MCP 서버를 연결해서 AI가 내 파일을 읽을 수 있게 해줘.",
    aliases: ["엠씨피", "mcp", "Model Context Protocol", "mcp 서버"],
  },
  {
    id: "dependency",
    term: "Dependency",
    termKo: "의존성",
    subcat: "ops",
    definition: "내 프로젝트가 동작하려고 끌어다 쓰는 외부 코드(라이브러리)들.",
    detail:
      "남이 만든 부품을 가져다 쓰면 그것이 의존성이 된다. 보통 설치 목록으로 관리하며, 버전이 안 맞으면 충돌이 날 수 있다.",
    example: "차트를 그리는 데 필요한 의존성을 설치하고 추가해줘.",
    aliases: ["디펜던시", "dependency", "패키지", "외부 라이브러리", "설치 목록"],
  },
  {
    id: "deploy",
    term: "Deploy",
    termKo: "배포",
    subcat: "ops",
    definition: "만든 앱을 실제 서버에 올려 누구나 쓸 수 있게 공개하는 일.",
    detail:
      "내 컴퓨터에서만 돌던 것을 인터넷에 띄우는 단계. '배포한다 = 출시한다'에 가깝다. Vercel·Netlify 같은 서비스로 손쉽게 한다.",
    example: "완성된 사이트를 Vercel에 배포하는 방법을 알려줘.",
    aliases: ["디플로이", "deploy", "배포하기", "출시", "deployment"],
  },
  {
    id: "env-var",
    term: "Environment Variable",
    termKo: "환경 변수",
    subcat: "ops",
    definition: "코드 밖에 따로 보관하는 설정값(API 키·비밀번호 등).",
    detail:
      "비밀 키를 코드에 직접 적으면 새어 나가므로, 환경 변수로 분리해 둔다. 보통 .env 파일에 적고 공개 저장소엔 올리지 않는다.",
    example: "API 키를 코드에 박지 말고 환경 변수로 분리해줘.",
    aliases: ["환경변수", "env", ".env", "environment variable", "설정값"],
  },
];
