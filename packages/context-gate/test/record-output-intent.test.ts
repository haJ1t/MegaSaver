import { describe, expect, it, vi } from "vitest";

// Mock filterOutput to a passthrough decision so recordAndFilterOverlayOutput
// returns early (record-output.ts:106) with NO filesystem side effects, while we
// assert the exact arg it was called with.
vi.mock("@megasaver/output-filter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@megasaver/output-filter")>();
  return {
    ...actual,
    filterOutput: vi.fn(() => ({
      decision: "passthrough" as const,
      summary: "",
      excerpts: [],
      rawBytes: 2,
      returnedBytes: 2,
      bytesSaved: 0,
      savingRatio: 0,
    })),
  };
});

import { filterOutput } from "@megasaver/output-filter";
import { recordAndFilterOverlayOutput } from "../src/record-output.js";

const base = {
  storeRoot: "/unused-passthrough",
  workspaceKey: "0000000000000000",
  liveSessionId: "s",
  raw: "hi",
  sourceKind: "file" as const,
  label: "x",
  mode: "safe" as const,
  storeRawOutput: false,
};

describe("recordAndFilterOverlayOutput intent threading", () => {
  it("forwards intent to filterOutput when set", async () => {
    vi.mocked(filterOutput).mockClear();
    await recordAndFilterOverlayOutput({ ...base, intent: "fix the parser" });
    expect(vi.mocked(filterOutput)).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "fix the parser" }),
    );
  });

  it("omits the intent key when not set", async () => {
    vi.mocked(filterOutput).mockClear();
    await recordAndFilterOverlayOutput(base);
    const calls = vi.mocked(filterOutput).mock.calls;
    expect(calls).toHaveLength(1);
    const arg = calls[0]?.[0];
    expect("intent" in arg).toBe(false);
  });
});
