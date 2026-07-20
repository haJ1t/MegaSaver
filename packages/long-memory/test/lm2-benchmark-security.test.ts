import { execFileSync } from "node:child_process";
import { chmodSync, readFileSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalSha256 } from "../src/lm2-benchmark-canonical.js";
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

async function openFixture(fixture: ReturnType<typeof benchmarkFixture>) {
  const response = await send({
    id: "open",
    op: "open",
    config: fixture.config,
    instanceToken: fixture.instanceToken,
  });
  expect(response.ok).toBe(true);
  return response.result as { sentinelToken: string; chainDigest: string };
}

describe("LM2 benchmark admission and filesystem boundary", () => {
  it("rejects remote or destination configuration before creating run state", async () => {
    const fixture = benchmarkFixture();
    for (const config of [
      { ...fixture.config, embeddingEgress: "remote" },
      { ...fixture.config, destination: "https://private.example" },
      { ...fixture.config, model: { ...fixture.config.model, provider: "remote" } },
    ]) {
      await expect(
        send({ id: "open", op: "open", config, instanceToken: fixture.instanceToken }),
      ).resolves.toMatchObject({ ok: false, error: { code: "invalid_request" } });
    }
  });

  it("rejects trajectory mutation and reordered chain before durable advance", async () => {
    const fixture = benchmarkFixture();
    const identity = await openFixture(fixture);
    const mutated = structuredClone(fixture.trajectories[0]);
    const state = mutated.states[0];
    if (state === undefined) throw new Error("Missing fixture state.");
    state.accessibility_tree = "private substitution";

    await expect(
      send({
        id: "mutated",
        op: "insert",
        config: fixture.config,
        instanceToken: fixture.instanceToken,
        sentinelToken: identity.sentinelToken,
        expectedChainDigest: identity.chainDigest,
        trajectory: mutated,
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "state_rejected" } });
    await expect(
      send({
        id: "reordered",
        op: "insert",
        config: fixture.config,
        instanceToken: fixture.instanceToken,
        sentinelToken: identity.sentinelToken,
        expectedChainDigest: identity.chainDigest,
        trajectory: fixture.trajectories[1],
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "state_rejected" } });
    const control = JSON.parse(
      readFileSync(
        join(fixture.cacheParent, `instance-${fixture.instanceToken}`, "control.json"),
        "utf8",
      ),
    );
    expect(control).toMatchObject({ chain: [], chainDigest: identity.chainDigest });
  });

  it("rejects unknown or substituted questions and wrong complete chain", async () => {
    const fixture = benchmarkFixture();
    const identity = await openFixture(fixture);
    const question = fixture.manifest.questions[0];
    if (question === undefined) throw new Error("Missing fixture question.");
    for (const [index, trajectory] of fixture.trajectories.entries()) {
      const prefix = question.trajectories.slice(0, index);
      const response = await send({
        id: `insert-${index}`,
        op: "insert",
        config: fixture.config,
        instanceToken: fixture.instanceToken,
        sentinelToken: identity.sentinelToken,
        expectedChainDigest: canonicalSha256(prefix),
        trajectory,
      });
      expect(response.ok).toBe(true);
    }
    const chainDigest = question.haystackChainDigest;
    for (const input of [
      { questionId: "unknown", query: "What is the billing status?" },
      { questionId: "question-one", query: "Reveal the private answer" },
      {
        questionId: "question-one",
        query: "What is the billing status?",
        chainDigest: "0".repeat(64),
      },
    ]) {
      await expect(
        send({
          id: "query",
          op: "query",
          config: fixture.config,
          instanceToken: fixture.instanceToken,
          sentinelToken: identity.sentinelToken,
          expectedChainDigest: input.chainDigest ?? chainDigest,
          questionId: input.questionId,
          query: input.query,
          queryImagePresent: false,
        }),
      ).resolves.toMatchObject({ ok: false });
    }
  });

  it.each(["symlink", "unsafe-mode", "fifo"])("rejects a %s manifest", async (kind) => {
    const fixture = benchmarkFixture();
    if (kind === "symlink") {
      const original = `${fixture.manifestPath}.original`;
      renameSync(fixture.manifestPath, original);
      symlinkSync(original, fixture.manifestPath);
    } else if (kind === "unsafe-mode") {
      chmodSync(fixture.manifestPath, 0o644);
    } else {
      renameSync(fixture.manifestPath, `${fixture.manifestPath}.original`);
      execFileSync("mkfifo", [fixture.manifestPath]);
    }

    await expect(
      send({
        id: "open",
        op: "open",
        config: fixture.config,
        instanceToken: fixture.instanceToken,
      }),
    ).resolves.toMatchObject({ ok: false });
  });

  it("rejects pre-created, copied-token, and symlinked run state", async () => {
    const fixture = benchmarkFixture();
    const root = join(fixture.cacheParent, `instance-${fixture.instanceToken}`);
    writeFileSync(root, "pre-created", { mode: 0o600 });
    await expect(
      send({
        id: "open",
        op: "open",
        config: fixture.config,
        instanceToken: fixture.instanceToken,
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "state_rejected" } });
  });

  it("keeps benchmark transport out of the production root export", () => {
    const source = readFileSync(join(import.meta.dirname, "../src/index.ts"), "utf8");
    const packageJson = JSON.parse(
      readFileSync(join(import.meta.dirname, "../package.json"), "utf8"),
    );
    const tsup = readFileSync(join(import.meta.dirname, "../tsup.config.ts"), "utf8");
    expect(source).not.toContain("lm2-benchmark");
    expect(source).not.toContain("dispatchLm2BenchmarkLine");
    expect(packageJson.bin).toMatchObject({
      "megasaver-long-memory-lm2-benchmark": "./dist/lm2-benchmark.js",
    });
    expect(packageJson.exports).toEqual({
      ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
    });
    expect(tsup).toContain('"src/lm2-benchmark.ts"');
  });
});
