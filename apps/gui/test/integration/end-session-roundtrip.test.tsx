// @vitest-environment jsdom
import type { Project, Session } from "@megasaver/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/app.js";
import { installLocalStoragePolyfill } from "../support/local-storage-polyfill.js";

const PROJECT: Project = {
  id: "11111111-1111-4111-8111-111111111111" as Project["id"],
  name: "demo",
  rootPath: "/tmp/demo",
  createdAt: "2026-05-09T00:00:00.000Z",
  updatedAt: "2026-05-09T00:00:00.000Z",
};

const OPEN_SESSION: Session = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as Session["id"],
  projectId: PROJECT.id,
  agentId: "claude-code",
  riskLevel: "medium",
  title: "to-be-ended",
  startedAt: "2026-05-10T12:00:00.000Z",
  endedAt: null,
};

const ENDED: Session = { ...OPEN_SESSION, endedAt: "2026-05-10T13:00:00.000Z" };

beforeEach(() => {
  installLocalStoragePolyfill();
  localStorage.setItem("megasaver:gui:v1:active-project-id", PROJECT.id);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("End session roundtrip", () => {
  it("flips the row status from 'open' to 'ended' after the POST resolves", async () => {
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/projects")) {
        return { ok: true, status: 200, json: async () => [PROJECT] };
      }
      if (url.includes("/end") && init?.method === "POST") {
        return { ok: true, status: 200, json: async () => ENDED };
      }
      if (url.startsWith("/api/sessions")) {
        return { ok: true, status: 200, json: async () => [OPEN_SESSION] };
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
    // New IA: default landing is Overview; navigate to the Sessions view first.
    fireEvent.click(await screen.findByRole("button", { name: "Sessions" }));
    await waitFor(() => expect(screen.getByText("to-be-ended")).toBeDefined());

    fireEvent.click(screen.getByText("to-be-ended"));
    fireEvent.click(screen.getByRole("button", { name: "End session" }));

    await waitFor(() =>
      expect(screen.getAllByLabelText("Status: ended").length).toBeGreaterThan(0),
    );

    const endCall = fetchSpy.mock.calls.find(
      ([u, init]) => typeof u === "string" && u.includes("/end") && init?.method === "POST",
    );
    expect(endCall).toBeDefined();
    expect((endCall as [string, RequestInit])[0]).toContain(OPEN_SESSION.id);
  });
});
