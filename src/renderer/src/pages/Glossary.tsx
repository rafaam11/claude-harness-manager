import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Search,
  Sparkles,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  Boxes,
  Copy,
  FolderOpen,
  Network,
  List,
} from "lucide-react";
import { api } from "../api/client";
import { GLOSSARY, SUBCAT_META, type GlossaryTerm } from "../data/glossary";
import { GLOSSARY_EXTRA, type LiteTerm } from "../data/glossary-extra";
import { buildRecommendations, type RecoCandidate, type WeakArea } from "../data/glossary-reco";
import { buildTree, subcatIndex, type RTSubcat } from "../data/glossary-runtime";
import {
  buildGraph,
  localGraph,
  relatedNodes,
  type GlossaryGraph as Graph,
} from "../data/glossary-graph";
import { simulateLayout } from "../data/glossary-force";
import GlossaryGraphView, { GRAPH_DEFAULTS, type GraphSettings } from "./GlossaryGraph";
import { SKETCHES } from "../data/glossary-sketches";
import type { CustomGlossaryResponse, CustomGlossaryTerm } from "@shared/types";

// glossary(상세)·lite(한 줄)·custom(개인화) 용어를 한 트리에서 다루는 공용 행 타입.
type Row =
  | { kind: "glossary"; subcat: string; t: GlossaryTerm }
  | { kind: "lite"; subcat: string; t: LiteTerm }
  | { kind: "custom"; subcat: string; t: CustomGlossaryTerm };

// 행 → 그래프 노드 id(펼침 키·DOM id·칩 네비게이션 공용). glossary-graph의 id 스킴과 일치.
function nodeIdOf(row: Row): string {
  if (row.kind === "glossary") return row.t.id;
  if (row.kind === "lite") return `lite:${row.t.term}`;
  return `${row.subcat}:${row.t.term}`; // custom: row.subcat = custom:<domain>:<subcat>
}

function rowText(row: Row): string {
  if (row.kind === "glossary") {
    const t = row.t;
    return [t.term, t.termKo, t.definition, t.detail ?? "", ...(t.aliases ?? [])].join(" ");
  }
  if (row.kind === "lite") {
    const t = row.t;
    return [t.term, t.termKo, t.blurb, ...(t.aliases ?? [])].join(" ");
  }
  const t = row.t;
  return [t.term, t.termKo, t.definition, ...(t.aliases ?? [])].join(" ");
}
function matchesRow(row: Row, q: string): boolean {
  if (!q) return true;
  return rowText(row).toLowerCase().includes(q);
}
function countBy(rows: Row[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const r of rows) m[r.subcat] = (m[r.subcat] ?? 0) + 1;
  return m;
}
function dirname(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(0, i) : p;
}

// 바이브코딩 용어집 — 3단계 트리(기본+커스텀) + 약점 영역 do/don't 추천 + 관계 그래프(트리/그래프 뷰).
export default function Glossary() {
  const [query, setQuery] = useState("");
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(
    () => new Set(["ui", "ai", "dev", "collab"]),
  );
  const [selectedSubcat, setSelectedSubcat] = useState<string>("layout");
  const [expandedTerms, setExpandedTerms] = useState<Set<string>>(new Set());

  const [corpus, setCorpus] = useState<string[] | null>(null);
  const [recoCursor, setRecoCursor] = useState(0);
  const [custom, setCustom] = useState<CustomGlossaryResponse | null>(null);

  // 뷰 전환(트리/그래프) + 그래프 상태.
  const [view, setView] = useState<"tree" | "graph">("tree");
  const [graphMode, setGraphMode] = useState<"global" | "local">("global");
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [gset, setGset] = useState<GraphSettings>(GRAPH_DEFAULTS);
  const setG = (patch: Partial<GraphSettings>) => setGset((s) => ({ ...s, ...patch }));

  const loadCustom = useCallback(() => {
    api
      .get<CustomGlossaryResponse>("/api/glossary/custom")
      .then(setCustom)
      .catch(() => setCustom(null));
  }, []);

  useEffect(() => {
    api
      .get<{ texts: string[] }>("/api/glossary/prompt-corpus")
      .then((r) => setCorpus(r.texts))
      .catch(() => setCorpus([]));
  }, []);
  useEffect(() => loadCustom(), [loadCustom]);

  // 커스텀 도메인도 기본 펼침.
  useEffect(() => {
    const doms = custom?.data.domains;
    if (doms?.length) {
      setExpandedDomains((prev) => {
        const next = new Set(prev);
        for (const d of doms) next.add(`custom:${d.id}`);
        return next;
      });
    }
  }, [custom]);

  const tree = useMemo(() => buildTree(custom?.data ?? null), [custom]);
  const subIndex = useMemo(() => subcatIndex(tree), [tree]);
  const flatSubcats = useMemo(
    () => tree.flatMap((d) => d.subcats.map((sc) => ({ sc, domLabel: d.label }))),
    [tree],
  );

  // 관계 그래프 + force 레이아웃(전역). 커스텀 변경 시에만 재계산.
  const graph = useMemo(() => buildGraph(custom?.data ?? null), [custom]);
  // 물리값(간격·뭉침)은 지연 적용 — 슬라이더 드래그가 레이아웃 재계산으로 버벅이지 않게.
  const phys = useDeferredValue(gset);
  const layout = useMemo(
    () => simulateLayout(graph.nodes, graph.edges, { idealDist: phys.spacing, gravity: phys.gravity }),
    [graph, phys.spacing, phys.gravity],
  );
  const localG = useMemo(
    () => (selectedNode ? localGraph(graph, selectedNode) : null),
    [graph, selectedNode],
  );
  const localLayout = useMemo(
    () =>
      localG
        ? simulateLayout(localG.nodes, localG.edges, {
            iterations: 320,
            idealDist: phys.spacing * 0.8,
            gravity: phys.gravity,
          })
        : null,
    [localG, phys.spacing, phys.gravity],
  );

  const allRows = useMemo(() => {
    const rows: Row[] = [
      ...GLOSSARY.map((t): Row => ({ kind: "glossary", subcat: t.subcat, t })),
      ...GLOSSARY_EXTRA.map((t): Row => ({ kind: "lite", subcat: t.subcat, t })),
    ];
    const data = custom?.data;
    if (data) {
      for (const t of data.terms) {
        const sid = `custom:${t.domain}:${t.subcat}`;
        if (subIndex.has(sid)) rows.push({ kind: "custom", subcat: sid, t });
      }
    }
    return rows;
  }, [custom, subIndex]);

  const reco = useMemo(
    () => (corpus === null ? null : buildRecommendations(corpus, GLOSSARY, GLOSSARY_EXTRA, custom?.data)),
    [corpus, custom],
  );
  const recoList = reco?.recos ?? [];
  const weakArea = reco?.weakArea ?? null;
  const recoView = recoList.slice(recoCursor, recoCursor + 3);
  const newReco = () => setRecoCursor((c) => (recoList.length ? (c + 3) % recoList.length : 0));

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  const countTotal = useMemo(() => countBy(allRows), [allRows]);
  const matchedRows = useMemo(
    () => (searching ? allRows.filter((r) => matchesRow(r, q)) : []),
    [allRows, q, searching],
  );
  const countMatched = useMemo(
    () => (searching ? countBy(matchedRows) : null),
    [matchedRows, searching],
  );

  const detailGroups = useMemo(() => {
    if (searching) {
      return flatSubcats
        .map(({ sc, domLabel }) => ({ sc, domLabel, rows: matchedRows.filter((r) => r.subcat === sc.id) }))
        .filter((g) => g.rows.length > 0);
    }
    const found = flatSubcats.find(({ sc }) => sc.id === selectedSubcat);
    if (!found) return [];
    return [
      { sc: found.sc, domLabel: found.domLabel, rows: allRows.filter((r) => r.subcat === selectedSubcat) },
    ];
  }, [searching, matchedRows, allRows, selectedSubcat, flatSubcats]);

  const toggleDomain = (d: string) =>
    setExpandedDomains((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  const toggleTerm = (key: string) =>
    setExpandedTerms((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const goSubcat = (sub: string) => {
    setView("tree");
    setQuery("");
    setSelectedSubcat(sub);
    const rt = subIndex.get(sub);
    if (rt) setExpandedDomains((prev) => new Set(prev).add(rt.domainId));
  };

  // 그래프/칩에서 특정 용어로 이동 — 트리 뷰로 전환·소분류 선택·펼침·스크롤.
  const goToNode = (id: string) => {
    const node = graph.nodeById.get(id);
    if (!node) return;
    setView("tree");
    setQuery("");
    setSelectedSubcat(node.subcat);
    const rt = subIndex.get(node.subcat);
    if (rt) setExpandedDomains((prev) => new Set(prev).add(rt.domainId));
    setExpandedTerms((prev) => new Set(prev).add(id));
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        document
          .getElementById(`gl-row-${id}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" }),
      ),
    );
  };

  const onPick = (r: RecoCandidate) => {
    goSubcat(r.subcat);
    if (r.id) {
      setExpandedTerms((prev) => new Set(prev).add(r.id!));
      requestAnimationFrame(() =>
        document
          .getElementById(`gl-row-${r.id}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" }),
      );
    }
  };

  const useLocal = graphMode === "local" && !!selectedNode && !!localG && !!localLayout;
  const hasCustom = (custom?.data.domains.length ?? 0) > 0;

  return (
    <div>
      <h2>Glossary</h2>
      <p className="muted" style={{ marginTop: -6, marginBottom: 12, fontSize: 12 }}>
        바이브코딩·AI 용어를 분류 트리로 학습하고, 관계 그래프로 이어 보며, 헷갈리는 표현을 정식 명칭으로 바로잡는 사전.
      </p>

      <RecommendBar
        recos={recoView}
        weakArea={weakArea}
        ready={corpus !== null}
        hasMore={recoList.length > 3}
        onRefresh={newReco}
        onPick={onPick}
        onWeakGo={(w) => goSubcat(w.subcat)}
      />

      <div className="glossary-toolbar">
        <div className="glossary-view-toggle">
          <button
            className={view === "tree" ? "active" : ""}
            onClick={() => setView("tree")}
          >
            <List size={13} /> 트리
          </button>
          <button
            className={view === "graph" ? "active" : ""}
            onClick={() => setView("graph")}
          >
            <Network size={13} /> 그래프
          </button>
        </div>
        {view === "tree" && (
          <div className="glossary-search">
            <Search size={14} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="용어 검색 (영문·한글) — 전체에서 찾기"
            />
          </div>
        )}
      </div>

      {view === "graph" ? (
        <GlossaryGraphView
          graph={useLocal ? localG! : graph}
          layout={useLocal ? localLayout! : layout}
          selectedId={selectedNode}
          onSelect={setSelectedNode}
          onOpenInList={goToNode}
          mode={graphMode}
          onToggleMode={() => setGraphMode((m) => (m === "global" ? "local" : "global"))}
          hasCustom={hasCustom}
          settings={gset}
          onSettings={setG}
        />
      ) : (
        <div className="ws-split">
          <div className="ws-master glossary-tree">
            {tree.map((d) => {
              const open = expandedDomains.has(d.id);
              const DIcon = d.icon;
              return (
                <div key={d.id}>
                  <button className="glossary-tree-domain" onClick={() => toggleDomain(d.id)}>
                    {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <DIcon size={14} />
                    <span>{d.label}</span>
                    {d.isCustom && <span className="glossary-tree-mine">내 용어집</span>}
                  </button>
                  {open && (
                    <div className="glossary-tree-subcats">
                      {d.subcats.map((sc) => {
                        const SIcon = sc.icon;
                        const n = searching ? (countMatched?.[sc.id] ?? 0) : (countTotal[sc.id] ?? 0);
                        const active = !searching && sc.id === selectedSubcat;
                        const dimmed = searching && n === 0;
                        return (
                          <button
                            key={sc.id}
                            className={`glossary-tree-subcat${active ? " active" : ""}${dimmed ? " dimmed" : ""}`}
                            onClick={() => goSubcat(sc.id)}
                          >
                            <SIcon size={13} />
                            <span className="glossary-tree-subcat-label">{sc.label}</span>
                            <span className="glossary-tree-subcat-n">{n}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            <CustomPanel custom={custom} onRefresh={loadCustom} />
          </div>

          <div className="ws-detail">
            <div className="ws-detail-inner">
              {searching && detailGroups.length === 0 ? (
                <div className="muted">"{query}"에 해당하는 용어가 없습니다.</div>
              ) : (
                detailGroups.map((g) => (
                  <section key={g.sc.id} className="glossary-detail-section">
                    <DetailHead sc={g.sc} domLabel={g.domLabel} count={g.rows.length} />
                    {g.rows.map((row) => {
                      const id = nodeIdOf(row);
                      const open = expandedTerms.has(id);
                      const onToggle = () => toggleTerm(id);
                      if (row.kind === "glossary")
                        return (
                          <GlossaryRow
                            key={id}
                            nodeId={id}
                            term={row.t}
                            open={open}
                            onToggle={onToggle}
                            graph={graph}
                            onChip={goToNode}
                          />
                        );
                      if (row.kind === "lite")
                        return (
                          <LiteRow
                            key={id}
                            nodeId={id}
                            term={row.t}
                            open={open}
                            onToggle={onToggle}
                            graph={graph}
                            onChip={goToNode}
                          />
                        );
                      return (
                        <CustomRow
                          key={id}
                          nodeId={id}
                          term={row.t}
                          meta={subIndex.get(row.subcat)}
                          open={open}
                          onToggle={onToggle}
                          graph={graph}
                          onChip={goToNode}
                        />
                      );
                    })}
                  </section>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailHead({ sc, domLabel, count }: { sc: RTSubcat; domLabel: string; count: number }) {
  const Icon = sc.icon;
  return (
    <h3 className="glossary-detail-head">
      <Icon size={15} />
      <span className="glossary-crumb">{domLabel}</span>
      <span className="glossary-crumb-sep">›</span>
      <span className="glossary-crumb-cur">{sc.label}</span>
      <span className="glossary-detail-n">{count}</span>
    </h3>
  );
}

// 관련 용어 칩(공용) — 그래프 인접 노드를 칩으로. 클릭 시 해당 용어로 이동.
function RelatedChips({
  graph,
  nodeId,
  onChip,
}: {
  graph: Graph;
  nodeId: string;
  onChip: (id: string) => void;
}) {
  const rel = relatedNodes(graph, nodeId);
  if (rel.length === 0) return null;
  return (
    <div className="glossary-related">
      <span className="glossary-related-label">관련 용어</span>
      {rel.map((rn) => (
        <button key={rn.id} className="glossary-chip" onClick={() => onChip(rn.id)}>
          {rn.term}
        </button>
      ))}
    </div>
  );
}

// 상단 추천 섹션 — 약점 영역 배너 + do/don't 카드(❌ 내 문장 / ✅ 좋은 예).
function RecommendBar({
  recos,
  weakArea,
  ready,
  hasMore,
  onRefresh,
  onPick,
  onWeakGo,
}: {
  recos: RecoCandidate[];
  weakArea: WeakArea | null;
  ready: boolean;
  hasMore: boolean;
  onRefresh: () => void;
  onPick: (r: RecoCandidate) => void;
  onWeakGo: (w: WeakArea) => void;
}) {
  if (!ready) return <div className="glossary-reco-empty muted">추천 어휘 준비 중…</div>;
  if (recos.length === 0) return null;
  return (
    <section className="glossary-reco">
      <div className="glossary-reco-head">
        <span className="glossary-reco-title">
          <Sparkles size={15} /> 추천 어휘
        </span>
        {hasMore && (
          <button className="glossary-reco-refresh" onClick={onRefresh}>
            <RefreshCw size={13} /> 새 추천
          </button>
        )}
      </div>
      {weakArea && (
        <div className="glossary-reco-weak">
          <span>
            이 영역을 자주 헷갈려요 · <b>{weakArea.breadcrumb}</b> ({weakArea.confusedCount})
          </span>
          <button className="glossary-reco-weak-go" onClick={() => onWeakGo(weakArea)}>
            바로가기
          </button>
        </div>
      )}
      <div className="glossary-reco-grid">
        {recos.map((r) => (
          <button
            key={r.term}
            className="glossary-reco-card"
            onClick={() => onPick(r)}
            title={r.kind === "glossary" ? "용어집에서 자세히 보기" : "이 영역으로 이동"}
          >
            <div className="glossary-reco-term">
              {r.term}
              {r.termKo && <span className="glossary-reco-ko">{r.termKo}</span>}
              {r.kind === "lite" && <span className="glossary-reco-lite-tag">사전</span>}
              {r.kind === "custom" && <span className="glossary-reco-lite-tag">내 용어</span>}
            </div>
            <div className="glossary-reco-crumb">{r.crumb}</div>
            {r.userSentence ? (
              <div className="glossary-reco-bad">
                <span className="glossary-reco-mark">❌</span>
                <span className="glossary-reco-bad-text">"{r.userSentence}"</span>
              </div>
            ) : (
              <div className="glossary-reco-alias">
                {r.matchedAlias ? `당신의 표현: "${r.matchedAlias}"` : "자주 쓰는 용어"}
              </div>
            )}
            {r.goodExample && (
              <div className="glossary-reco-good">
                <span className="glossary-reco-mark">✅</span>
                <span className="glossary-reco-good-text">{r.goodExample}</span>
              </div>
            )}
            <div className="glossary-reco-blurb">{r.blurb}</div>
          </button>
        ))}
      </div>
    </section>
  );
}

// 좌측 트리 하단 "＋ 내 용어집" 가이드 패널 — Claude Code로 커스텀 용어집을 채우는 안내.
function CustomPanel({
  custom,
  onRefresh,
}: {
  custom: CustomGlossaryResponse | null;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const path = custom?.path ?? "";
  const exists = custom?.exists ?? false;
  const nDom = custom?.data.domains.length ?? 0;
  const nTerm = custom?.data.terms.length ?? 0;

  const prompt = [
    "내 최근 작업 내용을 분석해서 개인 용어집 파일을 만들어줘.",
    `파일 경로: ${path || "~/.claude/harness-manager/glossary-custom.json"}`,
    "",
    "형식(JSON):",
    JSON.stringify(
      {
        version: 1,
        domains: [{ id: "robotics", label: "로보틱스", subcats: [{ id: "sensor", label: "센서" }] }],
        terms: [
          {
            term: "LiDAR",
            termKo: "라이다",
            domain: "robotics",
            subcat: "sensor",
            definition: "레이저로 거리를 재 3D 점군을 만드는 센서.",
            aliases: ["라이다", "점군 센서"],
            example: "라이다 점군에서 장애물까지 거리를 추출해줘.",
          },
        ],
      },
      null,
      2,
    ),
    "",
    "규칙:",
    "- domain/subcat은 내가 자주 다루는 전문 분야로 자유롭게(예: 로보틱스>센서, 비전>검출).",
    "- 각 용어에 한 줄 definition과 좋은 예시 프롬프트(example)를 꼭 넣어줘.",
    "- aliases엔 내가 평소 부르는 한글 표현을 넣어줘(추천 매칭에 쓰임).",
    "- 위 경로에 UTF-8 JSON으로 저장하고, 기존 파일이 있으면 병합해줘.",
    "- 끝나면 앱에서 '새로고침'을 누르면 반영돼.",
  ].join("\n");

  const copyPrompt = () => {
    navigator.clipboard.writeText(prompt).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  };

  return (
    <div className="glossary-custom-panel">
      <button className="glossary-tree-domain" onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Boxes size={14} />
        <span>＋ 내 용어집</span>
      </button>
      {open && (
        <div className="glossary-custom-body">
          <div className="glossary-custom-status muted">
            {exists ? `${nDom}개 도메인 · ${nTerm}개 용어 불러옴` : "아직 파일이 없어요"}
          </div>
          <p className="glossary-custom-help muted">
            로보틱스·비전 등 내 분야 용어를 Claude Code로 채우면 트리에 더해집니다. 아래 프롬프트를
            복사해 Claude Code에 붙여넣으세요.
          </p>
          <div className="glossary-custom-actions">
            <button className="glossary-reco-refresh" onClick={copyPrompt}>
              <Copy size={13} /> {copied ? "복사됨" : "프롬프트 복사"}
            </button>
            <button
              className="glossary-reco-refresh"
              onClick={() => void window.app.openPath(exists ? path : dirname(path))}
              disabled={!path}
            >
              <FolderOpen size={13} /> 폴더 열기
            </button>
            <button className="glossary-reco-refresh" onClick={onRefresh}>
              <RefreshCw size={13} /> 새로고침
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function GlossaryRow({
  nodeId,
  term,
  open,
  onToggle,
  graph,
  onChip,
}: {
  nodeId: string;
  term: GlossaryTerm;
  open: boolean;
  onToggle: () => void;
  graph: Graph;
  onChip: (id: string) => void;
}) {
  const meta = SUBCAT_META[term.subcat];
  const Icon = meta.icon;
  const sketch = term.sketchId ? SKETCHES[term.sketchId] : null;
  return (
    <div id={`gl-row-${nodeId}`} className={`glossary-row${open ? " expanded" : ""}`}>
      <button className="glossary-row-head" onClick={onToggle}>
        <span className={`bdg ${meta.badge}`}>
          <Icon size={11} /> {meta.label}
        </span>
        <span className="glossary-term">{term.term}</span>
        {term.termKo && <span className="glossary-term-ko">{term.termKo}</span>}
        <span className="glossary-def">{term.definition}</span>
        <span className="glossary-caret">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="glossary-detail">
          {term.detail && <p>{term.detail}</p>}
          {term.example && (
            <p className="glossary-example">
              <span className="glossary-ex-tag">예시 프롬프트</span>
              {term.example}
            </p>
          )}
          {sketch && <div className="glossary-sketch">{sketch}</div>}
          <RelatedChips graph={graph} nodeId={nodeId} onChip={onChip} />
        </div>
      )}
    </div>
  );
}

function LiteRow({
  nodeId,
  term,
  open,
  onToggle,
  graph,
  onChip,
}: {
  nodeId: string;
  term: LiteTerm;
  open: boolean;
  onToggle: () => void;
  graph: Graph;
  onChip: (id: string) => void;
}) {
  const meta = SUBCAT_META[term.subcat];
  const Icon = meta.icon;
  return (
    <div id={`gl-row-${nodeId}`} className={`glossary-lite-row${open ? " expanded" : ""}`}>
      <button className="glossary-lite-head glossary-lite-head-btn" onClick={onToggle}>
        <span className={`bdg ${meta.badge}`}>
          <Icon size={11} /> {meta.label}
        </span>
        <span className="glossary-term">{term.term}</span>
        {term.termKo && <span className="glossary-term-ko">{term.termKo}</span>}
        <span className="glossary-reco-lite-tag">사전</span>
        <span className="glossary-caret">{open ? "▾" : "▸"}</span>
      </button>
      <div className="glossary-lite-blurb">{term.blurb}</div>
      {open && (
        <div className="glossary-detail">
          {term.example && (
            <p className="glossary-example">
              <span className="glossary-ex-tag">예시 프롬프트</span>
              {term.example}
            </p>
          )}
          <RelatedChips graph={graph} nodeId={nodeId} onChip={onChip} />
        </div>
      )}
    </div>
  );
}

function CustomRow({
  nodeId,
  term,
  meta,
  open,
  onToggle,
  graph,
  onChip,
}: {
  nodeId: string;
  term: CustomGlossaryTerm;
  meta: RTSubcat | undefined;
  open: boolean;
  onToggle: () => void;
  graph: Graph;
  onChip: (id: string) => void;
}) {
  const Icon: LucideIcon = meta?.icon ?? Boxes;
  const badge = meta?.badge ?? "bdg-g-custom";
  const label = meta?.label ?? term.subcat;
  const hasRelated = relatedNodes(graph, nodeId).length > 0;
  const expandable = !!term.example || hasRelated;
  return (
    <div id={`gl-row-${nodeId}`} className={`glossary-lite-row${open ? " expanded" : ""}`}>
      {expandable ? (
        <button className="glossary-lite-head glossary-lite-head-btn" onClick={onToggle}>
          <span className={`bdg ${badge}`}>
            <Icon size={11} /> {label}
          </span>
          <span className="glossary-term">{term.term}</span>
          {term.termKo && <span className="glossary-term-ko">{term.termKo}</span>}
          <span className="glossary-reco-lite-tag">내 용어</span>
          <span className="glossary-caret">{open ? "▾" : "▸"}</span>
        </button>
      ) : (
        <div className="glossary-lite-head">
          <span className={`bdg ${badge}`}>
            <Icon size={11} /> {label}
          </span>
          <span className="glossary-term">{term.term}</span>
          {term.termKo && <span className="glossary-term-ko">{term.termKo}</span>}
          <span className="glossary-reco-lite-tag">내 용어</span>
        </div>
      )}
      <div className="glossary-lite-blurb">{term.definition}</div>
      {open && expandable && (
        <div className="glossary-detail">
          {term.example && (
            <p className="glossary-example">
              <span className="glossary-ex-tag">예시</span>
              {term.example}
            </p>
          )}
          <RelatedChips graph={graph} nodeId={nodeId} onChip={onChip} />
        </div>
      )}
    </div>
  );
}
