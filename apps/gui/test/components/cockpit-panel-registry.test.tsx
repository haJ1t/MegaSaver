// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CockpitPanel, CockpitPanelProps } from "../../src/cockpit/panel.js";

afterEach(() => {
  cleanup();
});

describe("CockpitPanel contract", () => {
  it("type-checks a hand-built descriptor and renders its component with {dir,id,cwd}", () => {
    const panel: CockpitPanel = {
      id: "x",
      label: "X",
      scope: "session",
      component: ({ dir, id, cwd }: CockpitPanelProps) => (
        <div>
          {dir}/{id}/{cwd}
        </div>
      ),
    };
    const Body = panel.component;
    render(<Body dir="d" id="i" cwd="/tmp/w" />);
    expect(screen.getByText("d/i//tmp/w")).toBeDefined();
  });
});
