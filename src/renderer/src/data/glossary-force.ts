import type { GraphEdge, GraphNode } from "./glossary-graph";

// 결정적 force-directed 레이아웃(순수). Math.random 없이 인덱스 기반 원형 초기화 → 반복.
// Fruchterman-Reingold식 반발/인력 + 중심 중력. 좌표 스케일은 추상값이며, 렌더 측이
// 바운딩 박스를 viewBox로 맞춰 정규화하므로 절대 크기보다 상대 배치가 중요하다.
// 고립 노드(간선 없음)는 반발+중력만 받아 자연히 주변부 halo로 퍼진다(옵시디언 orphan 배치).

export interface Vec {
  x: number;
  y: number;
}

export interface LayoutOpts {
  iterations?: number;
  idealDist?: number; // 이상적 간선 길이(k)
  gravity?: number; // 중심 인력 계수
}

export function simulateLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  opts: LayoutOpts = {},
): Map<string, Vec> {
  const n = nodes.length;
  const result = new Map<string, Vec>();
  if (n === 0) return result;
  if (n === 1) {
    result.set(nodes[0].id, { x: 0, y: 0 });
    return result;
  }

  const k = opts.idealDist ?? 200;
  const iterations = opts.iterations ?? 420;
  const gravity = opts.gravity ?? 0.15;

  const idToIdx = new Map<string, number>();
  nodes.forEach((node, i) => idToIdx.set(node.id, i));

  // 인덱스 기반 원형 초기 배치(결정적, 좌표 중복 없음).
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  const r0 = (k * Math.sqrt(n)) / 2;
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    // 황금각 가미로 같은 반지름 위 균일 분포(완전 정렬 회피, 여전히 결정적).
    const rr = r0 * (0.35 + 0.65 * ((i % 17) / 17));
    px[i] = Math.cos(a) * rr;
    py[i] = Math.sin(a) * rr;
  }

  const ei: number[] = [];
  const ej: number[] = [];
  for (const e of edges) {
    const a = idToIdx.get(e.a);
    const b = idToIdx.get(e.b);
    if (a !== undefined && b !== undefined) {
      ei.push(a);
      ej.push(b);
    }
  }

  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  const k2 = k * k;
  let temp = r0 * 0.85;
  const cooling = Math.pow(0.02, 1 / iterations); // 마지막에 temp ≈ 초기*0.02

  for (let iter = 0; iter < iterations; iter++) {
    dx.fill(0);
    dy.fill(0);

    // 반발(모든 쌍, O(n²)). rep = k²/dist² (역제곱) — 먼 거리에서 빠르게 약해져
    // 연결 없는 고립 노드가 멀리 halo로 흩어지지 않고 군집 가장자리로 모인다.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let vx = px[i] - px[j];
        let vy = py[i] - py[j];
        let dist = Math.hypot(vx, vy);
        if (dist < 0.01) {
          // 거의 겹침 — 결정적 미세 분리(인덱스 기반).
          vx = (i - j) % 2 === 0 ? 0.01 : -0.01;
          vy = 0.01;
          dist = 0.0141;
        }
        const rep = k2 / (dist * dist);
        const ux = (vx / dist) * rep;
        const uy = (vy / dist) * rep;
        dx[i] += ux;
        dy[i] += uy;
        dx[j] -= ux;
        dy[j] -= uy;
      }
    }

    // 인력(간선). att = dist²/k.
    for (let e = 0; e < ei.length; e++) {
      const i = ei[e];
      const j = ej[e];
      const vx = px[i] - px[j];
      const vy = py[i] - py[j];
      const dist = Math.max(Math.hypot(vx, vy), 0.01);
      const att = (dist * dist) / k;
      const ux = (vx / dist) * att;
      const uy = (vy / dist) * att;
      dx[i] -= ux;
      dy[i] -= uy;
      dx[j] += ux;
      dy[j] += uy;
    }

    // 중심 중력(고립 노드를 프레임 안으로).
    for (let i = 0; i < n; i++) {
      dx[i] -= px[i] * gravity;
      dy[i] -= py[i] * gravity;
    }

    // 온도로 스텝 제한 후 적용.
    for (let i = 0; i < n; i++) {
      const dl = Math.hypot(dx[i], dy[i]);
      if (dl < 1e-9) continue;
      const step = Math.min(dl, temp);
      px[i] += (dx[i] / dl) * step;
      py[i] += (dy[i] / dl) * step;
    }
    temp *= cooling;
  }

  for (let i = 0; i < n; i++) result.set(nodes[i].id, { x: px[i], y: py[i] });
  return result;
}
