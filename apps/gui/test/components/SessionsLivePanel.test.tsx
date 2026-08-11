import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionsLivePanel } from "../../src/components/SessionsLivePanel.js";

const mockFetch = vi.fn();

beforeEach(() => {
  // @ts-ignore: global fetch mock
  global.fetch = mockFetch;
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("SessionsLivePanel", () => {
  it("polls and renders live sessions", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        version: 1,
        sessions: [
          {
            liveSessionId: "a1234567",
            agent: "claude",
            cwdShort: "b/c",
            status: "working",
            burn: 123,
            claimWarnings: 0,
          },
        ],
        total: 1,
      }),
    } as Response);

    render(<SessionsLivePanel />);
    expect(await screen.findByText(/Live sessions/)).toBeInTheDocument();
    expect(screen.getByText(/claude/)).toBeInTheDocument();
    expect(screen.getByText(/working/)).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("shows empty when no sessions", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ version: 1, sessions: [], total: 0 }),
    } as Response);
    render(<SessionsLivePanel />);
    expect(await screen.findByText(/no live sessions/)).toBeInTheDocument();
  });
});
