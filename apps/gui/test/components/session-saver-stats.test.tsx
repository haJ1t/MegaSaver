// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionSaverStats } from "../../src/cockpit/panels/session-saver-stats.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const STATS = {
  liveSessionId: "s1",
  eventsTotal: 3,
  rawBytesTotal: 40000,
  returnedBytesTotal: 16000,
  bytesSavedTotal: 24000,
  savingRatio: 0.6,
  secretsRedactedTotal: 0,
  chunksStoredTotal: 2,
  updatedAt: "2026-07-03T00:00:00.000Z",
};

const WORKSPACE_TOTALS = {
  workspaceKey: "wk1",
  sessionsCount: 4,
  eventsTotal: 9,
  rawBytesTotal: 80000,
  returnedBytesTotal: 20000,
  bytesSavedTotal: 60000,
  savingRatio: 0.75,
  secretsRedactedTotal: 0,
  chunksStoredTotal: 5,
  latestUpdatedAt: "2026-07-03T00:00:00.000Z",
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("SessionSaverStats", () => {
  it("shows the tokens-saved figure once session stats load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(STATS)),
    );
    render(<SessionSaverStats dir="d1" id="s1" />);
    // 24000 / 4 = 6000 tokens saved.
    await waitFor(() => expect(screen.getByText(/6,000/)).toBeTruthy());
  });

  it("falls back to the workspace total when the per-session read is null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("workspace-stats")) return jsonResponse(WORKSPACE_TOTALS);
        return jsonResponse(null); // per-session summary scattered → null
      }),
    );
    render(<SessionSaverStats dir="d1" id="s1" />);
    // 60000 / 4 = 15000, labelled as a workspace total across 4 sessions.
    await waitFor(() => expect(screen.getByText(/15,000/)).toBeTruthy());
    expect(screen.getByText(/workspace · 4 sessions/i)).toBeTruthy();
  });
});
