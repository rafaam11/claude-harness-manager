// News 탭의 "GitHub Stars" 서브섹션 IPC 계약. news-types.ts와 별도 분리 —
// 데이터 소스(트렌딩 HTML 스크래핑 + Search API)와 갱신 주기(일일 캐시)가 아홉 소스 뉴스와 달라
// NewsItem에 억지로 끼워 넣지 않고 완전히 독립된 타입/서비스/캐시로 둔다.

import type { TranslateReason } from "./translate-types.js";

/** 두 데이터 소스. 병합하지 않고 각 10개씩 별개 목록으로 유지한다. */
export type GitHubStarsGroup = "trending" | "new-popular";

export interface GitHubRepo {
  /** `${group}-${fullName}` — React key. */
  id: string;
  /** "owner/repo". */
  fullName: string;
  description: string | null;
  url: string;
  language: string | null;
  stars: number;
  /** trending 전용. "+N stars today" 파싱 성공 시만 채워진다. */
  starsToday?: number;
  ownerAvatar?: string;
  /** new-popular 전용. epoch ms. */
  createdAt?: number;
  group: GitHubStarsGroup;
}

/** 그룹별 마지막 fetch 결과. graceful degradation — 한 그룹 실패해도 다른 그룹은 표시한다. */
export interface GitHubStarsGroupStatus {
  group: GitHubStarsGroup;
  ok: boolean;
  /** 이 그룹에서 가져온 항목 수. */
  count: number;
  /** 실패 시 사람이 읽을 메시지. */
  error?: string;
  fetchedAt: number;
}

/** /api/github-stars 응답 = 디스크 캐시 스키마. */
export interface GitHubStarsFeed {
  version: 1;
  /** 최대 10개. */
  trending: GitHubRepo[];
  /** 최대 10개. */
  newPopular: GitHubRepo[];
  /** 길이 2 고정(trending/new-popular 순). */
  groups: GitHubStarsGroupStatus[];
  /** 전체 새로고침을 마지막으로 시도한 epoch ms. */
  lastFetch: number;
  /** "YYYY-MM-DD"(로컬). 일일 캐시 유효성 판단 키 — 오늘 날짜와 다르면 자동 재fetch 대상. */
  fetchedDay: string;
}

/**
 * 즐겨찾기 저장 항목 = GitHubRepo 스냅샷 + 저장 시각.
 * 트렌딩/신규 인기는 그룹당 10개 상한 캐시라 즐겨찾기한 리포가 새로고침 후 목록에서 빠질 수 있어,
 * id만이 아니라 GitHubRepo 필드 전체를 스냅샷으로 보관해야 즐겨찾기 탭에서 계속 뜬다.
 */
export interface StoredGitHubRepo extends GitHubRepo {
  /** 즐겨찾기에 추가한 epoch ms(main이 서버측에서 기록). */
  savedAt: number;
}

/**
 * /api/github-stars/readme 응답. markdown이 null이고 error가 없으면 "README 없음"(404),
 * error가 있으면 조회 실패 — renderer가 두 상태를 다른 문구로 구분해 보여준다.
 * htmlUrl/downloadUrl은 README 안의 상대 경로(이미지/동영상/링크)를 절대 URL로 풀어내는 기준점으로
 * renderer가 사용한다(README 원문은 리포 루트가 아니라 이 파일 자신을 기준으로 한 상대 경로를 쓴다).
 */
export interface GitHubReadme {
  markdown: string | null;
  /** README를 GitHub 웹에서 보는 blob URL. 상대 링크(href) 해석 기준(클릭 시 GitHub 페이지로 이동). */
  htmlUrl?: string;
  /** README 원본 raw 파일 URL. 상대 미디어 경로(img/video/audio src) 해석 기준. */
  downloadUrl?: string;
  error?: string;
}

/** 리포 하나의 번역 결과(설명/README). github-stars-translation-cache.json 항목과 동일 형태. */
export interface RepoTranslation {
  descriptionKo?: string;
  readmeKo?: string;
}

/** POST /api/github-stars/translate 요청. fullName 묶음만 보낸다(원문은 main이 피드/README 캐시에서 해석). */
export interface GitHubStarsTranslateRequest {
  fullNames: string[];
  /** true면 README 본문까지 번역(상세 패널 진입 시). false/생략이면 설명만(목록 표시용). */
  withReadme?: boolean;
}

/** POST /api/github-stars/translate 응답: 성공분만(부분 실패해도 200). fullName → 번역. */
export interface GitHubStarsTranslateResponse {
  translations: Record<string, RepoTranslation>;
  error?: string;
  reason?: TranslateReason;
}
