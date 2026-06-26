// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClaudeSessionMeta } from "../../src/lib/claude-sessions-client.js";

const stub: { sessions: ClaudeSessionMeta[] } = { sessions: [] };

vi.mock("../../src/lib/claude-sessions-client.js", () => ({
  fetchClaudeSessions: () => Promise.resolve(stub.sessions),
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
});
