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

describe("SessionSaverStats", () => {
  it("shows the tokens-saved figure once stats load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(STATS), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    render(<SessionSaverStats dir="d1" id="s1" />);
    // (40000-16000)/4 = 6000 tokens saved.
    await waitFor(() => expect(screen.getByText(/6,000/)).toBeTruthy());
  });
});
