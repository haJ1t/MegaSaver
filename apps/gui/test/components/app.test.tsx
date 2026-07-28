// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/app.js";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("App shell", () => {
  it("defaults to the Overview view with a seven-item sidebar", () => {
    render(<App />);
    const nav = screen.getByRole("navigation", { name: /main/i });
    expect(nav.querySelectorAll("button").length).toBe(7);
    expect(screen.getByRole("button", { name: /Overview/ }).getAttribute("aria-current")).toBe(
      "page",
    );
  });

  it("navigates to Token saver", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Token saver/ }));
    expect(await screen.findByRole("heading", { name: /token saver/i })).toBeTruthy();
  });

  it("navigates to Sessions", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Sessions/ }));
    expect(await screen.findByRole("heading", { name: /sessions/i })).toBeTruthy();
  });

  it("opens the command palette on Cmd-K and closes it on Escape", async () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    const dialog = await screen.findByRole("dialog", { name: /command palette/i });
    expect(dialog).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: /command palette/i })).toBeNull();
  });

  it("jumps to a view from the palette", async () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    fireEvent.click(await screen.findByRole("button", { name: /Memory\s*view/ }));
    expect(await screen.findByRole("heading", { name: /memory/i })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: /command palette/i })).toBeNull();
  });

  it("shows the live-session count in the top bar", () => {
    render(<App />);
    expect(screen.getByText(/0 live/)).toBeTruthy();
  });
});
