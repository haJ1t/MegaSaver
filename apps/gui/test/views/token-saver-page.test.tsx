// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceOption } from "../../src/lib/workspace-context.js";
import { TokenSaverPage } from "../../src/views/token-saver-page.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const OPTS: WorkspaceOption[] = [
  { key: "k1", cwd: "/ws/a", label: "a", rep: { dir: "d1", id: "s1" } },
];

describe("TokenSaverPage", () => {
  it("renders global controls plus saver activation for the active workspace", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
      ),
    );
    render(<TokenSaverPage options={OPTS} activeKey="k1" onWorkspaceChange={() => {}} />);
    expect(screen.getByLabelText("Active workspace")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /token saver/i })).toBeTruthy();
  });
});
