// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryPanel } from "../../src/views/cockpit/memory-panel.js";
import { TasksPanel } from "../../src/views/cockpit/tasks-panel.js";
import { TokenSaverPanel as SessionTokenSaverPanel } from "../../src/views/cockpit/token-saver-panel.js";

const DIR = "ws-dir";
const ID = "wssess01";
const WK = "0123456789abcdef";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const memoryRow = {
  id: "00000000-0000-4000-8000-000000000001",
  workspaceKey: WK,
  liveSessionId: ID,
  scope: "session",
  type: "decision",
  title: "first note",
  content: "first note",
  keywords: [],
  confidence: "medium",
  source: "manual",
  approval: "approved",
  stale: false,
  createdAt: "2026-06-14T00:00:00.000Z",
  updatedAt: "2026-06-14T00:00:00.000Z",
};

describe("MemoryPanel", () => {
  it("renders the list, then a create POSTs and prepends the new row", async () => {
    const created = {
      ...memoryRow,
      id: "00000000-0000-4000-8000-000000000002",
      content: "new note",
    };
    const fetchMock = vi.fn(async (url: string, opts?: { method?: string }) => {
      if (opts?.method === "POST") {
        return { ok: true, status: 201, json: async () => created };
      }
      return { ok: true, status: 200, json: async () => [memoryRow] };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MemoryPanel dir={DIR} id={ID} />);
    await waitFor(() => expect(screen.getByText("first note")).toBeDefined());

    fireEvent.change(screen.getByLabelText(/new note/i), { target: { value: "new note" } });
    fireEvent.click(screen.getByRole("button", { name: /add note/i }));

    await waitFor(() => expect(screen.getByText("new note")).toBeDefined());
    const postCall = fetchMock.mock.calls.find(
      (c) => (c[1] as { method?: string })?.method === "POST",
    );
    expect(postCall).toBeDefined();
  });

  it("delete removes the row", async () => {
    const fetchMock = vi.fn(async (_url: string, opts?: { method?: string }) => {
      if (opts?.method === "DELETE") {
        return { ok: true, status: 200, json: async () => ({ id: memoryRow.id }) };
      }
      return { ok: true, status: 200, json: async () => [memoryRow] };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MemoryPanel dir={DIR} id={ID} />);
    await waitFor(() => expect(screen.getByText("first note")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    await waitFor(() => expect(screen.queryByText("first note")).toBeNull());
  });
});

describe("TasksPanel", () => {
  it("renders plans with ready badges", async () => {
    const plan = {
      plan: {
        id: "00000000-0000-4000-8000-000000000b01",
        workspaceKey: WK,
        liveSessionId: ID,
        task: "ship it",
        status: "planned",
        steps: [
          { id: "s1", type: "scan", title: "scan", dependsOn: [], status: "pending" },
          { id: "s2", type: "edit", title: "edit", dependsOn: ["s1"], status: "pending" },
        ],
        createdAt: "2026-06-14T00:00:00.000Z",
        updatedAt: "2026-06-14T00:00:00.000Z",
      },
      ready: ["s1"],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => [plan] })),
    );
    render(<TasksPanel dir={DIR} id={ID} />);
    await waitFor(() => expect(screen.getByText("ship it")).toBeDefined());
    expect(screen.getByText(/1 ready/i)).toBeDefined();
  });
});

describe("Session TokenSaverPanel (read-only)", () => {
  it("renders the tokens-saved table with no write controls", async () => {
    const stats = {
      liveSessionId: ID,
      eventsTotal: 1,
      rawBytesTotal: 1000,
      returnedBytesTotal: 200,
      bytesSavedTotal: 800,
      savingRatio: 0.8,
      secretsRedactedTotal: 0,
      chunksStoredTotal: 1,
      updatedAt: "2026-06-14T00:00:00.000Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/stats")) return { ok: true, status: 200, json: async () => stats };
        return { ok: true, status: 200, json: async () => ({ enabled: false, settings: null }) };
      }),
    );
    render(<SessionTokenSaverPanel dir={DIR} id={ID} />);
    // raw 1000 B -> 250 tok, returned 200 B -> 50 tok, saved 200 tok
    await waitFor(() => expect(screen.getByText("200 tokens")).toBeDefined());
    expect(screen.getByText("Saved")).toBeDefined();
    expect(screen.queryByRole("button", { name: /enable/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /disable/i })).toBeNull();
  });
});
