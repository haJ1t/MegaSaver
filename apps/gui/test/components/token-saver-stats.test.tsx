// @vitest-environment jsdom
import type { SessionTokenSaverStats, TokenSaverEvent } from "@megasaver/stats";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TokenSaverStats } from "../../src/components/token-saver-stats.js";

const STATS: SessionTokenSaverStats = {
  sessionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" as SessionTokenSaverStats["sessionId"],
  eventsTotal: 3,
  rawBytesTotal: 5000,
  returnedBytesTotal: 1000,
  bytesSavedTotal: 4000,
  savingRatio: 0.8,
  secretsRedactedTotal: 2,
  chunksStoredTotal: 7,
  updatedAt: "2026-05-10T12:00:00.000Z",
};

function event(over: Partial<TokenSaverEvent>): TokenSaverEvent {
  return {
    id: "evt",
    sessionId: STATS.sessionId,
    projectId: "11111111-1111-4111-8111-111111111111" as TokenSaverEvent["projectId"],
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

afterEach(() => {
  cleanup();
});

describe("TokenSaverStats", () => {
  it("renders 'No activity yet.' when stats is null", () => {
    render(<TokenSaverStats stats={null} events={[]} />);
    expect(screen.getByText("No activity yet.")).toBeDefined();
  });

  it("renders the events total", () => {
    const { container } = render(<TokenSaverStats stats={STATS} events={[]} />);
    expect(container.textContent).toContain("3");
  });

  it("renders the saving ratio as a percentage", () => {
    const { container } = render(<TokenSaverStats stats={STATS} events={[]} />);
    expect(container.textContent).toContain("80%");
  });

  it("renders the secrets-redacted count", () => {
    const { container } = render(<TokenSaverStats stats={STATS} events={[]} />);
    expect(container.textContent).toContain("2");
  });

  it("embeds the savings chart when events are present", () => {
    render(
      <TokenSaverStats
        stats={STATS}
        events={[event({ id: "e1", savingRatio: 0.6 }), event({ id: "e2", savingRatio: 0.9 })]}
      />,
    );
    const img = screen.getByRole("img");
    expect(img.getAttribute("aria-label")).toMatch(/2 events/i);
  });

  it("shows the chart empty-state when there are no events", () => {
    render(<TokenSaverStats stats={STATS} events={[]} />);
    expect(screen.getByText(/no savings data yet/i)).toBeDefined();
  });
});
