// @vitest-environment jsdom
import type { Session } from "@megasaver/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionsView } from "../../src/views/sessions-view.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_A_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_B_ID = "33333333-3333-4333-8333-333333333333";

const SESSION_A: Session = {
  id: SESSION_A_ID as Session["id"],
  projectId: PROJECT_ID as Session["projectId"],
  agentId: "claude-code",
  riskLevel: "medium",
  title: "Alpha",
  startedAt: "2026-05-10T12:00:00.000Z",
  endedAt: null,
};

const SESSION_B: Session = {
  id: SESSION_B_ID as Session["id"],
  projectId: PROJECT_ID as Session["projectId"],
  agentId: "codex",
  riskLevel: "high",
  title: "Beta",
  startedAt: "2026-05-10T11:00:00.000Z",
  endedAt: null,
};

function stubFetchSessions(sessions: Session[]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.startsWith("/api/sessions")) {
        return { ok: true, status: 200, json: async () => sessions };
      }
      return { ok: true, status: 200, json: async () => [] };
    }),
  );
}

beforeEach(() => {
  // Default empty
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => [] })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SessionsView — master-detail wiring", () => {
  it("renders a list row for every session returned by the bridge", async () => {
    stubFetchSessions([SESSION_A, SESSION_B]);
    render(<SessionsView projectId={PROJECT_ID} />);
    await waitFor(() => expect(screen.getByText("Alpha")).toBeDefined());
    expect(screen.getByText("Beta")).toBeDefined();
  });

  it("populates the detail pane when a row is clicked", async () => {
    stubFetchSessions([SESSION_A]);
    render(<SessionsView projectId={PROJECT_ID} />);
    await waitFor(() => expect(screen.getByText("Alpha")).toBeDefined());
    fireEvent.click(screen.getByText("Alpha"));
    // The detail pane shows the session id in mono
    expect(screen.getByText(SESSION_A_ID)).toBeDefined();
  });

  it("renders the NoSelectionState until a row is clicked", async () => {
    stubFetchSessions([SESSION_A]);
    render(<SessionsView projectId={PROJECT_ID} />);
    await waitFor(() => expect(screen.getByText("Alpha")).toBeDefined());
    expect(screen.getByText("No session selected.")).toBeDefined();
  });

  it("marks the clicked row aria-selected=true (role=option)", async () => {
    stubFetchSessions([SESSION_A, SESSION_B]);
    render(<SessionsView projectId={PROJECT_ID} />);
    await waitFor(() => expect(screen.getByText("Alpha")).toBeDefined());
    fireEvent.click(screen.getByText("Alpha"));
    const options = screen.getAllByRole("option");
    const selected = options.find((o) => o.getAttribute("aria-selected") === "true");
    expect(selected?.textContent).toContain("Alpha");
  });
});

describe("SessionsView — keyboard nav", () => {
  it("moves selection on ArrowDown when the list has focus", async () => {
    stubFetchSessions([SESSION_A, SESSION_B]);
    render(<SessionsView projectId={PROJECT_ID} />);
    await waitFor(() => expect(screen.getByText("Alpha")).toBeDefined());
    // Click first row, then ArrowDown
    fireEvent.click(screen.getByText("Alpha"));
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "ArrowDown" });
    const options = screen.getAllByRole("option");
    const selected = options.find((o) => o.getAttribute("aria-selected") === "true");
    expect(selected?.textContent).toContain("Beta");
  });

  it("clears the selection on Escape", async () => {
    stubFetchSessions([SESSION_A]);
    render(<SessionsView projectId={PROJECT_ID} />);
    await waitFor(() => expect(screen.getByText("Alpha")).toBeDefined());
    fireEvent.click(screen.getByText("Alpha"));
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(screen.getByText("No session selected.")).toBeDefined();
  });
});

describe("SessionsView — End action", () => {
  it("flips status to 'ended' after a successful POST to /api/sessions/:id/end", async () => {
    const ended: Session = { ...SESSION_A, endedAt: "2026-05-10T13:00:00.000Z" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/end") && init?.method === "POST") {
          return { ok: true, status: 200, json: async () => ended };
        }
        if (url.startsWith("/api/sessions")) {
          return { ok: true, status: 200, json: async () => [SESSION_A] };
        }
        return { ok: true, status: 200, json: async () => [] };
      }),
    );
    render(<SessionsView projectId={PROJECT_ID} />);
    await waitFor(() => expect(screen.getByText("Alpha")).toBeDefined());
    fireEvent.click(screen.getByText("Alpha"));
    fireEvent.click(screen.getByRole("button", { name: "End session" }));
    // After end: status badges 'ended' should appear in the detail
    await waitFor(() =>
      expect(screen.getAllByLabelText("Status: ended").length).toBeGreaterThan(0),
    );
  });
});

describe("SessionsView — Update action", () => {
  it("opens an inline UpdateSessionForm prefilled with the selected session", async () => {
    stubFetchSessions([SESSION_A]);
    render(<SessionsView projectId={PROJECT_ID} />);
    await waitFor(() => expect(screen.getByText("Alpha")).toBeDefined());
    fireEvent.click(screen.getByText("Alpha"));
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    const form = screen.getByLabelText("Update session");
    expect(form).toBeDefined();
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Alpha");
  });

  it("renders the CreateSessionForm when '+ New session' is clicked", async () => {
    stubFetchSessions([]);
    render(<SessionsView projectId={PROJECT_ID} />);
    await waitFor(() => expect(screen.getByText("No sessions yet.")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Create new session" }));
    expect(screen.getByLabelText("Create session")).toBeDefined();
  });
});
