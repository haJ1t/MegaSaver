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
  hook: () => Promise<{ connected: boolean; preInstalled: boolean; postInstalled: boolean }>;
  daemon: () => Promise<{ running: boolean }>;
} = {
  saver: () => Promise.reject(new Error("not set")),
  stats: () => Promise.reject(new Error("not set")),
  hook: () => Promise.resolve({ connected: false, preInstalled: false, postInstalled: false }),
  daemon: () => Promise.resolve({ running: false }),
};

vi.mock("../../src/lib/claude-sessions-client.js", () => ({
  fetchWorkspaceSaver: () => stub.saver(),
  setWorkspaceSaver: () => stub.saver(),
  fetchSessionTokenSaverStats: () => stub.stats(),
  fetchClaudeHookStatus: () => stub.hook(),
  fetchDaemonStatus: () => stub.daemon(),
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
  stub.hook = () =>
    Promise.resolve({ connected: false, preInstalled: false, postInstalled: false });
  stub.daemon = () => Promise.resolve({ running: false });
});

describe("TokenSaverPanel", () => {
  it("shows a hero token-saved metric", async () => {
    stub.saver = () => Promise.resolve(SAVER);
    stub.stats = () => Promise.resolve(STATS);
    render(<TokenSaverPanel dir="d" id="i" />);
    await waitFor(() => expect(screen.getByText("200")).toBeDefined());
    expect(screen.getByText("tokens saved")).toBeDefined();
  });

  it("shows status badges and hides byte-level table labels", async () => {
    stub.saver = () => Promise.resolve(SAVER);
    stub.stats = () => Promise.resolve(STATS);
    render(<TokenSaverPanel dir="d" id="i" />);
    await waitFor(() => expect(screen.getByText("tokens saved")).toBeDefined());
    expect(screen.queryByText("Would have used")).toBeNull();
    expect(screen.queryByText("Actually used")).toBeNull();
    expect(screen.queryByText("Saved %")).toBeNull();
    expect(screen.queryByText("Bytes saved")).toBeNull();
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

  it("ignores stale poll responses", async () => {
    vi.useFakeTimers();
    try {
      let firstResolve: (value: unknown) => void = () => {};
      let secondResolve: (value: unknown) => void = () => {};
      let calls = 0;
      stub.saver = () => Promise.resolve(SAVER);
      stub.stats = () => {
        calls++;
        if (calls === 1)
          return new Promise((resolve) => {
            firstResolve = resolve as (value: unknown) => void;
          });
        return new Promise((resolve) => {
          secondResolve = resolve as (value: unknown) => void;
        });
      };
      render(<TokenSaverPanel dir="d" id="s1" />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(calls).toBe(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(calls).toBe(2);

      await act(async () => secondResolve({ ...STATS, returnedBytesTotal: 100 }));
      expect(screen.getByText("225")).toBeDefined();

      await act(async () => firstResolve({ ...STATS, returnedBytesTotal: 200 }));
      expect(screen.queryByText("200")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
