// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TranscriptEntry, TranscriptStreamHandlers } from "../../../src/lib/office-client.js";

const stub: {
  fetchTranscript: (wk: string, agentId: string) => Promise<TranscriptEntry[]>;
  openTranscriptStream: (wk: string, agentId: string, h: TranscriptStreamHandlers) => () => void;
  sendChat: (wk: string, agentId: string, message: string) => Promise<unknown>;
} = {
  fetchTranscript: () => Promise.resolve([]),
  openTranscriptStream: () => () => undefined,
  sendChat: () => Promise.resolve({ id: "t1", status: "queued" }),
};

vi.mock("../../../src/lib/office-client.js", () => ({
  fetchTranscript: (wk: string, agentId: string) => stub.fetchTranscript(wk, agentId),
  openTranscriptStream: (wk: string, agentId: string, h: TranscriptStreamHandlers) =>
    stub.openTranscriptStream(wk, agentId, h),
  sendChat: (wk: string, agentId: string, message: string) => stub.sendChat(wk, agentId, message),
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
  stub.sendChat = () => Promise.resolve({ id: "t1", status: "queued" });
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

  it("sends a chat message and clears the input", async () => {
    let sent: { wk: string; agentId: string; message: string } | null = null;
    stub.sendChat = (wk, agentId, message) => {
      sent = { wk, agentId, message };
      return Promise.resolve({ id: "t1", status: "queued" });
    };
    render(<TranscriptPanel wk="wk1" agentId="a1" />);
    const input = (await screen.findByLabelText(/Message agent/)) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "review the auth module" } });
    fireEvent.click(screen.getByRole("button", { name: /^Send$/ }));
    await waitFor(() =>
      expect(sent).toEqual({ wk: "wk1", agentId: "a1", message: "review the auth module" }),
    );
    await waitFor(() => expect(input.value).toBe(""));
  });

  it("renders a user turn distinctly", async () => {
    stub.fetchTranscript = () =>
      Promise.resolve([ENTRY({ seq: 0, role: "user", text: "hello agent" })]);
    render(<TranscriptPanel wk="wk1" agentId="a1" />);
    await waitFor(() => expect(screen.getByText("hello agent")).toBeDefined());
    expect(screen.getByText(/^You$/)).toBeDefined();
  });
});
