// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/app.js";

afterEach(cleanup);

describe("App shell", () => {
  it("defaults to the Sessions view with a six-item sidebar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
      ),
    );
    render(<App />);
    const nav = screen.getByRole("navigation", { name: /main/i });
    expect(nav.querySelectorAll("button").length).toBe(6);
    expect(screen.getByRole("button", { name: "Sessions" }).getAttribute("aria-current")).toBe(
      "page",
    );
    vi.unstubAllGlobals();
  });

  it("navigates to Token saver", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
      ),
    );
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Token saver" }));
    expect(await screen.findByRole("heading", { name: /token saver/i })).toBeTruthy();
    vi.unstubAllGlobals();
  });
});
