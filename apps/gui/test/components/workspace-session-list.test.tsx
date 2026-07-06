// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AllWorkspaceTokenSaverTotals,
  ClaudeSessionMeta,
} from "../../src/lib/claude-sessions-client.js";

const stub: {
  sessions: ClaudeSessionMeta[];
  totals: AllWorkspaceTokenSaverTotals;
} = {
  sessions: [],
  totals: { bytesSavedTotal: 0, sessionsCount: 0, savingRatio: 0, workspaceCount: 0 },
};

vi.mock("../../src/lib/claude-sessions-client.js", () => ({
  fetchClaudeSessions: () => Promise.resolve(stub.sessions),
  fetchAllWorkspaceTotals: () => Promise.resolve(stub.totals),
}));

import { WorkspaceSessionList } from "../../src/views/workspace-session-list.js";

function meta(over: Partial<ClaudeSessionMeta>): ClaudeSessionMeta {
  return {
    dir: "d",
    id: "i",
    mtimeMs: 0,
    size: 0,
    title: "t",
    projectLabel: "/tmp/alpha",
    isArchived: false,
    model: "",
    permissionMode: "",
    lastActivityAt: 0,
    ...over,
  };
}

afterEach(() => {
  cleanup();
  stub.sessions = [];
  stub.totals = { bytesSavedTotal: 0, sessionsCount: 0, savingRatio: 0, workspaceCount: 0 };
});

describe("WorkspaceSessionList", () => {
  it("renders a group heading per cwd basename with sessions newest-first", async () => {
    const now = Date.now();
    stub.sessions = [
      meta({ id: "a-old", title: "A old", projectLabel: "/tmp/alpha", mtimeMs: now - 100000 }),
      meta({ id: "a-new", title: "A new", projectLabel: "/tmp/alpha", mtimeMs: now - 50000 }),
      meta({ id: "b-1", title: "B one", projectLabel: "/tmp/beta", mtimeMs: now - 200000 }),
    ];
    render(<WorkspaceSessionList onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText("alpha")).toBeDefined());
    expect(screen.getByText("beta")).toBeDefined();

    const titles = screen.getAllByText(/^A /).map((el) => el.textContent);
    expect(titles).toEqual(["A new", "A old"]);
  });

  it("shows a live dot for a session within LIVE_WINDOW_MS", async () => {
    stub.sessions = [meta({ id: "live", title: "Live one", mtimeMs: Date.now() })];
    const { container } = render(<WorkspaceSessionList onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText("Live one")).toBeDefined());
    expect(container.querySelector("[aria-label='live']")).not.toBeNull();
  });

  it("hides a group's sessions when its collapse toggle is clicked", async () => {
    stub.sessions = [meta({ id: "x", title: "Hide me", projectLabel: "/tmp/alpha" })];
    render(<WorkspaceSessionList onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText("Hide me")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: /alpha/ }));
    await waitFor(() => expect(screen.queryByText("Hide me")).toBeNull());
  });

  it("calls onSelect with the session when a session row is clicked", async () => {
    const onSelect = vi.fn();
    const session = meta({ id: "pick", title: "Pick me", projectLabel: "/tmp/alpha" });
    stub.sessions = [session];
    render(<WorkspaceSessionList onSelect={onSelect} />);
    await waitFor(() => expect(screen.getByText("Pick me")).toBeDefined());
    fireEvent.click(screen.getByText("Pick me"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]?.id).toBe("pick");
  });

  it("wraps groups in a rounded card on a warm background", async () => {
    stub.sessions = [meta({ id: "x", title: "X", projectLabel: "/tmp/alpha" })];
    const { container } = render(<WorkspaceSessionList onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText("alpha")).toBeDefined());
    const card = container.querySelector("[data-testid='session-list-card']");
    expect(card).not.toBeNull();
    expect(card?.className).toMatch(/rounded-xl/);
  });

  it("reveals model and archived tags on hover", async () => {
    stub.sessions = [
      meta({
        id: "x",
        title: "X",
        projectLabel: "/tmp/alpha",
        model: "claude-sonnet-4-6",
        isArchived: true,
      }),
    ];
    render(<WorkspaceSessionList onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText("X")).toBeDefined());
    fireEvent.mouseEnter(screen.getByText("X"));
    expect(screen.getByText(/sonnet/)).toBeDefined();
    expect(screen.getByText("archived")).toBeDefined();
  });

  it("reveals model and archived tags on keyboard focus", async () => {
    stub.sessions = [
      meta({
        id: "x",
        title: "X",
        projectLabel: "/tmp/alpha",
        model: "claude-sonnet-4-6",
        isArchived: true,
      }),
    ];
    render(<WorkspaceSessionList onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText("X")).toBeDefined());
    fireEvent.focus(screen.getByText("X"));
    expect(screen.getByText(/sonnet/)).toBeDefined();
    expect(screen.getByText("archived")).toBeDefined();
  });

  it("applies stagger-enter animation to rows", async () => {
    stub.sessions = [meta({ id: "x", title: "X", projectLabel: "/tmp/alpha" })];
    const { container } = render(<WorkspaceSessionList onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText("X")).toBeDefined());
    const row = container.querySelector(".row-enter");
    expect(row).not.toBeNull();
    expect((row as HTMLElement).style.animationDelay).toBe("0ms");
  });

  it("retry fetches fresh data after an error", async () => {
    vi.useFakeTimers();
    let calls = 0;
    vi.doMock("../../src/lib/claude-sessions-client.js", () => ({
      fetchClaudeSessions: () => {
        calls++;
        if (calls === 1) return Promise.reject({ error: "boom", code: "internal_error" });
        return Promise.resolve([
          meta({ id: "after-retry", title: "After retry", projectLabel: "/tmp/alpha" }),
        ]);
      },
      fetchAllWorkspaceTotals: () =>
        Promise.resolve({
          bytesSavedTotal: 0,
          sessionsCount: 0,
          savingRatio: 0,
          workspaceCount: 0,
        }),
    }));
    vi.resetModules();

    const { WorkspaceSessionList: WorkspaceSessionListFresh } = await import(
      "../../src/views/workspace-session-list.js"
    );
    render(<WorkspaceSessionListFresh onSelect={() => {}} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole("button", { name: /retry/i })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("After retry")).toBeDefined();

    vi.useRealTimers();
  });

  it("shows a Workspaces / Sessions / Live summary strip", async () => {
    stub.sessions = [meta({ id: "x", title: "X", projectLabel: "/tmp/alpha" })];
    render(<WorkspaceSessionList onSelect={() => {}} />);
    expect(await screen.findByText("Workspaces")).toBeTruthy();
    expect(screen.getAllByText("Sessions").length).toBeGreaterThan(0);
    expect(screen.getByText("Live")).toBeTruthy();
  });

  it("renders the cumulative savings headline when savings exist", async () => {
    stub.sessions = [meta({ id: "x", title: "X", projectLabel: "/tmp/alpha" })];
    // 4_000_000 saved bytes -> 1_000_000 tokens -> $3.00 (est.) at the input price; 5 reclaimed.
    stub.totals = {
      bytesSavedTotal: 4_000_000,
      sessionsCount: 10,
      savingRatio: 0.4,
      workspaceCount: 2,
    };
    render(<WorkspaceSessionList onSelect={() => {}} />);
    const headline = await screen.findByTestId("savings-headline");
    expect(headline.textContent).toContain("$3.00 saved (est.)");
    expect(headline.textContent).toContain("5.0 sessions reclaimed");
  });

  it("shows the fractional reclaim count without rounding up (conservative)", async () => {
    stub.sessions = [meta({ id: "x", title: "X", projectLabel: "/tmp/alpha" })];
    // 480_000 saved bytes -> 120_000 tokens -> 120_000 / 200_000 = 0.6 windows.
    // The metric under-counts on purpose: 0.6 must render as "0.6", never "1".
    stub.totals = {
      bytesSavedTotal: 480_000,
      sessionsCount: 4,
      savingRatio: 0.3,
      workspaceCount: 1,
    };
    render(<WorkspaceSessionList onSelect={() => {}} />);
    const headline = await screen.findByTestId("savings-headline");
    expect(headline.textContent).toContain("0.6 sessions reclaimed");
    expect(headline.textContent).not.toContain("1 sessions reclaimed");
  });

  it("renders an honest empty copy when there are no savings yet", async () => {
    stub.sessions = [meta({ id: "x", title: "X", projectLabel: "/tmp/alpha" })];
    stub.totals = { bytesSavedTotal: 0, sessionsCount: 0, savingRatio: 0, workspaceCount: 0 };
    render(<WorkspaceSessionList onSelect={() => {}} />);
    const headline = await screen.findByTestId("savings-headline");
    expect(headline.textContent).toContain("No savings recorded yet");
    expect(headline.textContent).not.toContain("$0.00");
  });

  it("ignores stale responses from earlier polling ticks", async () => {
    vi.useFakeTimers();
    let firstResolve: (v: ClaudeSessionMeta[]) => void = () => {};
    let secondResolve: (v: ClaudeSessionMeta[]) => void = () => {};
    let calls = 0;
    const oldSession = meta({ id: "old", title: "Old", projectLabel: "/tmp/alpha" });
    const newSession = meta({ id: "new", title: "New", projectLabel: "/tmp/alpha" });

    vi.doMock("../../src/lib/claude-sessions-client.js", () => ({
      fetchClaudeSessions: () => {
        calls++;
        if (calls === 1)
          return new Promise((resolve) => {
            firstResolve = resolve;
          });
        return new Promise((resolve) => {
          secondResolve = resolve;
        });
      },
      fetchAllWorkspaceTotals: () =>
        Promise.resolve({
          bytesSavedTotal: 0,
          sessionsCount: 0,
          savingRatio: 0,
          workspaceCount: 0,
        }),
    }));
    vi.resetModules();

    const { WorkspaceSessionList: WorkspaceSessionListFresh } = await import(
      "../../src/views/workspace-session-list.js"
    );
    render(<WorkspaceSessionListFresh onSelect={() => {}} />);

    await act(async () => {});
    expect(calls).toBe(1);

    await act(async () => vi.advanceTimersByTime(4000));
    expect(calls).toBe(2);

    await act(async () => secondResolve([newSession]));
    expect(screen.getByText("New")).toBeDefined();

    await act(async () => firstResolve([oldSession]));
    expect(screen.queryByText("Old")).toBeNull();

    vi.useRealTimers();
  });
});
