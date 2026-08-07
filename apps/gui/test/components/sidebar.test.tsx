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
  it("renders eight nav items in display order and marks the active one", () => {
    render(<Sidebar active="sessions" onNavigate={() => {}} />);
    const nav = screen.getByRole("navigation", { name: /main/i });
    const buttons = nav.querySelectorAll("button");
    expect(buttons.length).toBe(8);
    expect(buttons[0]?.textContent).toContain("Overview");
    expect(buttons[1]?.textContent).toContain("Sessions");
    expect(screen.getByRole("button", { name: /Sessions/ }).getAttribute("aria-current")).toBe(
      "page",
    );
  });

  it("groups the nav under Monitor / Optimize / Configure", () => {
    render(<Sidebar active="overview" onNavigate={() => {}} />);
    for (const title of ["Monitor", "Optimize", "Configure"]) {
      expect(screen.getByText(title)).toBeTruthy();
    }
  });

  it("reports the clicked view", () => {
    const onNavigate = vi.fn();
    render(<Sidebar active="sessions" onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: /Memory/ }));
    expect(onNavigate).toHaveBeenCalledWith("memory");
  });

  it("shows the session count and the setup attention dot only when asked", () => {
    const { rerender } = render(
      <Sidebar active="overview" onNavigate={() => {}} sessionCount={12} needsSetup />,
    );
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByLabelText("Setup needs attention")).toBeTruthy();

    rerender(<Sidebar active="overview" onNavigate={() => {}} />);
    expect(screen.queryByLabelText("Setup needs attention")).toBeNull();
  });

  it("shows daemon status in the footer", async () => {
    render(<Sidebar active="sessions" onNavigate={() => {}} />);
    expect(await screen.findByText(/daemon/i)).toBeTruthy();
  });

  it("offers a theme toggle", () => {
    render(<Sidebar active="sessions" onNavigate={() => {}} />);
    expect(screen.getByRole("button", { name: /switch to (light|dark) theme/i })).toBeTruthy();
  });
});
