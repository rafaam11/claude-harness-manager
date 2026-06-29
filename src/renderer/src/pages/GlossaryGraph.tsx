import { useEffect, useMemo, useRef, useState } from "react";
import { Crosshair, BookOpen, X, SlidersHorizontal, RotateCcw } from "lucide-react";
import {
  colorOf,
  relatedNodes,
  type GlossaryGraph as Graph,
} from "../data/glossary-graph";
import type { Vec } from "../data/glossary-force";
import { SUBCAT_META, SUBCAT_ORDER } from "../data/glossary";

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface DragState {
  id: string;
  ssx: number; // 시작 포인터(svg 좌표) — 델타 계산 기준
  ssy: number;
  sx: number; // 시작 포인터(픽셀) — 클릭/드래그 구분용
  sy: number;
  moved: boolean;
  // 함께 움직일 노드들(드래그 노드 + 1·2홉 이웃)의 시작 위치 + 가중치.
  affected: { id: string; x0: number; y0: number; w: number }[];
}

const DRAG_THRESHOLD = 4; // px — 이만큼 움직이기 전엔 드래그 아님(클릭=선택과 분리)

// 그래프 물리·표시 설정(슬라이더로 조절). spacing/gravity는 레이아웃(부모) 재계산,
// labelSize/nodeScale은 렌더 즉시 반영.
export interface GraphSettings {
  spacing: number; // idealDist(반발/간격)
  gravity: number; // 중심 중력(뭉침)
  labelSize: number; // 라벨 폰트(viewBox 단위)
  nodeScale: number; // 노드 반지름 배수
}
export const GRAPH_DEFAULTS: GraphSettings = {
  spacing: 200,
  gravity: 0.15,
  labelSize: 11,
  nodeScale: 1,
};

function fitViewBox(layout: Map<string, Vec>): ViewBox {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const { x, y } of layout.values()) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!isFinite(minX)) return { x: -200, y: -200, w: 400, h: 400 };
  const pad = 70;
  const w = Math.max(maxX - minX, 1) + pad * 2;
  const h = Math.max(maxY - minY, 1) + pad * 2;
  return { x: minX - pad, y: minY - pad, w, h };
}

// 노드 반지름 — 연결 수(degree)에 따라 허브를 키운다.
function radiusOf(deg: number): number {
  return 5.5 + Math.min(deg, 9) * 1.0;
}

export default function GlossaryGraph({
  graph,
  layout,
  selectedId,
  onSelect,
  onOpenInList,
  mode,
  onToggleMode,
  hasCustom,
  settings,
  onSettings,
}: {
  graph: Graph;
  layout: Map<string, Vec>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onOpenInList: (id: string) => void;
  mode: "global" | "local";
  onToggleMode: () => void;
  hasCustom: boolean;
  settings: GraphSettings;
  onSettings: (patch: Partial<GraphSettings>) => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const baseVb = useMemo(() => fitViewBox(layout), [layout]);
  const [vb, setVb] = useState<ViewBox>(baseVb);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [setOpen, setSetOpen] = useState(false);
  // 드래그로 옮긴 노드 위치 override(없으면 layout 사용). 레이아웃 바뀌면 초기화.
  const [drag, setDrag] = useState<Map<string, Vec>>(() => new Map());
  const pan = useRef<{ sx: number; sy: number; vb: ViewBox } | null>(null);
  const moved = useRef(false);
  const dragRef = useRef<DragState | null>(null);

  // 그래프/레이아웃이 바뀌면(모드 전환·커스텀 갱신·물리 조절) 뷰박스를 다시 맞추고 드래그 위치 초기화.
  useEffect(() => setVb(baseVb), [baseVb]);
  useEffect(() => setDrag(new Map()), [layout]);

  // 휠 줌 — React onWheel은 passive라 preventDefault가 무시되어 페이지가 스크롤된다.
  // 네이티브 리스너(passive:false)로 등록해 페이지 스크롤을 막고 그래프만 줌한다.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      setVb((prev) => {
        const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
        const newW = Math.min(Math.max(prev.w * factor, baseVb.w * 0.12), baseVb.w * 2.2);
        const rf = newW / prev.w;
        const cx = prev.x + ((e.clientX - rect.left) / rect.width) * prev.w;
        const cy = prev.y + ((e.clientY - rect.top) / rect.height) * prev.h;
        return { x: cx - (cx - prev.x) * rf, y: cy - (cy - prev.y) * rf, w: prev.w * rf, h: prev.h * rf };
      });
    };
    el.addEventListener("wheel", onWheelNative, { passive: false });
    return () => el.removeEventListener("wheel", onWheelNative);
  }, [baseVb]);

  const highlightId = hoveredId ?? selectedId;
  const highlightSet = useMemo(() => {
    if (!highlightId) return null;
    return new Set<string>([highlightId, ...(graph.adjacency.get(highlightId) ?? [])]);
  }, [highlightId, graph]);

  const labelsAll = vb.w < baseVb.w * 0.55; // 일정 이상 확대하면 전체 라벨 노출
  const selectedNode = selectedId ? graph.nodeById.get(selectedId) ?? null : null;
  const related = selectedId ? relatedNodes(graph, selectedId) : [];

  const toSvg = (clientX: number, clientY: number): Vec => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: vb.x + ((clientX - rect.left) / rect.width) * vb.w,
      y: vb.y + ((clientY - rect.top) / rect.height) * vb.h,
    };
  };

  // 노드 위치 — 드래그로 옮겼으면 override, 아니면 레이아웃.
  const posOf = (id: string): Vec | undefined => drag.get(id) ?? layout.get(id);

  // 노드 드래그(옵시디언식) — 끌면 연결된 이웃도 가중치만큼 딸려온다. 임계값 전엔 위치 불변(클릭=선택).
  const onNodeDown = (ev: React.PointerEvent, id: string) => {
    ev.stopPropagation(); // 배경 팬 방지
    const s = toSvg(ev.clientX, ev.clientY);
    // 함께 움직일 노드: 드래그 노드(1.0) + 1홉 이웃(0.5) + 2홉 이웃(0.2).
    const weights = new Map<string, number>([[id, 1]]);
    const hop1 = graph.adjacency.get(id) ?? [];
    for (const n1 of hop1) if (!weights.has(n1)) weights.set(n1, 0.5);
    for (const n1 of hop1)
      for (const n2 of graph.adjacency.get(n1) ?? []) if (!weights.has(n2)) weights.set(n2, 0.2);
    const affected: DragState["affected"] = [];
    for (const [nid, w] of weights) {
      const p = posOf(nid);
      if (p) affected.push({ id: nid, x0: p.x, y0: p.y, w });
    }
    dragRef.current = { id, ssx: s.x, ssy: s.y, sx: ev.clientX, sy: ev.clientY, moved: false, affected };
    (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId);
  };
  const onNodeMove = (ev: React.PointerEvent, id: string) => {
    const d = dragRef.current;
    if (!d || d.id !== id) return;
    if (!d.moved) {
      if (Math.abs(ev.clientX - d.sx) + Math.abs(ev.clientY - d.sy) <= DRAG_THRESHOLD) return;
      d.moved = true; // 임계값 초과 — 이제부터 드래그
    }
    const s = toSvg(ev.clientX, ev.clientY);
    const dx = s.x - d.ssx;
    const dy = s.y - d.ssy;
    setDrag((prev) => {
      const next = new Map(prev);
      for (const a of d.affected) next.set(a.id, { x: a.x0 + dx * a.w, y: a.y0 + dy * a.w });
      return next;
    });
  };
  const onNodeUp = (ev: React.PointerEvent, id: string) => {
    const d = dragRef.current;
    dragRef.current = null;
    (ev.currentTarget as Element).releasePointerCapture?.(ev.pointerId);
    if (d && !d.moved) onSelect(id); // 이동 안 했으면 클릭 = 선택
  };

  const onPointerDownBg = (e: React.PointerEvent) => {
    pan.current = { sx: e.clientX, sy: e.clientY, vb };
    moved.current = false;
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pan.current) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dx = ((e.clientX - pan.current.sx) / rect.width) * pan.current.vb.w;
    const dy = ((e.clientY - pan.current.sy) / rect.height) * pan.current.vb.h;
    if (Math.abs(e.clientX - pan.current.sx) + Math.abs(e.clientY - pan.current.sy) > 3)
      moved.current = true;
    setVb({ ...pan.current.vb, x: pan.current.vb.x - dx, y: pan.current.vb.y - dy });
  };
  const onPointerUp = () => {
    if (pan.current && !moved.current) onSelect(null); // 빈 곳 클릭 → 선택 해제
    pan.current = null;
  };

  return (
    <div className="glossary-graph-wrap">
      <div className="glossary-graph-bar">
        <span className="glossary-graph-mode">
          {mode === "local" && selectedNode ? (
            <>
              <Crosshair size={13} /> 로컬 그래프 · <b>{selectedNode.term}</b>
            </>
          ) : (
            <>전역 그래프 · 노드 {graph.nodes.length} · 연결 {graph.edges.length}</>
          )}
        </span>
        <button
          className={`glossary-reco-refresh${setOpen ? " on" : ""}`}
          onClick={() => setSetOpen((o) => !o)}
        >
          <SlidersHorizontal size={13} /> 표시 설정
        </button>
        {selectedNode && (
          <button className="glossary-reco-refresh" onClick={onToggleMode}>
            <Crosshair size={13} /> {mode === "global" ? "이 용어 중심으로" : "전체 보기"}
          </button>
        )}
        <button className="glossary-reco-refresh" onClick={() => setVb(baseVb)}>
          화면 맞춤
        </button>
      </div>

      <div className="glossary-graph-stage">
        <svg
          ref={svgRef}
          className="glossary-graph-svg"
          viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
          onPointerDown={onPointerDownBg}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          <g>
            {graph.edges.map((e, i) => {
              const pa = posOf(e.a);
              const pb = posOf(e.b);
              if (!pa || !pb) return null;
              const active = highlightId ? e.a === highlightId || e.b === highlightId : false;
              const dim = highlightSet && !active;
              return (
                <line
                  key={i}
                  x1={pa.x}
                  y1={pa.y}
                  x2={pb.x}
                  y2={pb.y}
                  className={`glossary-gedge${active ? " active" : ""}${dim ? " dim" : ""}`}
                />
              );
            })}
            {graph.nodes.map((node) => {
              const p = posOf(node.id);
              if (!p) return null;
              const deg = graph.adjacency.get(node.id)?.length ?? 0;
              const r = radiusOf(deg) * settings.nodeScale;
              const dim = highlightSet ? !highlightSet.has(node.id) : false;
              const isSel = node.id === selectedId;
              const showLabel = labelsAll || deg >= 4 || (highlightSet?.has(node.id) ?? false);
              return (
                <g
                  key={node.id}
                  className={`glossary-gnode${dim ? " dim" : ""}${isSel ? " sel" : ""}`}
                  transform={`translate(${p.x} ${p.y})`}
                  onPointerDown={(ev) => onNodeDown(ev, node.id)}
                  onPointerMove={(ev) => onNodeMove(ev, node.id)}
                  onPointerUp={(ev) => onNodeUp(ev, node.id)}
                  onMouseEnter={() => setHoveredId(node.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  <circle r={r} fill={colorOf(node.subcat)} className="glossary-gnode-dot" />
                  {showLabel && (
                    <text
                      className="glossary-gnode-label"
                      y={r + settings.labelSize + 1}
                      textAnchor="middle"
                      fontSize={settings.labelSize}
                    >
                      {node.term}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {setOpen && (
          <div className="glossary-graph-settings">
            <div className="glossary-graph-set-head">
              <SlidersHorizontal size={13} /> 표시 설정
              <button
                className="glossary-graph-set-reset"
                onClick={() => onSettings(GRAPH_DEFAULTS)}
                title="기본값"
              >
                <RotateCcw size={12} /> 기본값
              </button>
            </div>
            <SettingRow
              label="간격(반발)"
              min={80}
              max={420}
              step={10}
              value={settings.spacing}
              onChange={(v) => onSettings({ spacing: v })}
              display={String(settings.spacing)}
            />
            <SettingRow
              label="뭉침(중력)"
              min={0.03}
              max={0.6}
              step={0.01}
              value={settings.gravity}
              onChange={(v) => onSettings({ gravity: v })}
              display={settings.gravity.toFixed(2)}
            />
            <SettingRow
              label="글자 크기"
              min={5}
              max={26}
              step={1}
              value={settings.labelSize}
              onChange={(v) => onSettings({ labelSize: v })}
              display={String(settings.labelSize)}
            />
            <SettingRow
              label="노드 크기"
              min={0.5}
              max={2.6}
              step={0.1}
              value={settings.nodeScale}
              onChange={(v) => onSettings({ nodeScale: v })}
              display={`${settings.nodeScale.toFixed(1)}x`}
            />
          </div>
        )}

        {selectedNode && (
          <div className="glossary-graph-card">
            <button className="glossary-graph-card-x" onClick={() => onSelect(null)} title="닫기">
              <X size={14} />
            </button>
            <div className="glossary-graph-card-term">
              <span
                className="glossary-graph-card-dot"
                style={{ background: colorOf(selectedNode.subcat) }}
              />
              {selectedNode.term}
              {selectedNode.termKo && (
                <span className="glossary-reco-ko">{selectedNode.termKo}</span>
              )}
            </div>
            <div className="glossary-graph-card-blurb">{selectedNode.blurb}</div>
            {related.length > 0 ? (
              <div className="glossary-related glossary-graph-card-related">
                <span className="glossary-related-label">관련 용어</span>
                {related.map((rn) => (
                  <button key={rn.id} className="glossary-chip" onClick={() => onSelect(rn.id)}>
                    {rn.term}
                  </button>
                ))}
              </div>
            ) : (
              <div className="glossary-graph-card-blurb muted">연결된 용어가 없습니다.</div>
            )}
            <div className="glossary-graph-card-actions">
              <button className="glossary-reco-refresh" onClick={onToggleMode}>
                <Crosshair size={13} /> {mode === "global" ? "중심으로" : "전체"}
              </button>
              <button
                className="glossary-reco-refresh"
                onClick={() => onOpenInList(selectedNode.id)}
              >
                <BookOpen size={13} /> 용어집에서 보기
              </button>
            </div>
          </div>
        )}

        <div className="glossary-graph-legend">
          {SUBCAT_ORDER.map((sc) => (
            <span key={sc} className="glossary-graph-legend-item">
              <span className="glossary-graph-legend-dot" style={{ background: colorOf(sc) }} />
              {SUBCAT_META[sc].label}
            </span>
          ))}
          {hasCustom && (
            <span className="glossary-graph-legend-item">
              <span
                className="glossary-graph-legend-dot"
                style={{ background: colorOf("custom:x:y") }}
              />
              내 용어
            </span>
          )}
        </div>
      </div>

      <p className="glossary-graph-hint muted">
        노드 클릭 = 상세·관련 용어 · 휠 = 확대/축소 · 드래그 = 이동 · 빈 곳 클릭 = 해제
      </p>
    </div>
  );
}

function SettingRow({
  label,
  min,
  max,
  step,
  value,
  onChange,
  display,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  display: string;
}) {
  return (
    <label className="glossary-graph-set-row">
      <span className="glossary-graph-set-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <span className="glossary-graph-set-val">{display}</span>
    </label>
  );
}
