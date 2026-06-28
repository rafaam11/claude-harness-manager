// 커스텀 용어집(개인화) IPC 계약. main이 ~/.claude/harness-manager/glossary-custom.json을
// 읽기 전용으로 읽어 renderer로 내려준다. 사용자가 자기 Claude Code로 이 파일을 채운다.

export interface CustomGlossarySubcat {
  id: string; // 도메인 내 고유 (renderer에서 custom:<domain>:<subcat>로 격리)
  label: string;
}

export interface CustomGlossaryDomain {
  id: string; // 파일 내 고유 (renderer에서 custom:<domain>로 격리)
  label: string;
  subcats: CustomGlossarySubcat[];
}

export interface CustomGlossaryTerm {
  term: string; // 영어 원어
  termKo: string; // 한국어 병기
  domain: string; // 위 domains[].id 참조
  subcat: string; // 해당 domain의 subcats[].id 참조
  definition: string; // 한 줄 정의(한국어)
  aliases?: string[]; // 검색·추천 감지용 풀어쓰기
  example?: string; // ✅ 좋은 예시 프롬프트
}

export interface CustomGlossaryData {
  version: 1;
  domains: CustomGlossaryDomain[];
  terms: CustomGlossaryTerm[];
}

// GET /api/glossary/custom 응답. path=가이드 패널의 "폴더 열기"용 절대경로, exists=파일 존재 여부.
export interface CustomGlossaryResponse {
  data: CustomGlossaryData;
  path: string;
  exists: boolean;
}
