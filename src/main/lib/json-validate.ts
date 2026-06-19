/**
 * 설정 파일 쓰기 전 구조 검증.
 * schemastore 스키마 대신 수동 구조 검사를 사용한다 — 이 환경의 settings.json은
 * env성 키(MAX_THINKING_TOKENS 등)가 최상위에 있어 공개 스키마와 맞지 않는다.
 * 목적은 "CC 기동을 깨뜨리는 저장"을 막는 것: 파싱 가능 + 핵심 키 타입 보존.
 */
export class ValidationError extends Error {
  statusCode = 422;
}

export function parseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch (e) {
    throw new ValidationError(`JSON 파싱 실패: ${(e as Error).message}`);
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function validateConfig(name: string, content: string): void {
  const data = parseJson(content);
  if (!isObject(data)) throw new ValidationError("최상위가 JSON object가 아닙니다");

  if (name === "settings") {
    if ("hooks" in data && !isObject(data.hooks))
      throw new ValidationError("hooks는 object여야 합니다");
    if ("enabledPlugins" in data && !isObject(data.enabledPlugins))
      throw new ValidationError("enabledPlugins는 object여야 합니다");
    if ("permissions" in data && !isObject(data.permissions))
      throw new ValidationError("permissions는 object여야 합니다");
    if ("statusLine" in data && !isObject(data.statusLine))
      throw new ValidationError("statusLine은 object여야 합니다");
  }

  if (name === "settings-local") {
    if ("permissions" in data && !isObject(data.permissions))
      throw new ValidationError("permissions는 object여야 합니다");
  }

  if (name === "claude-json") {
    if ("projects" in data && !isObject(data.projects))
      throw new ValidationError("projects는 object여야 합니다");
  }
}
