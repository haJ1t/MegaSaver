import { closeSync, openSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { replaceBenchmarkControl, withBenchmarkRunLock } from "../src/lm2-benchmark-files.js";
import { dispatchLm2BenchmarkLine } from "../src/lm2-benchmark.js";
import { benchmarkFixture, cleanupBenchmarkRoots } from "./lm2-benchmark-fixtures.js";

afterEach(cleanupBenchmarkRoots);

async function send(payload: object) {
  return JSON.parse(await dispatchLm2BenchmarkLine(JSON.stringify(payload))) as {
    ok: boolean;
    result?: Record<string, unknown>;
    error?: { code: string };
  };
}

async function openedFixture() {
  const fixture = benchmarkFixture();
  const opened = await send({
    id: "open",
    op: "open",
    config: fixture.config,
    instanceToken: fixture.instanceToken,
  });
  expect(opened.ok).toBe(true);
  const identity = opened.result as { sentinelToken: string; chainDigest: string };
  const root = join(fixture.cacheParent, `instance-${fixture.instanceToken}`);
  return { fixture, identity, root };
}

describe("LM2 benchmark fixed run lock", () => {
  it("rejects a lock pathname replaced before a later operation", async () => {
    const { fixture, identity, root } = await openedFixture();
    renameSync(join(root, "run.lock"), join(root, "run.lock.original"));
    const replacement = openSync(join(root, "run.lock"), "wx", 0o600);
    closeSync(replacement);

    const response = await send({
      id: "insert",
      op: "insert",
      config: fixture.config,
      instanceToken: fixture.instanceToken,
      sentinelToken: identity.sentinelToken,
      expectedChainDigest: identity.chainDigest,
      trajectory: fixture.trajectories[0],
    });

    expect(response).toMatchObject({ ok: false, error: { code: "state_rejected" } });
  });

  it("rejects replacement after flock and before a control write", async () => {
    const { fixture, identity, root } = await openedFixture();

    await expect(
      withBenchmarkRunLock({
        config: fixture.config,
        instanceToken: fixture.instanceToken,
        sentinelToken: identity.sentinelToken,
        async run(handle, control) {
          renameSync(join(root, "run.lock"), join(root, "run.lock.original"));
          writeFileSync(join(root, "run.lock"), "", { flag: "wx", mode: 0o600 });
          replaceBenchmarkControl(handle, control);
        },
      }),
    ).rejects.toMatchObject({ code: "state_rejected" });
  });
});
