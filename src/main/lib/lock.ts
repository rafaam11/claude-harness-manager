/**
 * in-process 비동기 뮤텍스. 모든 쓰기 연산(safe-write, archive move/restore)을
 * 단일 락으로 직렬화한다. 서버 인스턴스가 하나뿐이므로 프로세스 내 락으로 충분.
 */
let chain: Promise<void> = Promise.resolve();

export function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = chain.then(fn);
  chain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
