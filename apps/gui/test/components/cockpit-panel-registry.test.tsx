// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { COCKPIT_PANELS, getPanel } from "../../src/cockpit/panel-registry.js";
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

describe("COCKPIT_PANELS registry", () => {
  it("exposes session panels then workspace panels in order", () => {
    expect(COCKPIT_PANELS.map((p) => p.id)).toEqual(["transcript", "telemetry", "tasks"]);
  });

  it("resolves a registered panel via getPanel", () => {
    const panel = getPanel("transcript");
    expect(panel?.id).toBe("transcript");
    expect(panel?.label).toBe("Transcript");
    expect(panel?.scope).toBe("session");
  });

  it("returns undefined for an unknown panel id", () => {
    expect(getPanel("nope")).toBeUndefined();
  });

  it("has a unique id for every descriptor", () => {
    const ids = COCKPIT_PANELS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every descriptor a stable id/label/scope/component", () => {
    for (const p of COCKPIT_PANELS) {
      expect(typeof p.id).toBe("string");
      expect(typeof p.label).toBe("string");
      expect(p.scope === "session" || p.scope === "workspace").toBe(true);
      expect(typeof p.component).toBe("function");
    }
  });
});
