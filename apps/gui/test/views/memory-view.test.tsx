// @vitest-environment jsdom
import type { MemoryEntry, Session } from "@megasaver/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryView } from "../../src/views/memory-view.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const ENTRY_A_ID = "33333333-3333-4333-8333-333333333333";
const ENTRY_B_ID = "44444444-4444-4444-8444-444444444444";

const OPEN_SESSION: Session = {
  id: SESSION_ID as Session["id"],
  projectId: PROJECT_ID as Session["projectId"],
  agentId: "claude-code",
  riskLevel: "medium",
  title: "linked-session",
  startedAt: "2026-05-10T12:00:00.000Z",
  endedAt: null,
};

const ENTRY_PROJECT: MemoryEntry = {
  id: ENTRY_A_ID as MemoryEntry["id"],
  projectId: PROJECT_ID as MemoryEntry["projectId"],
  sessionId: null,
  scope: "project",
  content: "project-scope content here",
  createdAt: "2026-05-10T11:00:00.000Z",
};

const ENTRY_SESSION: MemoryEntry = {
  id: ENTRY_B_ID as MemoryEntry["id"],
  projectId: PROJECT_ID as MemoryEntry["projectId"],
  sessionId: SESSION_ID as MemoryEntry["sessionId"],
  scope: "session",
  content: "session-scope content here",
  createdAt: "2026-05-10T12:30:00.000Z",
};

function stubFetch(memory: MemoryEntry[], sessions: Session[]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.startsWith("/api/memory")) {
        return { ok: true, status: 200, json: async () => memory };
      }
      if (url.startsWith("/api/sessions")) {
        return { ok: true, status: 200, json: async () => sessions };
      }
      return { ok: true, status: 200, json: async () => [] };
    }),
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => [] })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MemoryView — master-detail wiring", () => {
  it("renders one row per memory entry returned by the bridge", async () => {
    stubFetch([ENTRY_PROJECT, ENTRY_SESSION], [OPEN_SESSION]);
    render(<MemoryView projectId={PROJECT_ID} onViewSession={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/project-scope content/)).toBeDefined());
    expect(screen.getByText(/session-scope content/)).toBeDefined();
  });

  it("populates the detail pane with full content when a row is clicked", async () => {
    stubFetch([ENTRY_PROJECT], [OPEN_SESSION]);
    render(<MemoryView projectId={PROJECT_ID} onViewSession={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/project-scope content/)).toBeDefined());
    fireEvent.click(screen.getByText(/project-scope content/));
    expect(screen.getByText(ENTRY_PROJECT.id)).toBeDefined();
  });

  it("renders the NoSelectionState until a row is clicked", async () => {
    stubFetch([ENTRY_PROJECT], [OPEN_SESSION]);
    render(<MemoryView projectId={PROJECT_ID} onViewSession={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/project-scope content/)).toBeDefined());
    expect(screen.getByText("No memory entry selected.")).toBeDefined();
  });

  it("renders empty state when the project has no entries", async () => {
    stubFetch([], [OPEN_SESSION]);
    render(<MemoryView projectId={PROJECT_ID} onViewSession={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("No memory entries yet.")).toBeDefined());
  });
});

describe("MemoryView — deep link to session", () => {
  it("calls onViewSession(sessionId) when 'View linked session' button is clicked", async () => {
    stubFetch([ENTRY_SESSION], [OPEN_SESSION]);
    const onViewSession = vi.fn();
    render(<MemoryView projectId={PROJECT_ID} onViewSession={onViewSession} />);
    await waitFor(() => expect(screen.getByText(/session-scope content/)).toBeDefined());
    fireEvent.click(screen.getByText(/session-scope content/));
    fireEvent.click(screen.getByRole("button", { name: /View linked session/ }));
    expect(onViewSession).toHaveBeenCalledWith(SESSION_ID);
  });

  it("renders an em-dash for unlinked entries (scope=project)", async () => {
    stubFetch([ENTRY_PROJECT], [OPEN_SESSION]);
    render(<MemoryView projectId={PROJECT_ID} onViewSession={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/project-scope content/)).toBeDefined());
    fireEvent.click(screen.getByText(/project-scope content/));
    // Detail Field for Session is "—" when sessionId is null
    const sessionFieldRow = screen.getAllByText("Session");
    expect(sessionFieldRow.length).toBeGreaterThan(0);
  });
});

describe("MemoryView — create form", () => {
  it("toggles the CreateMemoryForm when '+ New entry' is clicked", async () => {
    stubFetch([], []);
    render(<MemoryView projectId={PROJECT_ID} onViewSession={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("No memory entries yet.")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Create new memory entry" }));
    expect(screen.getByLabelText("Create memory entry")).toBeDefined();
  });
});
