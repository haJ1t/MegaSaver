// @vitest-environment jsdom
import type { Project, Session } from "@megasaver/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/app.js";
import { installLocalStoragePolyfill } from "../support/local-storage-polyfill.js";

const PROJECT_A: Project = {
  id: "11111111-1111-4111-8111-111111111111" as Project["id"],
  name: "alpha",
  rootPath: "/tmp/a",
  createdAt: "2026-05-09T00:00:00.000Z",
  updatedAt: "2026-05-09T00:00:00.000Z",
};

const PROJECT_B: Project = {
  id: "22222222-2222-4222-8222-222222222222" as Project["id"],
  name: "beta",
  rootPath: "/tmp/b",
  createdAt: "2026-05-09T01:00:00.000Z",
  updatedAt: "2026-05-09T01:00:00.000Z",
};

const SESSION_A: Session = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as Session["id"],
  projectId: PROJECT_A.id,
  agentId: "claude-code",
  riskLevel: "medium",
  title: "alpha-session",
  startedAt: "2026-05-10T11:00:00.000Z",
  endedAt: null,
};

const SESSION_B: Session = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" as Session["id"],
  projectId: PROJECT_B.id,
  agentId: "codex",
  riskLevel: "high",
  title: "beta-session",
  startedAt: "2026-05-10T12:00:00.000Z",
  endedAt: null,
};

beforeEach(() => {
  installLocalStoragePolyfill();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Picker cascade — list filters by active project", () => {
  it("fetches /api/sessions with the chosen projectId after the picker selects a project", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.startsWith("/api/projects")) {
        return { ok: true, status: 200, json: async () => [PROJECT_A, PROJECT_B] };
      }
      if (url.startsWith("/api/sessions")) {
        if (url.includes(PROJECT_A.id)) {
          return { ok: true, status: 200, json: async () => [SESSION_A] };
        }
        if (url.includes(PROJECT_B.id)) {
          return { ok: true, status: 200, json: async () => [SESSION_B] };
        }
        return { ok: true, status: 200, json: async () => [] };
      }
      if (url.includes("/audit")) {
        return { ok: true, status: 200, json: async () => ({ eventsTotal: 0 }) };
      }
      if (url.startsWith("/api/mcp")) {
        return { ok: true, status: 200, json: async () => ({ agents: [] }) };
      }
      return { ok: true, status: 200, json: async () => [] };
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<App />);
    // Wait for the picker to render.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Active project/ })).toBeDefined(),
    );
    // Open the picker, choose alpha.
    fireEvent.click(screen.getByRole("button", { name: /Active project/ }));
    fireEvent.click(screen.getByText("alpha"));
    // New IA: default landing is Overview; navigate to the Sessions view.
    fireEvent.click(await screen.findByRole("button", { name: "Sessions" }));

    await waitFor(() => expect(screen.getByText("alpha-session")).toBeDefined());
    // The fetched url for sessions should have alpha's id.
    const sessionsCalls = fetchSpy.mock.calls.filter(
      ([u]) => typeof u === "string" && u.startsWith("/api/sessions"),
    );
    expect(sessionsCalls.some(([u]) => String(u).includes(PROJECT_A.id))).toBe(true);
  });

  it("re-fetches and swaps the list when picker selects a different project", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.startsWith("/api/projects")) {
        return { ok: true, status: 200, json: async () => [PROJECT_A, PROJECT_B] };
      }
      if (url.startsWith("/api/sessions")) {
        if (url.includes(PROJECT_A.id)) {
          return { ok: true, status: 200, json: async () => [SESSION_A] };
        }
        if (url.includes(PROJECT_B.id)) {
          return { ok: true, status: 200, json: async () => [SESSION_B] };
        }
      }
      if (url.includes("/audit")) {
        return { ok: true, status: 200, json: async () => ({ eventsTotal: 0 }) };
      }
      if (url.startsWith("/api/mcp")) {
        return { ok: true, status: 200, json: async () => ({ agents: [] }) };
      }
      return { ok: true, status: 200, json: async () => [] };
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Active project/ })).toBeDefined(),
    );
    fireEvent.click(screen.getByRole("button", { name: /Active project/ }));
    fireEvent.click(screen.getByText("alpha"));
    fireEvent.click(await screen.findByRole("button", { name: "Sessions" }));
    await waitFor(() => expect(screen.getByText("alpha-session")).toBeDefined());

    // Now switch to beta.
    fireEvent.click(screen.getByRole("button", { name: /Active project/ }));
    fireEvent.click(screen.getByText("beta"));
    await waitFor(() => expect(screen.getByText("beta-session")).toBeDefined());
    expect(screen.queryByText("alpha-session")).toBeNull();
  });
});
