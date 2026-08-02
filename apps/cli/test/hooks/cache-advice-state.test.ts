import { describe, expect, it } from "vitest";

import {
  BATCH_WINDOW_MS,
  recordBatchCall,
  type BatchAdviceState,
} from "../../src/hooks/cache-advice-state.js";

const empty: BatchAdviceState = { offeredDirectories: [], recent: [] };

describe("recordBatchCall", () => {
  it("advises only on the second same-directory call in the window", () => {
    const first = recordBatchCall(empty, {
      tool: "Read",
      directory: "src",
      at: 1_000,
    });
    const second = recordBatchCall(first.state, {
      tool: "Grep",
      directory: "src",
      at: 61_000,
    });

    expect(first.advise).toBe(false);
    expect(second.advise).toBe(true);
  });

  it("does not advise twice, across directories, or after expiry", () => {
    const alreadyOffered: BatchAdviceState = {
      offeredDirectories: ["src"],
      recent: [{ tool: "Read", directory: "src", at: 1_000 }],
    };
    const otherDirectory: BatchAdviceState = {
      offeredDirectories: [],
      recent: [{ tool: "Grep", directory: "src", at: 1_000 }],
    };
    const expiredFirst: BatchAdviceState = {
      offeredDirectories: [],
      recent: [{ tool: "Glob", directory: "src", at: 1_000 }],
    };

    expect(
      recordBatchCall(alreadyOffered, {
        tool: "Glob",
        directory: "src",
        at: 2_000,
      }).advise,
    ).toBe(false);
    expect(
      recordBatchCall(otherDirectory, {
        tool: "Read",
        directory: "test",
        at: 2_000,
      }).advise,
    ).toBe(false);
    expect(
      recordBatchCall(expiredFirst, {
        tool: "Read",
        directory: "src",
        at: 61_001,
      }).advise,
    ).toBe(false);
  });

  it("rejects an empty directory", () => {
    expect(() =>
      recordBatchCall(empty, { tool: "Read", directory: "", at: 1_000 }),
    ).toThrow(new Error("directory must not be empty"));
  });

  it("keeps no more than two recent calls per directory and suppresses offers after 64", () => {
    const withThreeCalls = recordBatchCall(
      {
        offeredDirectories: [],
        recent: [
          { tool: "Read", directory: "src", at: 1_000 },
          { tool: "Grep", directory: "src", at: 2_000 },
        ],
      },
      { tool: "Glob", directory: "src", at: 3_000 },
    );
    const offeredDirectories = Array.from({ length: 64 }, (_, index) =>
      `directory-${index}`,
    );
    const afterOfferCapacity = recordBatchCall(
      {
        offeredDirectories,
        recent: [{ tool: "Read", directory: "new-directory", at: 1_000 }],
      },
      { tool: "Grep", directory: "new-directory", at: 2_000 },
    );

    expect(withThreeCalls.state.recent).toEqual([
      { tool: "Grep", directory: "src", at: 2_000 },
      { tool: "Glob", directory: "src", at: 3_000 },
    ]);
    expect(afterOfferCapacity.advise).toBe(false);
    expect(afterOfferCapacity.state.offeredDirectories).toEqual(
      offeredDirectories,
    );
  });

  it("suppresses advice when the bounded recent history is full", () => {
    const recent = Array.from({ length: 128 }, (_, index) => ({
      tool: "Read" as const,
      directory: `directory-${index}`,
      at: 1_000,
    }));
    const result = recordBatchCall(
      { offeredDirectories: [], recent },
      { tool: "Grep", directory: "directory-0", at: 2_000 },
    );

    expect(result.advise).toBe(false);
    expect(result.state.recent).toEqual(recent);
  });

  it("uses calls exactly at the window boundary", () => {
    const result = recordBatchCall(
      {
        offeredDirectories: [],
        recent: [{ tool: "Read", directory: "src", at: 1_000 }],
      },
      { tool: "Grep", directory: "src", at: 1_000 + BATCH_WINDOW_MS },
    );

    expect(result.advise).toBe(true);
  });
});
