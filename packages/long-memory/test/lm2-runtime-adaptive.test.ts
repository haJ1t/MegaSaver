import { afterEach, describe, expect, it, vi } from "vitest";
import { modelDescriptorFingerprint } from "../src/lm2-identity.js";
import type { EmbeddingPort } from "../src/lm2-model.js";
import { createLm2Runtime } from "../src/lm2-runtime.js";
import {
  cleanupRuntimeRoots,
  createRuntimeRoot,
  lm1Ports,
  primaryModel,
  runtimeConfig,
  secondaryModel,
  snapshotInput,
  workspaceKey,
} from "./lm2-runtime-fixtures.js";

afterEach(cleanupRuntimeRoots);

describe("LM2 runtime Adaptive composition", () => {
  it("uses only the active model and passes fused order through LM1 selection", async () => {
    const calls: { modelId: string; purpose: string }[] = [];
    const embedding: EmbeddingPort = {
      egress: "local",
      async embed({ model, purpose, texts }) {
        calls.push({ modelId: model.modelId, purpose });
        return {
          modelFingerprint: modelDescriptorFingerprint(model),
          vectors: texts.map((text) =>
            purpose === "query" || text.includes("invoice") ? [1, 0] : [0, 1],
          ),
        };
      },
    };
    const stringClock = vi.fn(() => "2026-07-20T00:00:01.000Z");
    const monotonicClock = { now: vi.fn().mockReturnValueOnce(10).mockReturnValue(11) };
    const config = runtimeConfig({
      admittedModels: [primaryModel, secondaryModel],
      activeModel: secondaryModel,
    });
    const runtime = createLm2Runtime({
      storeRoot: createRuntimeRoot(),
      ...lm1Ports(),
      clock: { now: stringClock },
      monotonicClock,
      embedding,
      config,
    });
    for (const [index, text, observedAt] of [
      [1, "billing payment billing payment", "2026-07-20T00:00:00.000Z"],
      [2, "invoice settled", "2026-07-20T00:00:01.000Z"],
    ] as const) {
      const prepared = runtime.capture.prepare(snapshotInput(index, text, observedAt));
      await runtime.capture.capturePrepared({ prepared, authorization: "signed" });
    }
    await runtime.index({
      workspaceKey,
      modelFingerprint: modelDescriptorFingerprint(secondaryModel),
      maxRecords: 2,
    });
    const result = await runtime.recall({
      workspaceKey,
      task: "billing payment",
      tokenBudget: 4,
      profile: "adaptive",
    });

    expect(result.items).toEqual([expect.objectContaining({ value: "invoice settled" })]);
    expect(result.receipt.hybrid.semanticStatus).toBe("used");
    expect(calls.map(({ modelId }) => modelId)).toEqual(["secondary", "secondary"]);
    expect(stringClock).toHaveBeenCalledTimes(2);
    expect(monotonicClock.now).toHaveBeenCalled();
  });

  it("rejects untrusted model fingerprints before indexing I/O", async () => {
    const embedding: EmbeddingPort = { egress: "local", embed: vi.fn() };
    const runtime = createLm2Runtime({
      storeRoot: createRuntimeRoot(),
      ...lm1Ports(),
      clock: { now: () => "2026-07-20T00:00:01.000Z" },
      monotonicClock: { now: () => 10 },
      embedding,
      config: runtimeConfig(),
    });

    await expect(
      runtime.index({ workspaceKey, modelFingerprint: "f".repeat(64), maxRecords: 1 }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(embedding.embed).not.toHaveBeenCalled();
  });

  it("validates config and active model before reading structural ports", () => {
    let reads = 0;
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          reads += 1;
          throw new Error("hostile");
        },
      },
    );
    const base = {
      storeRoot: createRuntimeRoot(),
      ...lm1Ports(),
      clock: { now: () => "2026-07-20T00:00:01.000Z" },
      monotonicClock: { now: () => 10 },
      embedding: hostile as never,
    };

    expect(() => createLm2Runtime({ ...base, config: {} })).toThrow(
      expect.objectContaining({ code: "invalid_input" }),
    );
    expect(() =>
      createLm2Runtime({
        ...base,
        config: { ...runtimeConfig(), activeRecallModelFingerprint: "f".repeat(64) },
      }),
    ).toThrow(expect.objectContaining({ code: "invalid_input" }));
    expect(reads).toBe(0);
  });
});
