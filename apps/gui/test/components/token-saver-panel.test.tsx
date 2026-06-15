// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  OverlaySessionTokenSaverStats,
  WorkspaceSaverStatus,
} from "../../src/lib/claude-sessions-client.js";

const stub: {
  saver: () => Promise<WorkspaceSaverStatus>;
  stats: () => Promise<OverlaySessionTokenSaverStats | null>;
  events: () => Promise<unknown[]>;
} = {
  saver: () => Promise.reject(new Error("not set")),
  stats: () => Promise.reject(new Error("not set")),
  events: () => Promise.reject(new Error("not set")),
};

vi.mock("../../src/lib/claude-sessions-client.js", () => ({
  fetchWorkspaceSaver: () => stub.saver(),
  setWorkspaceSaver: () => stub.saver(),
  fetchSessionTokenSaverStats: () => stub.stats(),
  fetchSessionTokenSaverEvents: () => stub.events(),
  fetchClaudeHookStatus: () =>
    Promise.resolve({ connected: false, preInstalled: false, postInstalled: false }),
}));

import { TokenSaverPanel } from "../../src/views/cockpit/token-saver-panel.js";

const SAVER: WorkspaceSaverStatus = {
  enabled: true,
  mode: "balanced",
  blockPresent: true,
  mcpInstalled: true,
};
const STATS: OverlaySessionTokenSaverStats = {
  liveSessionId: "s",
  eventsTotal: 3,
  rawBytesTotal: 1000,
  returnedBytesTotal: 200,
  bytesSavedTotal: 800,
  savingRatio: 0.8,
  secretsRedactedTotal: 0,
  chunksStoredTotal: 1,
  updatedAt: "2026-06-15T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
  stub.saver = () => Promise.reject(new Error("not set"));
  stub.stats = () => Promise.reject(new Error("not set"));
  stub.events = () => Promise.reject(new Error("not set"));
});

describe("TokenSaverPanel (activation + stats)", () => {
  it("renders the workspace activation toggle and the session savings table together", async () => {
    stub.saver = () => Promise.resolve(SAVER);
    stub.stats = () => Promise.resolve(STATS);
    stub.events = () => Promise.resolve([]);
    render(<TokenSaverPanel dir="d" id="i" />);
    await waitFor(() => expect(screen.getByLabelText(/Saver Mode/i)).toBeDefined());
    expect((screen.getByLabelText(/Saver Mode/i) as HTMLInputElement).checked).toBe(true);
    // savings shown in a table, byte values humanized
    await waitFor(() => expect(screen.getByText("800 B")).toBeDefined());
    expect(screen.getByText("80%")).toBeDefined();
    expect(screen.getByText("Bytes saved")).toBeDefined();
  });

  it("shows the empty stats message when no proxy activity", async () => {
    stub.saver = () => Promise.resolve({ ...SAVER, enabled: false });
    stub.stats = () => Promise.resolve(null);
    stub.events = () => Promise.resolve([]);
    render(<TokenSaverPanel dir="d" id="i" />);
    await waitFor(() => expect(screen.getByText(/No proxy activity/i)).toBeDefined());
  });

  it("live-updates the savings table on the poll interval", async () => {
    vi.useFakeTimers();
    try {
      let n = 0;
      let statsCalls = 0;
      stub.saver = () => Promise.resolve(SAVER);
      stub.stats = () => {
        statsCalls += 1;
        return Promise.resolve({ ...STATS, bytesSavedTotal: n++ === 0 ? 800 : 900 });
      };
      stub.events = () => Promise.resolve([]);
      render(<TokenSaverPanel dir="d" id="i" />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByText("800 B")).toBeDefined();
      const initialCalls = statsCalls;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(statsCalls).toBeGreaterThan(initialCalls); // a poll fired
      expect(screen.getByText("900 B")).toBeDefined(); // and the table updated
    } finally {
      vi.useRealTimers();
    }
  });
});
