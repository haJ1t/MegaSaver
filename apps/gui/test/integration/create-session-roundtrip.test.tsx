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

const CREATED: Session = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as Session["id"],
  projectId: PROJECT.id,
  agentId: "claude-code",
  riskLevel: "medium",
  title: "first session",
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

describe("Create session roundtrip", () => {
  it("posts the form body to /api/sessions and the list reflects the new session without manual reload", async () => {
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/projects")) {
        return { ok: true, status: 200, json: async () => [PROJECT] };
      }
      if (url.startsWith("/api/sessions") && init?.method === "POST") {
        return { ok: true, status: 201, json: async () => CREATED };
      }
      if (url.startsWith("/api/sessions")) {
        return { ok: true, status: 200, json: async () => [] };
      }
      return { ok: true, status: 200, json: async () => [] };
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<App />);
    // Wait for first list load to complete.
    await waitFor(() => expect(screen.getByText("No sessions yet.")).toBeDefined());

    // Open the create form.
    fireEvent.click(screen.getByRole("button", { name: "Create new session" }));
    fireEvent.change(screen.getByLabelText("Title (optional)"), {
      target: { value: "first session" },
    });
    fireEvent.submit(screen.getByLabelText("Create session"));

    // After POST resolves, the list should show the new row (form unmounts on
    // success, so we expect exactly one occurrence in the rendered list).
    await waitFor(() => {
      const matches = screen.getAllByText("first session");
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    // The POST call carried the expected body.
    const postCall = fetchSpy.mock.calls.find(
      ([u, init]) => typeof u === "string" && u === "/api/sessions" && init?.method === "POST",
    );
    expect(postCall).toBeDefined();
    const body = JSON.parse((postCall as [string, RequestInit])[1].body as string);
    expect(body.projectId).toBe(PROJECT.id);
    expect(body.title).toBe("first session");
  });
});
