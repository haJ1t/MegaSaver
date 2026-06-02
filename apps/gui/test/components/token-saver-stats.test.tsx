// @vitest-environment jsdom
import type { SessionTokenSaverStats } from "@megasaver/stats";
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

afterEach(() => {
  cleanup();
});

describe("TokenSaverStats", () => {
  it("renders 'No activity yet.' when stats is null", () => {
    render(<TokenSaverStats stats={null} />);
    expect(screen.getByText("No activity yet.")).toBeDefined();
  });

  it("renders the events total", () => {
    const { container } = render(<TokenSaverStats stats={STATS} />);
    expect(container.textContent).toContain("3");
  });

  it("renders the saving ratio as a percentage", () => {
    const { container } = render(<TokenSaverStats stats={STATS} />);
    expect(container.textContent).toContain("80%");
  });

  it("renders the secrets-redacted count", () => {
    const { container } = render(<TokenSaverStats stats={STATS} />);
    expect(container.textContent).toContain("2");
  });
});
