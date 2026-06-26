// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../src/app.js";

afterEach(cleanup);

describe("App shell", () => {
  it("renders a centered page surface", () => {
    render(<App />);
    const container = screen.getByTestId("page-container");
    expect(container.className).toMatch(/max-w-5xl/);
    expect(container.className).toMatch(/mx-auto/);
  });

  it("marks the active nav item with aria-current and solid styling", () => {
    render(<App />);
    const active = screen.getByRole("button", { name: "Claude sessions" });
    expect(active.getAttribute("aria-current")).toBe("page");
    expect(active.className).toMatch(/bg-text-primary/);
    expect(active.className).toMatch(/text-surface/);
  });
});
