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

  it("keeps no more than two recent calls per directory and 64 offers", () => {
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
    const withOverflowingOffers = recordBatchCall(
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
    expect(withOverflowingOffers.advise).toBe(true);
    expect(withOverflowingOffers.state.offeredDirectories).toHaveLength(64);
    expect(withOverflowingOffers.state.offeredDirectories).not.toContain(
      "directory-0",
    );
    expect(withOverflowingOffers.state.offeredDirectories).toContain(
      "new-directory",
    );
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
