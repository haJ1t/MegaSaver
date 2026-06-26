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
} = {
  saver: () => Promise.reject(new Error("not set")),
  stats: () => Promise.reject(new Error("not set")),
};

vi.mock("../../src/lib/claude-sessions-client.js", () => ({
  fetchWorkspaceSaver: () => stub.saver(),
  setWorkspaceSaver: () => stub.saver(),
  fetchSessionTokenSaverStats: () => stub.stats(),
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
// raw 1000 B -> ceil(1000/4)=250 tok ; returned 200 B -> 50 tok ; saved = 200 tok
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
});

describe("TokenSaverPanel — tokens-saved hero metric", () => {
  it("shows hero saved tokens and supporting metrics", async () => {
    stub.saver = () => Promise.resolve(SAVER);
    stub.stats = () => Promise.resolve(STATS);
    render(<TokenSaverPanel dir="d" id="i" />);
    await waitFor(() => expect(screen.getByText("Tokens saved this session")).toBeDefined());
    expect(screen.getByText("200")).toBeDefined();
    expect(screen.getByText("80%")).toBeDefined();
    expect(screen.getByText("Would have used")).toBeDefined();
    expect(screen.getByText("Actually used")).toBeDefined();
    expect(screen.getByText("250 tokens")).toBeDefined();
    expect(screen.getByText("50 tokens")).toBeDefined();
  });

  it("hides byte summary and per-event compression detail", async () => {
    stub.saver = () => Promise.resolve(SAVER);
    stub.stats = () => Promise.resolve(STATS);
    render(<TokenSaverPanel dir="d" id="i" />);
    await waitFor(() => expect(screen.getByText("Tokens saved this session")).toBeDefined());
    expect(screen.queryByText("Bytes saved")).toBeNull();
    expect(screen.queryByText("Raw bytes")).toBeNull();
    expect(screen.queryByText(/Saving ratio/)).toBeNull();
    expect(screen.queryByText("Chunks stored")).toBeNull();
    expect(screen.queryByText("800 B")).toBeNull();
    expect(screen.queryByText("source")).toBeNull();
    expect(screen.queryByText("when")).toBeNull();
  });

  it("shows the empty message when no proxy activity", async () => {
    stub.saver = () => Promise.resolve({ ...SAVER, enabled: false });
    stub.stats = () => Promise.resolve(null);
    render(<TokenSaverPanel dir="d" id="i" />);
    await waitFor(() => expect(screen.getByText(/No proxy activity/i)).toBeDefined());
  });

  it("live-updates the saved tokens on the poll interval", async () => {
    vi.useFakeTimers();
    try {
      let n = 0;
      stub.saver = () => Promise.resolve(SAVER);
      // first poll: returned 200 B -> saved 200; second: returned 100 B -> saved 225
      stub.stats = () => Promise.resolve({ ...STATS, returnedBytesTotal: n++ === 0 ? 200 : 100 });
      render(<TokenSaverPanel dir="d" id="i" />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByText("200")).toBeDefined();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(screen.getByText("225")).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
