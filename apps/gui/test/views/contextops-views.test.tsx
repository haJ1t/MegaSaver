// @vitest-environment jsdom
import type { MemoryEntry } from "@megasaver/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectCreateForm } from "../../src/components/project-create-form.js";
import { MemoryView } from "../../src/views/memory-view.js";
import { OverviewView } from "../../src/views/overview-view.js";
import { RulesView } from "../../src/views/rules-view.js";

const PID = "11111111-1111-4111-8111-111111111111";

const ENTRY: MemoryEntry = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" as MemoryEntry["id"],
  projectId: PID as MemoryEntry["projectId"],
  sessionId: null,
  scope: "project",
  type: "decision",
  title: "remember this",
  content: "remember this",
  keywords: [],
  confidence: "medium",
  source: "manual",
  approval: "suggested",
  stale: false,
  createdAt: "2026-05-10T11:15:00.000Z",
  updatedAt: "2026-05-10T11:15:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ProjectCreateForm", () => {
  it("creates a project and calls onCreated", async () => {
    const created = { id: "p1", name: "fresh", rootPath: "/tmp/x", createdAt: "t", updatedAt: "t" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 201, json: async () => created })),
    );
    const onCreated = vi.fn();
    render(<ProjectCreateForm onCreated={onCreated} />);
    fireEvent.click(screen.getByRole("button", { name: "Create new project" }));
    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "fresh" } });
    fireEvent.change(screen.getByLabelText("Project root path"), { target: { value: "/tmp/x" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
  });

  it("shows the rootpath_invalid error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: "bad root", code: "rootpath_invalid" }),
      })),
    );
    render(<ProjectCreateForm onCreated={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Create new project" }));
    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("Project root path"), { target: { value: "/no" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Root path must be an existing, readable directory.");
  });
});

describe("OverviewView", () => {
  function stub(audit: Record<string, unknown>): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/audit")) return { ok: true, status: 200, json: async () => audit };
        if (url.startsWith("/api/mcp"))
          return { ok: true, status: 200, json: async () => ({ agents: [] }) };
        return { ok: true, status: 200, json: async () => [] };
      }),
    );
  }

  it("shows savings cards when audit has events", async () => {
    stub({
      eventsTotal: 3,
      tokensBefore: 1000,
      tokensAfter: 250,
      percentageSaved: 75,
      rulesApplied: 2,
      memoriesRetrieved: 1,
    });
    render(<OverviewView projectId={PID} onNavigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("75%")).toBeDefined());
  });

  it("shows a fallback note when there are no audit events", async () => {
    stub({ eventsTotal: 0 });
    render(<OverviewView projectId={PID} onNavigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/No audit events yet/)).toBeDefined());
  });

  it("navigates when a card is clicked", async () => {
    stub({ eventsTotal: 0 });
    const onNavigate = vi.fn();
    render(<OverviewView projectId={PID} onNavigate={onNavigate} />);
    await waitFor(() => expect(screen.getByText("sessions")).toBeDefined());
    fireEvent.click(screen.getByText("sessions"));
    expect(onNavigate).toHaveBeenCalledWith("sessions");
  });
});

describe("RulesView", () => {
  it("renders ranked rules", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => [
          {
            rule: {
              id: "r1",
              title: "no any",
              rule: "avoid any",
              severity: "warning",
              appliesTo: [],
            },
            score: 1,
            reason: "matches task text",
          },
        ],
      })),
    );
    render(<RulesView projectId={PID} />);
    await waitFor(() => expect(screen.getByText("no any")).toBeDefined());
  });

  it("renders an empty state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => [] })),
    );
    render(<RulesView projectId={PID} />);
    await waitFor(() => expect(screen.getByText("No rules yet.")).toBeDefined());
  });
});

describe("MemoryView mutations", () => {
  function stubWithEntry(): ReturnType<typeof vi.fn> {
    const spy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/sessions")) return { ok: true, status: 200, json: async () => [] };
      if (url.startsWith("/api/memory/") && init?.method === "PATCH") {
        return { ok: true, status: 200, json: async () => ({ ...ENTRY, approval: "approved" }) };
      }
      if (url.startsWith("/api/memory/") && init?.method === "DELETE") {
        return { ok: true, status: 200, json: async () => ({ id: ENTRY.id }) };
      }
      if (url.startsWith("/api/memory"))
        return { ok: true, status: 200, json: async () => [ENTRY] };
      return { ok: true, status: 200, json: async () => [] };
    });
    vi.stubGlobal("fetch", spy);
    return spy;
  }

  it("approves a selected entry", async () => {
    stubWithEntry();
    render(<MemoryView projectId={PID} onViewSession={vi.fn()} />);
    fireEvent.click(await screen.findByText("remember this"));
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() => expect(screen.getByText("approved")).toBeDefined());
  });

  it("deletes a selected entry after confirm", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    stubWithEntry();
    render(<MemoryView projectId={PID} onViewSession={vi.fn()} />);
    fireEvent.click(await screen.findByText("remember this"));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.getByText("No memory entries yet.")).toBeDefined());
  });
});
