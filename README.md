# claude-harness-manager

Claude Code 전역 환경(`~/.claude`)을 관리하는 로컬 웹 대시보드.

## 실행

```
npm install
npm run dev
```

- 서버: http://127.0.0.1:7860 (API)
- 웹: http://127.0.0.1:5173 (`/api`는 서버로 proxy)

## 기능

| 페이지 | 내용 |
|---|---|
| Overview | 스킬·에이전트·플러그인·프로젝트 수, stale 경고, 마지막 점검일 |
| Catalog | 플러그인 활성 상태, 개인 스킬·에이전트·커맨드 목록 (19KB 경고) |
| Memory | 프로젝트별 트랜스크립트·메모리 브라우저 (읽기 전용) |
| Cleanup | 규칙 기반 정리 후보 스캔 → dry-run → 아카이브 이동 → manifest 복구 |
| Config Editor | settings.json·settings.local.json 편집 (.claude.json은 읽기 전용) |

## 안전장치

- 모든 파일 연산은 `~/.claude` + `~/.claude.json` 경로 allowlist 내에서만 (path-guard)
- 쓰기: baseHash 대조(불일치 409) → 구조 검증 → 평문 .bak 백업(20개 로테이션) → atomic rename
- 정리: 삭제 API 없음 — 항상 archive로 move + manifest/journal 기록, 단건 복구 지원
- 127.0.0.1 바인드 + Host 헤더 검사 (DNS rebinding 방어)
- `.claude.json`은 읽기 전용 (Claude Code가 상시 재작성 — 수동 절차로만 수정)
