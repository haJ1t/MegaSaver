// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app.js";

function stubFetchEmpty(): void {
  const empty = async () => ({
    ok: true,
    status: 200,
    json: async () => [],
  });
  vi.stubGlobal("fetch", vi.fn(empty));
}

describe("App", () => {
  beforeEach(() => {
    stubFetchEmpty();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders both view-switcher buttons", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: "Sessions" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Memory entries" })).toBeDefined();
  });

  it("defaults to the sessions view (sessions button marked current)", () => {
    render(<App />);
    const sessionsButton = screen.getByRole("button", { name: "Sessions" });
    expect(sessionsButton.getAttribute("aria-current")).toBe("page");
  });

  it("switches to the memory view on click", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Memory entries" }));
    const memoryButton = screen.getByRole("button", { name: "Memory entries" });
    expect(memoryButton.getAttribute("aria-current")).toBe("page");
  });

  it("renders empty-state copy when the bridge returns no rows", async () => {
    render(<App />);
    expect(await screen.findByText("no sessions")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Memory entries" }));
    expect(await screen.findByText("no memory entries")).toBeDefined();
  });
});
