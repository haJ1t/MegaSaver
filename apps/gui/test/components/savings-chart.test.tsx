// @vitest-environment jsdom
import type { TokenSaverEvent } from "@megasaver/stats";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SavingsChart } from "../../src/components/savings-chart.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function event(over: Partial<TokenSaverEvent>): TokenSaverEvent {
  return {
    id: "evt",
    sessionId: SESSION_ID as TokenSaverEvent["sessionId"],
    projectId: PROJECT_ID as TokenSaverEvent["projectId"],
    createdAt: "2026-05-10T12:00:00.000Z",
    sourceKind: "command",
    label: "ls -la",
    rawBytes: 1000,
    returnedBytes: 200,
    bytesSaved: 800,
    savingRatio: 0.8,
    summary: "directory listing",
    mode: "balanced",
    ...over,
  };
}

const THREE_EVENTS: TokenSaverEvent[] = [
  event({ id: "e1", createdAt: "2026-05-10T12:00:00.000Z", savingRatio: 0.6 }),
  event({ id: "e2", createdAt: "2026-05-10T13:00:00.000Z", savingRatio: 0.9 }),
  event({ id: "e3", createdAt: "2026-05-10T14:00:00.000Z", savingRatio: 0.75 }),
];

afterEach(() => {
  cleanup();
});

describe("SavingsChart", () => {
  it("renders an empty-state message when there are no events", () => {
    const { container } = render(<SavingsChart events={[]} />);
    expect(screen.getByText(/no savings data yet/i)).toBeDefined();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("exposes the chart as role=img with a descriptive label", () => {
    render(<SavingsChart events={THREE_EVENTS} />);
    const img = screen.getByRole("img");
    expect(img).toBeDefined();
    const label = img.getAttribute("aria-label") ?? "";
    expect(label).toMatch(/3 events/i);
  });

  it("summarises the average saving ratio in the aria-label", () => {
    // avg of 0.6, 0.9, 0.75 = 0.75 → 75%
    render(<SavingsChart events={THREE_EVENTS} />);
    const label = screen.getByRole("img").getAttribute("aria-label") ?? "";
    expect(label).toMatch(/75%/);
  });

  it("renders one bar rect per event", () => {
    const { container } = render(<SavingsChart events={THREE_EVENTS} />);
    expect(container.querySelectorAll("rect[data-bar]").length).toBe(3);
  });

  it("renders a single event without throwing and labels it as 1 event", () => {
    render(<SavingsChart events={[event({ id: "solo", savingRatio: 0.5 })]} />);
    const label = screen.getByRole("img").getAttribute("aria-label") ?? "";
    expect(label).toMatch(/1 event\b/i);
    expect(label).toMatch(/50%/);
  });

  it("marks the inline SVG itself as aria-hidden (label is on the wrapper)", () => {
    const { container } = render(<SavingsChart events={THREE_EVENTS} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });
});
