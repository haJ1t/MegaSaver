import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createLm1Runtime } from "../src/lm1-runtime.js";

describe("LM1 runtime boundary", () => {
  it("normalizes invalid and hostile constructor input", () => {
    for (const storeRoot of [null, undefined, "", "relative-store-root"]) {
      expect(() =>
        createLm1Runtime({
          storeRoot,
        } as never),
      ).toThrow(expect.objectContaining({ code: "invalid_input" }));
    }
    expect(() =>
      createLm1Runtime(
        new Proxy(
          {},
          {
            get() {
              throw new Error("hostile runtime input");
            },
          },
        ) as never,
      ),
    ).toThrow(expect.objectContaining({ code: "invalid_input" }));
  });

  it("fails closed when an absolute store root is a regular file", async () => {
    const parent = realpathSync(mkdtempSync(join(tmpdir(), "megasaver-lm1-runtime-")));
    const storeRoot = join(parent, "not-a-directory");
    writeFileSync(storeRoot, "not a directory");
    const runtime = createLm1Runtime({
      storeRoot,
      redaction: {
        version: "redaction-v1",
        redact: ({ text, action }) => ({ text, action, unresolvedHighRisk: false }),
      },
      evidenceBinding: {
        verify: async ({ evidenceIds }) => ({
          evidence: evidenceIds.map((evidenceId) => ({
            evidenceId,
            evidenceDigest: "a".repeat(64),
          })),
        }),
      },
      evidenceEligibility: {
        resolve: async ({ workspaceKey, evidenceIds }) =>
          evidenceIds.map((evidenceId) => ({
            evidenceId,
            workspaceKey,
            status: "available" as const,
            unresolvedHighRisk: false,
          })),
      },
      clock: { now: () => "2026-07-20T00:00:01.000Z" },
    });
    const prepared = runtime.capture.prepare({
      workspaceKey: "0123456789abcdef",
      kind: "state_snapshot",
      observedAt: "2026-07-20T00:00:00.000Z",
      text: "Billing status is paid.",
      action: null,
      evidenceIds: ["11111111-1111-4111-8111-111111111111"],
      stateKey: "billing.status",
      representation: "value",
      supersedesSnapshotId: null,
    });

    try {
      await expect(
        runtime.capture.capturePrepared({ prepared, authorization: "signed" }),
      ).rejects.toMatchObject({
        code: "store_corrupt",
      });
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it("accepts a protected platform path alias for an otherwise real store root", async () => {
    const storeRoot = mkdtempSync(join(tmpdir(), "megasaver-lm1-runtime-alias-"));
    const canonicalStoreRoot = realpathSync(storeRoot);
    if (storeRoot === canonicalStoreRoot) {
      rmSync(storeRoot, { recursive: true, force: true });
      return;
    }
    const runtime = createLm1Runtime({
      storeRoot,
      redaction: {
        version: "redaction-v1",
        redact: ({ text, action }) => ({ text, action, unresolvedHighRisk: false }),
      },
      evidenceBinding: {
        verify: async ({ evidenceIds }) => ({
          evidence: evidenceIds.map((evidenceId) => ({
            evidenceId,
            evidenceDigest: "a".repeat(64),
          })),
        }),
      },
      evidenceEligibility: {
        resolve: async ({ workspaceKey, evidenceIds }) =>
          evidenceIds.map((evidenceId) => ({
            evidenceId,
            workspaceKey,
            status: "available" as const,
            unresolvedHighRisk: false,
          })),
      },
      clock: { now: () => "2026-07-20T00:00:01.000Z" },
    });
    const prepared = runtime.capture.prepare({
      workspaceKey: "0123456789abcdef",
      kind: "state_snapshot",
      observedAt: "2026-07-20T00:00:00.000Z",
      text: "Billing status is paid.",
      action: null,
      evidenceIds: ["11111111-1111-4111-8111-111111111111"],
      stateKey: "billing.status",
      representation: "value",
      supersedesSnapshotId: null,
    });

    try {
      await expect(
        runtime.capture.capturePrepared({ prepared, authorization: "signed" }),
      ).resolves.toMatchObject({ inserted: true });
    } finally {
      rmSync(storeRoot, { recursive: true, force: true });
    }
  });

  it("rejects a different user's static symlinked root ancestor", async () => {
    const parent = realpathSync(mkdtempSync(join(tmpdir(), "megasaver-lm1-runtime-owner-")));
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "megasaver-lm1-runtime-outside-")));
    const alias = join(parent, "other-user-alias");
    symlinkSync(outside, alias);
    const storeRoot = join(alias, "store");
    const currentUserId = process.getuid?.();
    if (currentUserId === undefined) {
      rmSync(parent, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
      return;
    }
    const getuid = vi.spyOn(process, "getuid").mockReturnValue(currentUserId + 1);
    const runtime = createLm1Runtime({
      storeRoot,
      redaction: {
        version: "redaction-v1",
        redact: ({ text, action }) => ({ text, action, unresolvedHighRisk: false }),
      },
      evidenceBinding: {
        verify: async ({ evidenceIds }) => ({
          evidence: evidenceIds.map((evidenceId) => ({
            evidenceId,
            evidenceDigest: "a".repeat(64),
          })),
        }),
      },
      evidenceEligibility: {
        resolve: async ({ workspaceKey, evidenceIds }) =>
          evidenceIds.map((evidenceId) => ({
            evidenceId,
            workspaceKey,
            status: "available" as const,
            unresolvedHighRisk: false,
          })),
      },
      clock: { now: () => "2026-07-20T00:00:01.000Z" },
    });
    const prepared = runtime.capture.prepare({
      workspaceKey: "0123456789abcdef",
      kind: "state_snapshot",
      observedAt: "2026-07-20T00:00:00.000Z",
      text: "Billing status is paid.",
      action: null,
      evidenceIds: ["11111111-1111-4111-8111-111111111111"],
      stateKey: "billing.status",
      representation: "value",
      supersedesSnapshotId: null,
    });

    try {
      await expect(
        runtime.capture.capturePrepared({ prepared, authorization: "signed" }),
      ).rejects.toMatchObject({ code: "store_corrupt" });
    } finally {
      getuid.mockRestore();
      rmSync(parent, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
