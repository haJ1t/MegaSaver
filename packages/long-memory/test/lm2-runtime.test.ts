import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLm1Runtime } from "../src/lm1-runtime.js";
import { createLm2Runtime } from "../src/lm2-runtime.js";
import {
  cleanupRuntimeRoots,
  createRuntimeRoot,
  lm1Ports,
  runtimeConfig,
  snapshotInput,
  workspaceKey,
} from "./lm2-runtime-fixtures.js";

afterEach(cleanupRuntimeRoots);

describe("LM2 runtime Safe composition", () => {
  it("delegates Safe recall literally to LM1 with zero semantic I/O", async () => {
    const storeRoot = createRuntimeRoot();
    const ports = lm1Ports();
    const traps = { embedding: 0, approval: 0 };
    const embedding = new Proxy(
      {},
      {
        ownKeys() {
          traps.embedding += 1;
          throw new Error("hostile embedding port");
        },
      },
    );
    const approval = new Proxy(
      {},
      {
        ownKeys() {
          traps.approval += 1;
          throw new Error("hostile approval port");
        },
      },
    );
    const input = {
      storeRoot,
      ...ports,
      clock: { now: () => "2026-07-20T00:00:01.000Z" },
    };
    const monotonicNow = vi.fn(() => 10);
    const lm1 = createLm1Runtime(input);
    const lm2 = createLm2Runtime({
      ...input,
      embedding: embedding as never,
      monotonicClock: { now: monotonicNow },
      config: runtimeConfig(),
    });
    const prepared = lm2.capture.prepare(
      snapshotInput(1, "Billing status is paid.", "2026-07-20T00:00:00.000Z"),
    );
    await lm2.capture.capturePrepared({ prepared, authorization: "signed" });
    const request = { workspaceKey, task: "billing paid", tokenBudget: 100 };

    const expected = await lm1.recall.recall(request);
    const actual = await lm2.recall({ ...request, profile: "safe" });

    expect(actual.items).toEqual(expected.items);
    expect(actual.receipt).toEqual({
      ...expected.receipt,
      hybrid: expect.objectContaining({
        profile: "safe",
        semanticStatus: "not_requested",
        semanticReasons: [],
      }),
    });
    expect(traps).toEqual({ embedding: 1, approval: 0 });
    expect(monotonicNow).not.toHaveBeenCalled();
  });

  it("catalogs only after LM1 publication and preserves publication on catalog failure", async () => {
    const storeRoot = createRuntimeRoot();
    const runtime = createLm2Runtime({
      storeRoot,
      ...lm1Ports(),
      clock: { now: () => "2026-07-20T00:00:01.000Z" },
      monotonicClock: { now: () => 10 },
      embedding: undefined,
      config: runtimeConfig(),
    });
    const prepared = runtime.capture.prepare(
      snapshotInput(1, "Cataloged billing state", "2026-07-20T00:00:00.000Z"),
    );

    await expect(
      runtime.capture.capturePrepared({ prepared, authorization: "signed" }),
    ).resolves.toMatchObject({ published: { inserted: true }, adaptiveCataloged: true });
    await expect(
      runtime.recall({ workspaceKey, task: "billing", tokenBudget: 100, profile: "adaptive" }),
    ).resolves.toMatchObject({
      receipt: { hybrid: { adaptiveCatalogRecordCount: 1 } },
    });
  });

  it("keeps a published LM1 record when the post-publication catalog write fails", async () => {
    const storeRoot = createRuntimeRoot();
    const outside = createRuntimeRoot();
    const workspace = join(storeRoot, "long-memory", "v1", workspaceKey);
    mkdirSync(workspace, { recursive: true });
    symlinkSync(outside, join(workspace, ".lm2"));
    const input = {
      storeRoot,
      ...lm1Ports(),
      clock: { now: () => "2026-07-20T00:00:01.000Z" },
    };
    const runtime = createLm2Runtime({
      ...input,
      monotonicClock: { now: () => 10 },
      embedding: undefined,
      config: runtimeConfig(),
    });
    const prepared = runtime.capture.prepare(
      snapshotInput(1, "Durable LM1 state", "2026-07-20T00:00:00.000Z"),
    );

    await expect(
      runtime.capture.capturePrepared({ prepared, authorization: "signed" }),
    ).resolves.toMatchObject({ published: { inserted: true }, adaptiveCataloged: false });
    await expect(
      runtime.recall({ workspaceKey, task: "durable", tokenBudget: 100, profile: "safe" }),
    ).resolves.toMatchObject({ items: [expect.objectContaining({ value: "Durable LM1 state" })] });
  });
});
