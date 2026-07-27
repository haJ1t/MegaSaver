import { chmodSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalSha256 } from "../src/lm2-benchmark-canonical.js";
import { createLm2BenchmarkLineHandler, dispatchLm2BenchmarkLine } from "../src/lm2-benchmark.js";
import { benchmarkFixture, cleanupBenchmarkRoots } from "./lm2-benchmark-fixtures.js";

const darwinAliasRoots: string[] = [];

afterEach(() => {
  cleanupBenchmarkRoots();
  for (const root of darwinAliasRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function request(payload: object) {
  return JSON.parse(await dispatchLm2BenchmarkLine(JSON.stringify(payload))) as Record<
    string,
    unknown
  >;
}

describe("LM2 stateless benchmark transport", () => {
  it.skipIf(process.platform !== "darwin")(
    "indexes a cache rooted through the protected /tmp system alias",
    async () => {
      const fixture = benchmarkFixture();
      const cacheParent = mkdtempSync("/tmp/megasaver-lm2-benchmark-alias-");
      darwinAliasRoots.push(cacheParent);
      chmodSync(cacheParent, 0o700);
      const config = { ...fixture.config, cacheParent };
      const opened = await request({
        id: "open",
        op: "open",
        config,
        instanceToken: fixture.instanceToken,
      });
      expect(opened).toMatchObject({ ok: true });
      const identity = opened.result as Record<string, string>;
      const inserted = await request({
        id: "insert",
        op: "insert",
        config,
        instanceToken: fixture.instanceToken,
        sentinelToken: identity.sentinelToken,
        expectedChainDigest: identity.chainDigest,
        trajectory: fixture.trajectories[0],
      });
      expect(inserted).toMatchObject({
        ok: true,
        result: { indexingComplete: true },
      });
    },
  );

  it("opens, inserts with synchronous indexing, and queries across independent calls", async () => {
    const fixture = benchmarkFixture();
    const opened = await request({
      id: "open",
      op: "open",
      config: fixture.config,
      instanceToken: fixture.instanceToken,
    });
    const identity = opened.result as Record<string, unknown>;
    expect(opened.ok).toBe(true);
    expect(identity).toMatchObject({ insertedCount: 0 });

    let chainDigest = identity.chainDigest;
    for (const [index, trajectory] of fixture.trajectories.entries()) {
      const inserted = await request({
        id: `insert-${index}`,
        op: "insert",
        config: fixture.config,
        instanceToken: fixture.instanceToken,
        sentinelToken: identity.sentinelToken,
        expectedChainDigest: chainDigest,
        trajectory,
      });
      expect(inserted).toMatchObject({
        ok: true,
        result: { insertedCount: index + 1, indexingComplete: true },
      });
      chainDigest = (inserted.result as Record<string, unknown>).chainDigest;
    }

    const queried = await request({
      id: "query",
      op: "query",
      config: fixture.config,
      instanceToken: fixture.instanceToken,
      sentinelToken: identity.sentinelToken,
      expectedChainDigest: chainDigest,
      questionId: "question-one",
      query: "What is the billing status?",
      queryImagePresent: true,
    });
    expect(queried.ok).toBe(true);
    const result = queried.result as { items: { type: string; value: string }[] };
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.every((item) => item.type === "text" && item.value.trim())).toBe(true);

    const telemetry = readFileSync(
      join(fixture.cacheParent, `instance-${fixture.instanceToken}`, "telemetry", "queries.jsonl"),
      "utf8",
    );
    expect(telemetry).toContain('"questionId":"question-one"');
    expect(telemetry).toContain('"imagePresent":true');
    expect(telemetry).toContain('"imageUsed":false');
    expect(telemetry).not.toContain("billing status is paid");
    expect(telemetry).not.toContain(fixture.root);
  });

  it("serializes concurrent JSONL calls through one handler", async () => {
    const fixture = benchmarkFixture();
    const handle = createLm2BenchmarkLineHandler();
    const opened = JSON.parse(
      await handle(
        JSON.stringify({
          id: "open",
          op: "open",
          config: fixture.config,
          instanceToken: fixture.instanceToken,
        }),
      ),
    );
    const identity = opened.result;
    const first = JSON.stringify({
      id: "first",
      op: "insert",
      config: fixture.config,
      instanceToken: fixture.instanceToken,
      sentinelToken: identity.sentinelToken,
      expectedChainDigest: identity.chainDigest,
      trajectory: fixture.trajectories[0],
    });
    const question = fixture.manifest.questions[0];
    if (question === undefined) throw new Error("Missing fixture question.");
    const firstChainDigest = canonicalSha256([question.trajectories[0]]);
    const second = JSON.stringify({
      id: "second",
      op: "insert",
      config: fixture.config,
      instanceToken: fixture.instanceToken,
      sentinelToken: identity.sentinelToken,
      expectedChainDigest: firstChainDigest,
      trajectory: fixture.trajectories[1],
    });

    const [left, right] = await Promise.all([handle(first), handle(second)]);

    expect(JSON.parse(left)).toMatchObject({ ok: true, result: { insertedCount: 1 } });
    expect(JSON.parse(right)).toMatchObject({ ok: true, result: { insertedCount: 2 } });
  });
});
