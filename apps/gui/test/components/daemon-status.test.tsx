// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import type { DaemonStatus } from "../../src/lib/claude-sessions-client.js";

const stub: { fetchDaemonStatus: () => Promise<DaemonStatus> } = {
  fetchDaemonStatus: () => Promise.resolve({ running: false }),
};

vi.mock("../../src/lib/claude-sessions-client.js", () => ({
  fetchDaemonStatus: () => stub.fetchDaemonStatus(),
}));

import { DaemonStatusPanel } from "../../src/views/cockpit/daemon-status.js";

afterEach(() => {
  cleanup();
  stub.fetchDaemonStatus = () => Promise.resolve({ running: false });
});

describe("DaemonStatusPanel", () => {
  it("shows 'not running' with data-status=stopped when daemon is down", async () => {
    render(<DaemonStatusPanel />);
    await waitFor(() => expect(screen.getByText(/not running/)).toBeDefined());
    const dot = document.querySelector("[data-status]");
    expect(dot?.getAttribute("data-status")).toBe("stopped");
  });

  it("shows 'live · <url>' with data-status=live and session count when daemon is up", async () => {
    const url = "http://127.0.0.1:61234";
    stub.fetchDaemonStatus = () => Promise.resolve({ running: true, url, sessions: 2 });
    render(<DaemonStatusPanel />);
    await waitFor(() => expect(screen.getByText(new RegExp(`live · ${url}`))).toBeDefined());
    const dot = document.querySelector("[data-status]");
    expect(dot?.getAttribute("data-status")).toBe("live");
    expect(screen.getByText(/2 sessions/)).toBeDefined();
  });
});
