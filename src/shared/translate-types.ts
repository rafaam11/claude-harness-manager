// News 탭 번역·시크릿 IPC 계약. main(services/translate.ts, lib/secrets.ts)과 1:1 대응한다.
// 분량상 별도 파일로 분리하고 types.ts가 re-export한다(news-types.ts/git-types.ts 선례).

/** 현재는 한국어 한 방향만(원문은 항상 영어 가정). 확장 여지 위해 리터럴 유지. */
export type TranslateTarget = "ko";

/** 번역 불가/부분 실패 사유. News/GitHub Stars 번역 응답과 main의 DeepL 클라이언트가 공유한다. */
export type TranslateReason = "no-key" | "rate-limit" | "auth" | "network" | "partial";

/** POST /api/news/translate 요청. 보이는(혹은 펼친) 항목 id 묶음만 보낸다(원문은 main이 캐시 피드에서 해석). */
export interface TranslateRequest {
  ids: string[];
  target: TranslateTarget;
  /** true면 본문(body)까지 번역(펼침 시). false/생략이면 제목만(목록 표시용). */
  withBody?: boolean;
}

/** 한 항목의 번역 결과. translation-cache.json 항목과 동일 형태. */
export interface ItemTranslation {
  titleKo: string;
  /** body 보유 항목(claude-code)을 withBody로 요청했을 때만. */
  bodyKo?: string;
}

/** POST /api/news/translate 응답: 성공분만 담는 맵(부분 실패해도 200). id → 번역. */
export interface TranslateResponse {
  translations: Record<string, ItemTranslation>;
  /** 번역 불가 상태(키 미설정/전량 실패)의 사람이 읽는 사유. 성공분 있으면 생략. */
  error?: string;
  /** UI 분기용(no-key면 입력 패널 노출). */
  reason?: TranslateReason;
}

/** GET /api/app/secrets/deepl 응답. 키 자체는 절대 반환하지 않는다(존재 여부만). */
export interface SecretStatus {
  configured: boolean;
}

/** POST /api/app/secrets/deepl 요청. 빈 문자열이면 키 삭제(해제). */
export interface SetDeepLKeyRequest {
  key: string;
}
