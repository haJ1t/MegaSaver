import { afterEach, describe, expect, it, vi } from "vitest";
import type { EmbeddingPort } from "../src/lm2-model.js";
import { createLm2Runtime } from "../src/lm2-runtime.js";
import {
  cleanupRuntimeRoots,
  createRuntimeRoot,
  lm1Ports,
  localEmbedding,
  primaryModel,
  remoteApproval,
  runtimeConfig,
  snapshotInput,
  workspaceKey,
} from "./lm2-runtime-fixtures.js";

afterEach(cleanupRuntimeRoots);

function create(input: {
  config?: ReturnType<typeof runtimeConfig>;
  embedding?: unknown;
  approval?: unknown;
}) {
  return createLm2Runtime({
    storeRoot: createRuntimeRoot(),
    ...lm1Ports(),
    clock: { now: () => "2026-07-20T00:00:01.000Z" },
    monotonicClock: { now: () => 10 },
    config: input.config ?? runtimeConfig(),
    embedding: input.embedding as EmbeddingPort | undefined,
    ...(input.approval === undefined ? {} : { remoteApproval: input.approval as never }),
  });
}

async function degradedReason(runtime: ReturnType<typeof createLm2Runtime>) {
  const prepared = runtime.capture.prepare(
    snapshotInput(1, "Billing status paid", "2026-07-20T00:00:00.000Z"),
  );
  await runtime.capture.capturePrepared({ prepared, authorization: "signed" });
  const result = await runtime.recall({
    workspaceKey,
    task: "billing",
    tokenBudget: 100,
    profile: "adaptive",
  });
  return result.receipt.hybrid.semanticReasons;
}

describe("LM2 runtime capability matrix", () => {
  it("rejects invalid local and remote approval composition before embedding inspection", () => {
    let reads = 0;
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          reads += 1;
          throw new Error("hostile embedding");
        },
      },
    );

    expect(() => create({ embedding: hostile, approval: remoteApproval() })).toThrow(
      expect.objectContaining({ code: "invalid_input" }),
    );
    expect(() =>
      create({ config: runtimeConfig({ egress: "remote" }), embedding: hostile }),
    ).toThrow(expect.objectContaining({ code: "invalid_input" }));
    expect(reads).toBe(0);
  });

  it.each([
    [undefined, "embedding_port_unreadable"],
    [
      new Proxy(
        {},
        {
          ownKeys: () => {
            throw new Error("hostile");
          },
        },
      ),
      "embedding_port_unreadable",
    ],
    [{ ...localEmbedding(), egress: "remote" }, "embedding_egress_mismatch"],
  ] as const)("degrades each invalid local capability", async (embedding, reason) => {
    const runtime = create({ embedding });
    await expect(degradedReason(runtime)).resolves.toEqual([reason]);
    await expect(
      runtime.index({
        workspaceKey,
        modelFingerprint: runtimeConfig().activeRecallModelFingerprint,
        maxRecords: 1,
        cursor: "cursor-1",
      }),
    ).resolves.toMatchObject({
      outcome: "retry",
      retryCursor: "cursor-1",
      quotaRecovery: "not_needed",
      transientReason: "embedding_failure",
    });
  });

  it.each([
    [undefined, remoteApproval(), "embedding_port_unreadable"],
    [
      { egress: "remote", embed: vi.fn() },
      new Proxy(
        {},
        {
          ownKeys: () => {
            throw new Error("hostile");
          },
        },
      ),
      "approval_port_unreadable",
    ],
    [localEmbedding(), remoteApproval(), "embedding_egress_mismatch"],
  ] as const)("degrades each invalid remote capability", async (embedding, approval, reason) => {
    const config = runtimeConfig({ egress: "remote" });
    const runtime = create({ config, embedding, approval });
    await expect(degradedReason(runtime)).resolves.toEqual([reason]);
    await expect(
      runtime.index({
        workspaceKey,
        modelFingerprint: config.activeRecallModelFingerprint,
        maxRecords: 1,
      }),
    ).resolves.toMatchObject({
      transientReason:
        reason === "approval_port_unreadable" ? "remote_approval_denied" : "embedding_failure",
    });
  });

  it.each([undefined, "denied", "revoked", "unreadable"] as const)(
    "degrades a readable remote capability without current approval (%s)",
    async (approvalResult) => {
      const approvalRef = "approval-1";
      const config = runtimeConfig({
        egress: "remote",
        approvals:
          approvalResult === undefined
            ? []
            : [
                {
                  workspaceKey,
                  modelFingerprint: runtimeConfig().activeRecallModelFingerprint,
                  approvalRef,
                },
              ],
      });
      const embedding: EmbeddingPort = {
        egress: "remote",
        embed: vi.fn(async ({ texts }) => ({
          modelFingerprint: config.activeRecallModelFingerprint,
          vectors: texts.map(() => [1, 0]),
        })),
      };
      const runtime = create({
        config,
        embedding,
        approval: remoteApproval(approvalResult ?? "approved"),
      });

      await expect(degradedReason(runtime)).resolves.toContain("remote_approval_denied");
      expect(primaryModel).toBeDefined();
    },
  );
});
