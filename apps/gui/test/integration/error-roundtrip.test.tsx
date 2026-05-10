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
  title: "boom",
  startedAt: "2026-05-10T12:00:00.000Z",
  endedAt: null,
};

beforeEach(() => {
  installLocalStoragePolyfill();
  localStorage.setItem("megasaver:gui:v1:active-project-id", PROJECT.id);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Bridge error roundtrip", () => {
  it("renders localized BRIDGE_ERROR_COPY copy for session_already_ended (409)", async () => {
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/projects")) {
        return { ok: true, status: 200, json: async () => [PROJECT] };
      }
      if (url.includes("/end") && init?.method === "POST") {
        return {
          ok: false,
          status: 409,
          json: async () => ({
            error: "Session already ended",
            code: "session_already_ended",
          }),
        };
      }
      if (url.startsWith("/api/sessions")) {
        return { ok: true, status: 200, json: async () => [OPEN_SESSION] };
      }
      return { ok: true, status: 200, json: async () => [] };
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<App />);
    await waitFor(() => expect(screen.getByText("boom")).toBeDefined());
    fireEvent.click(screen.getByText("boom"));
    fireEvent.click(screen.getByRole("button", { name: "End session" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("This session has already ended.");
  });

  it("renders validation_failed copy and exposes the machine code", async () => {
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/projects")) {
        return { ok: true, status: 200, json: async () => [PROJECT] };
      }
      if (url === "/api/sessions" && init?.method === "POST") {
        return {
          ok: false,
          status: 400,
          json: async () => ({
            error: "bad",
            code: "validation_failed",
            details: [],
          }),
        };
      }
      if (url.startsWith("/api/sessions")) {
        return { ok: true, status: 200, json: async () => [] };
      }
      return { ok: true, status: 200, json: async () => [] };
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<App />);
    await waitFor(() => expect(screen.getByText("No sessions yet.")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Create new session" }));
    fireEvent.submit(screen.getByLabelText("Create session"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Invalid input");
    expect(alert.textContent).toContain("validation_failed");
  });
});
