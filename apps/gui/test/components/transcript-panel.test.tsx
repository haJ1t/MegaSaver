// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ClaudeTranscriptSnapshot,
  NormalizedMessage,
  StreamHandlers,
} from "../../src/lib/claude-sessions-client.js";

const captured: { handlers: StreamHandlers | null } = { handlers: null };

vi.mock("../../src/lib/claude-sessions-client.js", () => ({
  openClaudeSessionStream: (_dir: string, _id: string, handlers: StreamHandlers) => {
    captured.handlers = handlers;
    return () => {};
  },
}));

import { TranscriptPanel } from "../../src/cockpit/panels/transcript-panel.js";

function msg(text: string): NormalizedMessage {
  return { role: "assistant", ts: `${text}-ts`, blocks: [{ kind: "text", text }] };
}

afterEach(() => {
  cleanup();
  captured.handlers = null;
});

describe("TranscriptPanel sticky+thinking", () => {
  it("renders thinking blocks as collapsed amber details with Thinking badge", async () => {
    render(<TranscriptPanel dir="d" id="i" cwd="/tmp/w" />);
    const snapshot: ClaudeTranscriptSnapshot = {
      projectLabel: "/tmp/w",
      messages: [
        {
          role: "assistant",
          ts: "t1",
          blocks: [{ kind: "thinking" as const, text: "hmm internal reasoning" }],
        },
      ],
    };
    captured.handlers?.onSnapshot(snapshot);
    await waitFor(() => expect(screen.getByText("Thinking")).toBeDefined());
    const details = document.querySelector("details");
    expect(details).not.toBeNull();
    // collapsed by default (no open attr)
    expect(details?.hasAttribute("open")).toBe(false);
    expect(details?.className).toMatch(/border-l-4/);
  });

  it("keeps scroll container as overflow-y-auto section", async () => {
    const { container } = render(<TranscriptPanel dir="d" id="i" cwd="/tmp/w" />);
    const section = container.querySelector("section");
    expect(section?.className).toMatch(/overflow-y-auto/);
    expect(section?.className).toMatch(/flex-1/);
  });
});

describe("TranscriptPanel", () => {
  it("renders snapshot messages then an appended tailed message", async () => {
    render(<TranscriptPanel dir="d" id="i" cwd="/tmp/w" />);
    const snapshot: ClaudeTranscriptSnapshot = {
      projectLabel: "/tmp/w",
      messages: [msg("hello")],
    };
    captured.handlers?.onSnapshot(snapshot);
    await waitFor(() => expect(screen.getByText("hello")).toBeDefined());

    captured.handlers?.onMessage(msg("world"));
    await waitFor(() => expect(screen.getByText("world")).toBeDefined());
    expect(screen.getByText("hello")).toBeDefined();
  });

  it("shows the stream-interrupted notice when onError fires", async () => {
    render(<TranscriptPanel dir="d" id="i" cwd="/tmp/w" />);
    captured.handlers?.onError();
    await waitFor(() => expect(screen.getByText(/Live stream unavailable/)).toBeDefined());
  });
});
