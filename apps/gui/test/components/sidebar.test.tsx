// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "../../src/components/sidebar.js";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ running: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Sidebar", () => {
  it("renders six nav items in display order and marks the active one", () => {
    render(<Sidebar active="sessions" onNavigate={() => {}} />);
    const nav = screen.getByRole("navigation", { name: /main/i });
    const buttons = nav.querySelectorAll("button");
    expect(buttons.length).toBe(6);
    expect(buttons[0]?.textContent).toBe("Sessions");
    expect(screen.getByRole("button", { name: "Sessions" }).getAttribute("aria-current")).toBe(
      "page",
    );
  });

  it("reports the clicked view", () => {
    const onNavigate = vi.fn();
    render(<Sidebar active="sessions" onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: "Memory" }));
    expect(onNavigate).toHaveBeenCalledWith("memory");
  });

  it("shows daemon status in the footer", async () => {
    render(<Sidebar active="sessions" onNavigate={() => {}} />);
    expect(await screen.findByText(/daemon/i)).toBeTruthy();
  });
});
