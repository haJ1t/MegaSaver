// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionTelemetry } from "../../src/lib/claude-sessions-client.js";

const stub: { fetch: (dir: string, id: string) => Promise<SessionTelemetry> } = {
  fetch: () => Promise.reject(new Error("not set")),
};

vi.mock("../../src/lib/claude-sessions-client.js", () => ({
  fetchClaudeSessionTelemetry: (dir: string, id: string) => stub.fetch(dir, id),
}));

import { TelemetryPanel } from "../../src/cockpit/panels/telemetry-panel.js";

const FIXTURE: SessionTelemetry = {
  turnCount: 12,
  assistantTurns: 6,
  toolCallCount: 9,
  totals: {
    inputTokens: 1000,
    outputTokens: 2000,
    cacheCreationInputTokens: 300,
    cacheReadInputTokens: 400,
  },
  models: [
    {
      model: "claude-opus-4-8-20260101",
      turns: 6,
      inputTokens: 1000,
      outputTokens: 2000,
      cacheCreationInputTokens: 300,
      cacheReadInputTokens: 400,
    },
  ],
  firstTs: "2026-06-14T00:00:00.000Z",
  lastTs: "2026-06-14T00:05:00.000Z",
  durationMs: 300000,
  gitBranch: "feat/live-first-architecture",
};

afterEach(() => {
  cleanup();
  stub.fetch = () => Promise.reject(new Error("not set"));
});

describe("TelemetryPanel", () => {
  it("renders token, turn, tool, duration tiles and a model-mix row from telemetry", async () => {
    stub.fetch = () => Promise.resolve(FIXTURE);
    render(<TelemetryPanel dir="d" id="i" cwd="/tmp/w" />);
    await waitFor(() => expect(screen.getByText("1000")).toBeDefined());
    expect(screen.getByText("2000")).toBeDefined();
    expect(screen.getByText("300")).toBeDefined();
    expect(screen.getByText("400")).toBeDefined();
    expect(screen.getByText("12")).toBeDefined();
    expect(screen.getByText("9")).toBeDefined();
    expect(screen.getByText(/LLM context tokens/)).toBeDefined();
    expect(screen.getByText(/claude-opus-4-8/)).toBeDefined();
  });

  it("renders the empty state when telemetry is unavailable", async () => {
    stub.fetch = () => Promise.reject(new Error("nope"));
    render(<TelemetryPanel dir="d" id="i" cwd="/tmp/w" />);
    await waitFor(() => expect(screen.getByText(/Telemetry unavailable/)).toBeDefined());
  });
});
