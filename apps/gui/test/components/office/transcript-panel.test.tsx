// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TranscriptEntry, TranscriptStreamHandlers } from "../../../src/lib/office-client.js";

const stub: {
  fetchTranscript: (wk: string, agentId: string) => Promise<TranscriptEntry[]>;
  openTranscriptStream: (wk: string, agentId: string, h: TranscriptStreamHandlers) => () => void;
} = {
  fetchTranscript: () => Promise.resolve([]),
  openTranscriptStream: () => () => undefined,
};

vi.mock("../../../src/lib/office-client.js", () => ({
  fetchTranscript: (wk: string, agentId: string) => stub.fetchTranscript(wk, agentId),
  openTranscriptStream: (wk: string, agentId: string, h: TranscriptStreamHandlers) =>
    stub.openTranscriptStream(wk, agentId, h),
}));

import { TranscriptPanel } from "../../../src/views/office/transcript-panel.js";

const ENTRY = (over: Partial<TranscriptEntry>): TranscriptEntry => ({
  id: `00000000-0000-4000-8000-00000000000${over.seq ?? 0}`,
  seq: over.seq ?? 0,
  ts: "2026-06-23T12:00:00.000Z",
  role: "assistant",
  ...over,
});

afterEach(() => {
  cleanup();
  stub.fetchTranscript = () => Promise.resolve([]);
  stub.openTranscriptStream = () => () => undefined;
});

describe("TranscriptPanel", () => {
  it("renders the backlog: assistant text and a tool line", async () => {
    stub.fetchTranscript = () =>
      Promise.resolve([
        ENTRY({ seq: 0, role: "assistant", text: "Working on it" }),
        ENTRY({ seq: 1, role: "tool", tool: "Edit", summary: "foo.ts" }),
      ]);
    render(<TranscriptPanel wk="wk1" agentId="a1" />);
    await waitFor(() => expect(screen.getByText("Working on it")).toBeDefined());
    expect(screen.getByText(/Edit/)).toBeDefined();
    expect(screen.getByText(/foo\.ts/)).toBeDefined();
  });

  it("appends a live entry delivered via the stream", async () => {
    stub.fetchTranscript = () => Promise.resolve([]);
    let handlers: TranscriptStreamHandlers | null = null;
    stub.openTranscriptStream = (_wk, _id, h) => {
      handlers = h;
      return () => undefined;
    };
    render(<TranscriptPanel wk="wk1" agentId="a1" />);
    await waitFor(() => expect(handlers).not.toBeNull());

    (handlers as TranscriptStreamHandlers | null)?.onEntry(
      ENTRY({ seq: 0, role: "assistant", text: "live message" }),
    );
    await waitFor(() => expect(screen.getByText("live message")).toBeDefined());
  });

  it("fetches the transcript for the given agent id", async () => {
    let calledWith: { wk: string; agentId: string } | null = null;
    stub.fetchTranscript = (wk, agentId) => {
      calledWith = { wk, agentId };
      return Promise.resolve([]);
    };
    render(<TranscriptPanel wk="wkX" agentId="agentY" />);
    await waitFor(() => expect(calledWith).toEqual({ wk: "wkX", agentId: "agentY" }));
  });
});
