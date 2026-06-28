import type { ReactNode } from "react";

// UI 요소용 미니 와이어프레임 스케치. currentColor로 stroke/fill해 다크·라이트 테마를 따라간다.
// glossary.ts의 term.sketchId가 이 맵의 키를 참조한다. (ui-layout/ui-component 한정)
// viewBox 통일: 0 0 120 72. 부모 .glossary-sketch가 색(currentColor)과 크기를 제어.

const C = "currentColor";

function Frame({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 120 72"
      width="120"
      height="72"
      fill="none"
      stroke={C}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const SKETCHES: Record<string, ReactNode> = {
  header: (
    <Frame>
      <rect x="6" y="6" width="108" height="60" rx="3" opacity="0.35" />
      <rect x="6" y="6" width="108" height="16" rx="3" fill={C} opacity="0.18" stroke="none" />
      <rect x="12" y="11" width="20" height="6" rx="2" />
      <rect x="84" y="11" width="24" height="6" rx="2" />
    </Frame>
  ),
  navbar: (
    <Frame>
      <rect x="6" y="22" width="108" height="20" rx="4" />
      <circle cx="18" cy="32" r="4" />
      <line x1="44" y1="32" x2="60" y2="32" />
      <line x1="70" y1="32" x2="86" y2="32" />
      <line x1="96" y1="32" x2="106" y2="32" />
    </Frame>
  ),
  sidebar: (
    <Frame>
      <rect x="6" y="8" width="108" height="56" rx="3" opacity="0.35" />
      <rect x="6" y="8" width="34" height="56" rx="3" fill={C} opacity="0.18" stroke="none" />
      <line x1="13" y1="20" x2="33" y2="20" />
      <line x1="13" y1="30" x2="33" y2="30" />
      <line x1="13" y1="40" x2="33" y2="40" />
      <line x1="52" y1="22" x2="104" y2="22" opacity="0.5" />
      <line x1="52" y1="34" x2="104" y2="34" opacity="0.5" />
    </Frame>
  ),
  hero: (
    <Frame>
      <rect x="6" y="8" width="108" height="56" rx="3" opacity="0.35" />
      <line x1="20" y1="24" x2="100" y2="24" strokeWidth="4" />
      <line x1="30" y1="36" x2="90" y2="36" opacity="0.6" />
      <rect x="44" y="46" width="32" height="12" rx="3" fill={C} opacity="0.85" stroke="none" />
    </Frame>
  ),
  footer: (
    <Frame>
      <rect x="6" y="6" width="108" height="60" rx="3" opacity="0.35" />
      <rect x="6" y="50" width="108" height="16" rx="3" fill={C} opacity="0.18" stroke="none" />
      <line x1="14" y1="58" x2="40" y2="58" />
      <circle cx="92" cy="58" r="3" />
      <circle cx="104" cy="58" r="3" />
    </Frame>
  ),
  "hamburger-menu": (
    <Frame>
      <line x1="40" y1="26" x2="80" y2="26" strokeWidth="3" />
      <line x1="40" y1="36" x2="80" y2="36" strokeWidth="3" />
      <line x1="40" y1="46" x2="80" y2="46" strokeWidth="3" />
    </Frame>
  ),
  grid: (
    <Frame>
      <rect x="10" y="10" width="30" height="22" rx="3" />
      <rect x="46" y="10" width="30" height="22" rx="3" />
      <rect x="82" y="10" width="28" height="22" rx="3" />
      <rect x="10" y="40" width="30" height="22" rx="3" />
      <rect x="46" y="40" width="30" height="22" rx="3" />
      <rect x="82" y="40" width="28" height="22" rx="3" />
    </Frame>
  ),
  card: (
    <Frame>
      <rect x="36" y="8" width="48" height="56" rx="4" />
      <rect x="42" y="14" width="36" height="20" rx="2" fill={C} opacity="0.2" stroke="none" />
      <line x1="42" y1="42" x2="78" y2="42" />
      <line x1="42" y1="50" x2="68" y2="50" opacity="0.6" />
      <rect x="42" y="55" width="22" height="6" rx="2" fill={C} opacity="0.7" stroke="none" />
    </Frame>
  ),
  modal: (
    <Frame>
      <rect x="6" y="6" width="108" height="60" rx="3" fill={C} opacity="0.12" stroke="none" />
      <rect x="30" y="18" width="60" height="38" rx="4" />
      <line x1="38" y1="30" x2="74" y2="30" />
      <line x1="38" y1="38" x2="64" y2="38" opacity="0.6" />
      <rect x="62" y="44" width="20" height="7" rx="2" fill={C} opacity="0.8" stroke="none" />
      <line x1="80" y1="22" x2="84" y2="26" />
      <line x1="84" y1="22" x2="80" y2="26" />
    </Frame>
  ),
  breadcrumb: (
    <Frame>
      <rect x="10" y="30" width="22" height="12" rx="2" />
      <path d="M38 30 l5 6 l-5 6" opacity="0.7" />
      <rect x="48" y="30" width="26" height="12" rx="2" />
      <path d="M80 30 l5 6 l-5 6" opacity="0.7" />
      <rect x="90" y="30" width="20" height="12" rx="2" fill={C} opacity="0.7" stroke="none" />
    </Frame>
  ),
  tooltip: (
    <Frame>
      <rect x="48" y="44" width="24" height="14" rx="3" fill={C} opacity="0.25" stroke="none" />
      <rect x="38" y="14" width="44" height="18" rx="4" />
      <path d="M56 32 l4 6 l4 -6" fill={C} stroke="none" />
      <line x1="46" y1="23" x2="74" y2="23" opacity="0.7" />
    </Frame>
  ),
  accordion: (
    <Frame>
      <rect x="20" y="8" width="80" height="13" rx="3" />
      <rect x="20" y="24" width="80" height="13" rx="3" fill={C} opacity="0.18" stroke="none" />
      <rect x="20" y="24" width="80" height="13" rx="3" />
      <line x1="28" y1="42" x2="92" y2="42" opacity="0.6" />
      <line x1="28" y1="50" x2="76" y2="50" opacity="0.6" />
      <rect x="20" y="56" width="80" height="13" rx="3" />
    </Frame>
  ),
  dropdown: (
    <Frame>
      <rect x="34" y="10" width="52" height="14" rx="3" />
      <path d="M74 15 l4 4 l4 -4" />
      <rect x="34" y="28" width="52" height="36" rx="3" opacity="0.5" />
      <line x1="42" y1="38" x2="78" y2="38" />
      <line x1="42" y1="46" x2="78" y2="46" opacity="0.6" />
      <line x1="42" y1="54" x2="78" y2="54" opacity="0.6" />
    </Frame>
  ),
  tab: (
    <Frame>
      <rect x="14" y="14" width="28" height="14" rx="3" fill={C} opacity="0.2" stroke="none" />
      <rect x="14" y="14" width="28" height="14" rx="3" />
      <rect x="46" y="16" width="28" height="12" rx="3" opacity="0.6" />
      <rect x="78" y="16" width="28" height="12" rx="3" opacity="0.6" />
      <rect x="14" y="30" width="92" height="30" rx="3" />
      <line x1="22" y1="42" x2="80" y2="42" opacity="0.6" />
    </Frame>
  ),
  badge: (
    <Frame>
      <rect x="40" y="22" width="40" height="34" rx="5" />
      <line x1="48" y1="34" x2="72" y2="34" opacity="0.6" />
      <line x1="48" y1="44" x2="64" y2="44" opacity="0.6" />
      <circle cx="80" cy="22" r="9" fill={C} opacity="0.85" stroke="none" />
      <text x="80" y="26" fontSize="10" fill="var(--bg)" textAnchor="middle" stroke="none">
        3
      </text>
    </Frame>
  ),
  toast: (
    <Frame>
      <rect x="6" y="6" width="108" height="60" rx="3" opacity="0.3" />
      <rect x="60" y="46" width="48" height="16" rx="5" fill={C} opacity="0.85" stroke="none" />
      <line x1="68" y1="54" x2="100" y2="54" stroke="var(--bg)" opacity="0.9" />
    </Frame>
  ),
  carousel: (
    <Frame>
      <rect x="30" y="14" width="60" height="36" rx="4" />
      <path d="M18 32 l-6 0 m6 -5 l-6 5 l6 5" />
      <path d="M102 32 l6 0 m-6 -5 l6 5 l-6 5" />
      <circle cx="52" cy="60" r="2.5" fill={C} stroke="none" />
      <circle cx="60" cy="60" r="2.5" fill={C} opacity="0.4" stroke="none" />
      <circle cx="68" cy="60" r="2.5" fill={C} opacity="0.4" stroke="none" />
    </Frame>
  ),
  pagination: (
    <Frame>
      <rect x="24" y="28" width="16" height="16" rx="3" fill={C} opacity="0.8" stroke="none" />
      <rect x="44" y="28" width="16" height="16" rx="3" />
      <rect x="64" y="28" width="16" height="16" rx="3" />
      <rect x="84" y="28" width="16" height="16" rx="3" />
    </Frame>
  ),
  skeleton: (
    <Frame>
      <circle cx="24" cy="24" r="10" fill={C} opacity="0.22" stroke="none" />
      <rect x="42" y="18" width="64" height="8" rx="4" fill={C} opacity="0.22" stroke="none" />
      <rect x="42" y="30" width="44" height="8" rx="4" fill={C} opacity="0.22" stroke="none" />
      <rect x="14" y="48" width="92" height="8" rx="4" fill={C} opacity="0.22" stroke="none" />
    </Frame>
  ),
  placeholder: (
    <Frame>
      <rect x="14" y="26" width="92" height="20" rx="4" />
      <line x1="22" y1="36" x2="70" y2="36" opacity="0.4" strokeDasharray="3 3" />
    </Frame>
  ),
};
