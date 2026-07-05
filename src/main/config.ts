import os from "node:os";
import path from "node:path";

export const CLAUDE_HOME = path.join(os.homedir(), ".claude");
export const CLAUDE_JSON = path.join(os.homedir(), ".claude.json");
export const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
export const APP_STATE_DIR = path.join(os.homedir(), ".harness-manager");

// 모든 파일 연산이 허용되는 경로. path-guard가 이 목록으로 검사한다.
export const ALLOWED_ROOTS = [CLAUDE_HOME, CLAUDE_JSON, CODEX_HOME, APP_STATE_DIR];

export const BACKUP_DIR = path.join(CLAUDE_HOME, "backups", "harness-manager");
export const BACKUP_KEEP = 20;

export const ARCHIVE_ROOT = path.join(CLAUDE_HOME, "archive");

export const STALE_DAYS = 30;
export const AGENT_SIZE_WARN_BYTES = 19 * 1024;

// 편집 가능한 설정 파일. claude-json은 MVP에서 읽기 전용 (CC가 상시 재작성).
export const CONFIG_FILES: Record<string, { path: string; writable: boolean }> = {
  settings: { path: path.join(CLAUDE_HOME, "settings.json"), writable: true },
  "settings-local": { path: path.join(CLAUDE_HOME, "settings.local.json"), writable: true },
  "claude-json": { path: CLAUDE_JSON, writable: false },
};

export const TEMP_DIRS = [
  "session-env",
  "plans",
  "file-history",
  "paste-cache",
  "shell-snapshots",
];

// --- Workspace 대시보드 ---
export const PROJECTS_DIR = path.join(CLAUDE_HOME, "projects");
// 워크트리/하위폴더 그룹핑에서 "접기 앵커"가 될 수 없는 넓은 디렉토리들.
// (누가 홈에 git init을 해도 그 하위 세션들이 전부 "홈" 하나로 접히는 것을 막는 방어선.
//  드라이브 루트(C:\)·unix 루트(/)는 repo-group의 isBroadDir가 별도 규칙으로 처리한다.)
export const BROAD_DIRS: readonly string[] = [
  os.homedir(),
  path.join(os.homedir(), "Desktop"),
  path.join(os.homedir(), "Documents"),
  path.join(os.homedir(), "Downloads"),
];
export const PLANS_DIR = path.join(CLAUDE_HOME, "plans");
export const PLANS_ARCHIVE_DIR = path.join(PLANS_DIR, "_archive");
export const HISTORY_FILE = path.join(CLAUDE_HOME, "history.jsonl");
export const TASKS_DIR = path.join(CLAUDE_HOME, "tasks");
// 세션→계획 연결 hook. 다른 PC 설치용 프롬프트 생성(ConfigEditor)이 이 파일 원문을 읽는다.
export const HOOKS_DIR = path.join(CLAUDE_HOME, "hooks");
export const STAMP_PLAN_SESSION_HOOK_FILE = path.join(HOOKS_DIR, "stamp-plan-session.mjs");
// 레거시 board 경로. readBoard가 1회 마이그레이션 소스로만 읽고 새 쓰기는 BOARD_FILE_V2로 간다.
export const BOARD_FILE = path.join(CLAUDE_HOME, "harness-manager", "board.json");
export const APP_BACKUP_DIR = path.join(APP_STATE_DIR, "backups");
export const BOARD_FILE_V2 = path.join(APP_STATE_DIR, "board.json");

// --- News 탭 (라이브 뉴스 통합 피드) ---
// 앱 소유 라이브 뉴스 캐시. board.json과 같은 harness-manager 디렉토리(allowlist 통과).
export const NEWS_CACHE_FILE = path.join(CLAUDE_HOME, "harness-manager", "news-cache.json");
// 뉴스 즐겨찾기(북마크). 피드는 소스별 15개 상한이라 새로고침 시 지난 기사가 빠지므로, 캐시와 분리된
// 앱 소유 파일에 NewsItem 스냅샷을 보관한다(board.json 패턴 — atomic rename + .bak).
export const FAVORITES_FILE = path.join(CLAUDE_HOME, "harness-manager", "favorites.json");
// 각 소스에서 가져올 항목 수(GitHub per_page / anthropic 정규식 매치 상한 / RSS 소스별 상한).
export const NEWS_CLAUDE_COUNT = 15;
export const NEWS_ANTHROPIC_COUNT = 15;
export const NEWS_RSS_COUNT = 15;
// RSS description 발췌 길이 상한(자). 목록/상세의 즉시 미리보기용(전문은 lazy fetch로 대체).
export const NEWS_SUMMARY_MAX = 600;
// 원문 페이지에서 추출한 전문(마크다운) 길이 상한(자). "최대한 많이"라 넉넉히 두되 과대 페이지 폭주만 막는다.
export const NEWS_BODY_MAX = 20000;
// 단일 fetch 타임아웃(AbortController). 외부 소스라 보수적으로.
export const NEWS_FETCH_TIMEOUT_MS = 8000;
// 메모리 캐시 수명. 탭 재진입·중복 GET 시 디스크/네트워크 재방문 방지(recall WORKSPACE_CACHE_TTL_MS 패턴).
export const NEWS_MEMORY_TTL_MS = 60 * 1000;
// 새로고침 최소 간격. 직전 새로고침이 이 안이면 캐시를 그대로 반환(GitHub rate limit 보호, 연타 방지).
export const NEWS_REFRESH_MIN_INTERVAL_MS = 10 * 1000;
// 소스 엔드포인트·쿼리(단일 출처).
export const NEWS_GITHUB_RELEASES_URL =
  "https://api.github.com/repos/anthropics/claude-code/releases";
export const NEWS_ANTHROPIC_URL = "https://www.anthropic.com/news";
export const NEWS_ANTHROPIC_BASE = "https://www.anthropic.com";
// 한국어 커뮤니티 RSS 피드(요약 본문 포함). geeknews는 Atom, 나머지는 RSS 2.0.
export const NEWS_GEEKNEWS_URL = "https://news.hada.io/rss/news";
export const NEWS_AITIMES_URL = "https://www.aitimes.com/rss/allArticle.xml";
export const NEWS_YOZM_URL = "https://yozm.wishket.com/magazine/feed/";
// 한국어 IT/AI 매체 RSS 피드(모두 RSS 2.0, pubDate 포함).
export const NEWS_ETNEWS_URL = "http://rss.etnews.com/04046.xml";
export const NEWS_ZDNET_URL = "https://feeds.feedburner.com/zdkorea";
export const NEWS_IROBOT_URL = "https://www.irobotnews.com/rss/allArticle.xml";
export const NEWS_HANKYUNG_URL = "https://www.hankyung.com/feed/it";

// --- News 번역(DeepL) / 시크릿 ---
// 앱 소유 시크릿. board.json과 분리(이유: board.json은 .bak에 평문 키가 누적됨).
export const SECRET_FILE = path.join(CLAUDE_HOME, "harness-manager", "secrets.json");
// 번역 캐시. 뉴스 fetch와 독립(id 안정 키로 새로고침 carry-over).
export const TRANSLATION_CACHE_FILE = path.join(
  CLAUDE_HOME,
  "harness-manager",
  "translation-cache.json",
);
// Free 키는 ":fx"로 끝남 → 키 접미사로 엔드포인트 자동 선택(translate.ts).
export const DEEPL_FREE_URL = "https://api-free.deepl.com/v2/translate";
export const DEEPL_PRO_URL = "https://api.deepl.com/v2/translate";
// DeepL 호출 타임아웃(AbortController). 본문이 길어 news fetch(8s)보다 여유.
export const DEEPL_TIMEOUT_MS = 12000;
// text 배열 상한(DeepL 스펙). 제목 배치 크기.
export const DEEPL_MAX_BATCH = 50;
// 바디 128KiB 한도에 여유를 둔 본문 분할 기준(바이트).
export const DEEPL_MAX_BODY_BYTES = 100 * 1024;
// 영어로 유지할 고유명사 화이트리스트(마스킹 보강). 단어 경계로만 매치, 표기 그대로 복원.
export const TRANSLATION_GLOSSARY: readonly string[] = [
  "Claude Code",
  "Claude",
  "Anthropic",
  "MCP",
  "API",
  "SDK",
  "CLI",
  "OpenAI",
  "Gemini",
  "GitHub",
  "Hacker News",
  "LLM",
  "RAG",
  "JSON",
  "npm",
  "Electron",
  "TypeScript",
  "React",
];

// transcript 끝에서 이만큼만 읽어 ai-title/last-prompt/마지막 응답을 추출한다.
export const RECALL_TAIL_BYTES = 512 * 1024;
// tail에 신호가 전무할 때만 readline 스트리밍 폴백을 허용하는 상한.
export const RECALL_MAX_FULL_SCAN_BYTES = 8 * 1024 * 1024;
// 무거운 스캔(recall/plans/history) 결과 캐시 수명.
export const WORKSPACE_CACHE_TTL_MS = 5000;
// repo-group의 git 토폴로지(rev-parse) 캐시 수명. 사실상 안정적이라 WORKSPACE_CACHE_TTL_MS보다
// 오래 두되, 워크트리 생성/삭제 등 구조 변화가 앱 재시작 없이도 결국 반영되도록 무한 캐시는 피한다.
export const REPO_TOPOLOGY_CACHE_TTL_MS = 5 * 60 * 1000;
// 계획 파일 mtime과 history 기록의 시각차가 이 안이면 같은 프로젝트로 추정.
export const PLAN_GUESS_WINDOW_MS = 6 * 60 * 60 * 1000;

// --- Glossary 추천 어휘 (로컬 프롬프트 분석) ---
// 최근 활동순 상위 N개 프로젝트의 최신 transcript에서 distinct user 프롬프트를 모아 corpus를 만든다.
// 외부 호출 0(로컬 분석). 매칭은 renderer가 자기 용어집 데이터로 수행한다.
export const GLOSSARY_CORPUS_MAX_PROJECTS = 12;
export const GLOSSARY_PROMPTS_PER_PROJECT = 8;
export const GLOSSARY_CORPUS_MAX_TEXTS = 96;
export const GLOSSARY_PROMPT_MAX = 2000;

// 커스텀 용어집(개인화). 사용자가 자기 Claude Code로 채우는 파일 — 앱은 읽기 전용.
// board.json과 같은 harness-manager 디렉토리(allowlist 통과). 손상/없음에도 생존.
export const GLOSSARY_CUSTOM_FILE = path.join(
  CLAUDE_HOME,
  "harness-manager",
  "glossary-custom.json",
);
// sanitize 상한(오타·악의 입력 방어). 초과분은 잘림.
export const GLOSSARY_CUSTOM_MAX_DOMAINS = 12;
export const GLOSSARY_CUSTOM_MAX_SUBCATS = 12; // per domain
export const GLOSSARY_CUSTOM_MAX_TERMS = 500;
export const GLOSSARY_CUSTOM_LABEL_MAX = 60;
export const GLOSSARY_CUSTOM_DEF_MAX = 400;
