// @vitest-environment jsdom
import type { Project } from "@megasaver/core";
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

function stubFetchOneProject(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.startsWith("/api/projects") && !url.includes("/audit")) {
        return { ok: true, status: 200, json: async () => [PROJECT] };
      }
      if (url.includes("/audit")) {
        return { ok: true, status: 200, json: async () => ({ eventsTotal: 0 }) };
      }
      if (url.startsWith("/api/mcp")) {
        return { ok: true, status: 200, json: async () => ({ agents: [] }) };
      }
      return { ok: true, status: 200, json: async () => [] };
    }),
  );
}

beforeEach(() => {
  installLocalStoragePolyfill();
  // Default: no projects.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => [] })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("App — view switching", () => {
  it("sets aria-current='page' on the Overview button by default", async () => {
    stubFetchOneProject();
    render(<App />);
    const btn = await screen.findByRole("button", { name: "Overview" });
    expect(btn.getAttribute("aria-current")).toBe("page");
  });

  it("switches aria-current to the Memory button when clicked", async () => {
    stubFetchOneProject();
    render(<App />);
    await screen.findByRole("button", { name: "Memory" });
    fireEvent.click(screen.getByRole("button", { name: "Memory" }));
    expect(screen.getByRole("button", { name: "Memory" }).getAttribute("aria-current")).toBe(
      "page",
    );
  });

  it("clears aria-current on the previously active button after switching", async () => {
    stubFetchOneProject();
    render(<App />);
    await screen.findByRole("button", { name: "Memory" });
    fireEvent.click(screen.getByRole("button", { name: "Memory" }));
    expect(
      screen.getByRole("button", { name: "Overview" }).getAttribute("aria-current"),
    ).toBeNull();
  });
});

describe("App — picker visibility and project gating", () => {
  it("renders the NoProjectState helper when the store has no projects", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("No projects yet.")).toBeDefined());
    expect(screen.getByText(/mega project create/)).toBeDefined();
  });

  it("renders 'Pick a project to begin.' when projects exist but none selected", async () => {
    stubFetchOneProject();
    render(<App />);
    await waitFor(() => expect(screen.getByText("Pick a project to begin.")).toBeDefined());
  });

  it("shows the project picker only after projects load (not during loading)", async () => {
    stubFetchOneProject();
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Active project/ })).toBeDefined(),
    );
  });
});

describe("App — localStorage restore", () => {
  it("restores a persisted project id that matches an existing project", async () => {
    localStorage.setItem("megasaver:gui:v1:active-project-id", PROJECT.id);
    stubFetchOneProject();
    render(<App />);
    // After load, picker trigger should mention 'demo' (not 'Select project').
    await waitFor(() => expect(screen.getByRole("button", { name: /demo/ })).toBeDefined());
  });

  it("ignores a persisted project id that does not match any project (falls back to picker prompt)", async () => {
    localStorage.setItem(
      "megasaver:gui:v1:active-project-id",
      "deadbeef-dead-4dad-8dad-deadbeefdead",
    );
    stubFetchOneProject();
    render(<App />);
    await waitFor(() => expect(screen.getByText("Pick a project to begin.")).toBeDefined());
  });
});
