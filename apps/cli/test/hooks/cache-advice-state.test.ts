import { describe, expect, it } from "vitest";

import {
  BATCH_WINDOW_MS,
  type CacheAdviceState,
  recordBatchCall,
} from "../../src/hooks/cache-advice-state.js";

const empty: CacheAdviceState = { version: 2, offeredDirectoryKeys: [], recent: [] };

describe("recordBatchCall", () => {
  it("advises only on the second same-directory call in the window", () => {
    const first = recordBatchCall(empty, {
      tool: "Read",
      directoryKey: "src",
      at: 1_000,
    });
    const second = recordBatchCall(first.state, {
      tool: "Grep",
      directoryKey: "src",
      at: 61_000,
    });

    expect(first.advise).toBe(false);
    expect(second.advise).toBe(true);
  });

  it("does not advise twice, across directories, or after expiry", () => {
    const alreadyOffered: CacheAdviceState = {
      version: 2,
      offeredDirectoryKeys: ["src"],
      recent: [{ tool: "Read", directoryKey: "src", at: 1_000 }],
    };
    const otherDirectory: CacheAdviceState = {
      version: 2,
      offeredDirectoryKeys: [],
      recent: [{ tool: "Grep", directoryKey: "src", at: 1_000 }],
    };
    const expiredFirst: CacheAdviceState = {
      version: 2,
      offeredDirectoryKeys: [],
      recent: [{ tool: "Glob", directoryKey: "src", at: 1_000 }],
    };

    expect(
      recordBatchCall(alreadyOffered, {
        tool: "Glob",
        directoryKey: "src",
        at: 2_000,
      }).advise,
    ).toBe(false);
    expect(
      recordBatchCall(otherDirectory, {
        tool: "Read",
        directoryKey: "test",
        at: 2_000,
      }).advise,
    ).toBe(false);
    expect(
      recordBatchCall(expiredFirst, {
        tool: "Read",
        directoryKey: "src",
        at: 61_001,
      }).advise,
    ).toBe(false);
  });

  it("rejects an empty directory", () => {
    expect(() => recordBatchCall(empty, { tool: "Read", directoryKey: "", at: 1_000 })).toThrow(
      new Error("directory key must not be empty"),
    );
  });

  it("keeps no more than two recent calls per directory and suppresses offers after 64", () => {
    const withThreeCalls = recordBatchCall(
      {
        version: 2,
        offeredDirectoryKeys: [],
        recent: [
          { tool: "Read", directoryKey: "src", at: 1_000 },
          { tool: "Grep", directoryKey: "src", at: 2_000 },
        ],
      },
      { tool: "Glob", directoryKey: "src", at: 3_000 },
    );
    const offeredDirectoryKeys = Array.from({ length: 64 }, (_, index) => `directory-${index}`);
    const afterOfferCapacity = recordBatchCall(
      {
        version: 2,
        offeredDirectoryKeys,
        recent: [{ tool: "Read", directoryKey: "new-directory", at: 1_000 }],
      },
      { tool: "Grep", directoryKey: "new-directory", at: 2_000 },
    );

    expect(withThreeCalls.state.recent).toEqual([
      { tool: "Grep", directoryKey: "src", at: 2_000 },
      { tool: "Glob", directoryKey: "src", at: 3_000 },
    ]);
    expect(afterOfferCapacity.advise).toBe(false);
    expect(afterOfferCapacity.state.offeredDirectoryKeys).toEqual(offeredDirectoryKeys);
  });

  it("suppresses advice when the bounded recent history is full", () => {
    const recent = Array.from({ length: 128 }, (_, index) => ({
      tool: "Read" as const,
      directoryKey: `directory-${index}`,
      at: 1_000,
    }));
    const result = recordBatchCall(
      { version: 2, offeredDirectoryKeys: [], recent },
      { tool: "Grep", directoryKey: "directory-0", at: 2_000 },
    );

    expect(result.advise).toBe(false);
    expect(result.state.recent).toEqual(recent);
  });

  it("uses calls exactly at the window boundary", () => {
    const result = recordBatchCall(
      {
        version: 2,
        offeredDirectoryKeys: [],
        recent: [{ tool: "Read", directoryKey: "src", at: 1_000 }],
      },
      { tool: "Grep", directoryKey: "src", at: 1_000 + BATCH_WINDOW_MS },
    );

    expect(result.advise).toBe(true);
  });
});
