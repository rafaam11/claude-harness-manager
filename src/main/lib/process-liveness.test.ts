import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { parseWindowsProcessProbe, runningProcessIds } from "./process-liveness.js";

const onWindows = process.platform === "win32";

/** 프로덕션 프로브와 똑같이 `[string]$p.CreationDate`로 뽑아야 값이 일치한다. */
function windowsStartToken(pid: number): string {
  return execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `[string](Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CreationDate`,
    ],
    { encoding: "utf8", windowsHide: true },
  ).trim();
}

describe("process liveness probes", () => {
  it("requires the process probe to explicitly confirm a matching PID and start token", () => {
    expect(
      parseWindowsProcessProbe(JSON.stringify([{ id: "claude:one", running: true }, { id: "claude:old", running: false }])),
    ).toEqual(new Set(["claude:one"]));
    expect(parseWindowsProcessProbe(JSON.stringify({ id: "claude:only", running: true }))).toEqual(
      new Set(["claude:only"]),
    );
  });
});

// 파서 단위 테스트로는 절대 못 잡는 부류의 버그를 막는다: PowerShell을 실제로 띄워 입력이 전달되는지 본다.
// (powershell.exe -Command "<스크립트>" <인자> 는 $args를 채우지 않아, 예전엔 프로브가 항상 빈 결과였다.)
describe.runIf(onWindows)("Windows 프로세스 프로브 실제 실행", () => {
  it("살아있는 프로세스를 정확한 startToken과 함께 주면 실행 중으로 판정한다", async () => {
    const startToken = windowsStartToken(process.pid);
    expect(startToken).not.toBe("");

    await expect(runningProcessIds([{ id: "self", pid: process.pid, startToken }])).resolves.toEqual(
      new Set(["self"]),
    );
  });

  it("startToken이 다르면(PID 재사용) 실행 중으로 보지 않는다", async () => {
    await expect(
      runningProcessIds([{ id: "self", pid: process.pid, startToken: "20000101000000.000000+540" }]),
    ).resolves.toEqual(new Set());
  });
});
