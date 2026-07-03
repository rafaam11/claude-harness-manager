// News 탭 IPC 계약. main(services/news.ts)이 아홉 소스를 fetch·정규화한 응답 형태와 1:1 대응한다.
// 분량상 별도 파일로 분리하고 types.ts가 re-export한다(git-types.ts 선례).

/** 뉴스 소스 식별자. UI 배지·소스별 상태에 쓴다. claude-code/anthropic 외 나머지는 모두 한국어 RSS 소스. */
export type NewsSource =
  | "claude-code"
  | "anthropic"
  | "geeknews"
  | "aitimes"
  | "yozm"
  | "etnews"
  | "zdnet"
  | "irobot"
  | "hankyung";

/**
 * 아홉 소스를 시각 역순으로 병합하기 위한 정규화 항목.
 * - claude-code: GitHub 릴리스. body(패치노트 마크다운)를 앱 내에서 렌더.
 * - anthropic: 제목만, 원문은 OS 브라우저로 연다.
 * - geeknews / aitimes / yozm / etnews / zdnet / irobot / hankyung: 한국어 RSS. summary(평문 발췌)를 앱 내에서 표시.
 */
export interface NewsItem {
  /**
   * 소스별 안정 키(cc-<tag> / anthropic-<slug> / gn-<id> / at-<idxno> / yozm-<path> /
   * et-<path> / zd-<path> / rb-<idxno> / hk-<path>). React key + 펼침 키.
   */
  id: string;
  source: NewsSource;
  title: string;
  /** 원문 절대 URL(anthropic은 base + 상대경로로 절대화). 원문 열기 대상. */
  url: string;
  /** published_at/pubDate의 epoch ms(요즘IT는 pubDate 부재 → 최초 발견 시각). 병합 정렬 키. */
  timestamp: number;
  /** claude-code 릴리스 패치노트 마크다운(앱 내 marked 렌더). 다른 소스는 없음. */
  body?: string;
  /** RSS description 발췌 평문(태그 제거·줄바꿈 보존). 한국어 RSS 소스만. */
  summary?: string;
  /** 대표 이미지 절대 URL. 피드 인라인 이미지(지디넷·요즘IT)만 여기 채워지고, 없으면 renderer가 펼칠 때 og:image를 lazy로 채운다. */
  image?: string;
  /** 보조 표시(예: anthropic 카테고리). 선택. */
  meta?: string;
}

/** 소스별 마지막 fetch 결과. graceful degradation — 한 소스 실패해도 ok 소스는 표시한다. */
export interface NewsSourceStatus {
  source: NewsSource;
  ok: boolean;
  /** 이 소스에서 가져온 항목 수. */
  count: number;
  /** 실패 시 사람이 읽을 메시지(타임아웃/HTTP 코드/파싱 빈 결과). */
  error?: string;
  /** 이 소스를 마지막으로 성공 fetch한 epoch ms(실패면 직전 성공값 보존). */
  fetchedAt: number;
}

/** /api/news 응답 = 디스크 캐시 스키마. items는 이미 병합·역순 정렬됨. */
export interface NewsFeed {
  version: 1;
  items: NewsItem[];
  /** 길이 9 고정(claude-code/anthropic/geeknews/aitimes/yozm/etnews/zdnet/irobot/hankyung 순). */
  sources: NewsSourceStatus[];
  /** 전체 새로고침을 마지막으로 시도한 epoch ms("마지막 갱신: N분 전"). */
  lastFetch: number;
}
