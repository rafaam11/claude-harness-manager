import type { LucideIcon } from "lucide-react";
import { Boxes } from "lucide-react";
import { DOMAIN_META, DOMAIN_ORDER, SUBCAT_META, SUBCATS_BY_DOMAIN } from "./glossary";
import type { CustomGlossaryData } from "@shared/types";

// 트리 런타임 모델 — 고정 union(기본)과 동적 string(커스텀)을 한 트리로 합치는 promote 레이어.
// 기존 glossary.ts의 union/메타는 안 건드리고, 여기서 string id 기반으로 승격해 합친다.
// 커스텀 id는 custom:<domain>[:<subcat>]로 격리해 기본과 절대 충돌하지 않는다.

export interface RTSubcat {
  id: string;
  domainId: string;
  label: string;
  icon: LucideIcon;
  badge: string;
  isCustom: boolean;
}
export interface RTDomain {
  id: string;
  label: string;
  icon: LucideIcon;
  isCustom: boolean;
  subcats: RTSubcat[];
}

export function buildTree(custom: CustomGlossaryData | null): RTDomain[] {
  const base: RTDomain[] = DOMAIN_ORDER.map((d) => ({
    id: d,
    label: DOMAIN_META[d].label,
    icon: DOMAIN_META[d].icon,
    isCustom: false,
    subcats: SUBCATS_BY_DOMAIN[d].map((sc) => ({
      id: sc,
      domainId: d,
      label: SUBCAT_META[sc].label,
      icon: SUBCAT_META[sc].icon,
      badge: SUBCAT_META[sc].badge,
      isCustom: false,
    })),
  }));
  if (!custom || custom.domains.length === 0) return base;
  const customDomains: RTDomain[] = custom.domains.map((dom) => {
    const did = `custom:${dom.id}`;
    return {
      id: did,
      label: dom.label,
      icon: Boxes,
      isCustom: true,
      subcats: dom.subcats.map((sc) => ({
        id: `${did}:${sc.id}`,
        domainId: did,
        label: sc.label,
        icon: Boxes,
        badge: "bdg-g-custom",
        isCustom: true,
      })),
    };
  });
  return [...base, ...customDomains];
}

// subcat id → RTSubcat 조회 맵.
export function subcatIndex(tree: RTDomain[]): Map<string, RTSubcat> {
  const m = new Map<string, RTSubcat>();
  for (const d of tree) for (const s of d.subcats) m.set(s.id, s);
  return m;
}
