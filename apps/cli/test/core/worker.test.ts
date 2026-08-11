import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isBundleStale, runOnDemandWorker, spawnOnDemandWorker } from "../../src/core/worker.js";

describe("on-demand worker", () => {
  it("stale bundle refuses", () => {
    expect(isBundleStale("/tmp/bundle-missing-xyz-123.mjs")).toBe(true);
  });

  it("echoes one request via runOnDemandWorker", async () => {
    // Test runOnDemandWorker directly with mocked streams
    const { PassThrough } = await import("node:stream");
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    let out = "";
    stdout.on("data", (c: Buffer) => {
      out += c.toString();
    });
    const p = runOnDemandWorker({
      bundlePath: "dummy",
      stdin: stdin as never,
      stdout: stdout as never,
    });
    stdin.write(`${JSON.stringify({ cmd: "sessions:live", args: [] })}\n`);
    stdin.end();
    const code = await p;
    expect(code).toBe(0);
    expect(out).toContain("ok");
    expect(JSON.parse(out.trim()).echo.cmd).toBe("sessions:live");
  });

  it("timeout kills", async () => {
    // Create a mock bundle that sleeps 11s (exceeds 10s timeout)
    const dir = mkdtempSync(join(tmpdir(), "worker-timeout-"));
    const bundlePath = join(dir, "sleep.mjs");
    writeFileSync(
      bundlePath,
      `import { setTimeout } from "node:timers"; setTimeout(()=>{}, 11000);`,
    );
    await expect(
      spawnOnDemandWorker({ bundlePath, home: tmpdir(), request: { cmd: "test" } }),
    ).rejects.toThrow(/timeout/);
    rmSync(dir, { recursive: true, force: true });
  }, 15_000);
});
