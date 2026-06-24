// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import type { ProxyStatus } from "../../src/lib/claude-sessions-client.js";

const stub: {
  fetchProxyStatus: () => Promise<ProxyStatus>;
  setProxy: (enabled: boolean) => Promise<ProxyStatus>;
} = {
  fetchProxyStatus: () => Promise.resolve({ running: false }),
  setProxy: () => Promise.resolve({ running: true, url: "http://127.0.0.1:8787", port: 8787 }),
};

vi.mock("../../src/lib/claude-sessions-client.js", () => ({
  fetchProxyStatus: () => stub.fetchProxyStatus(),
  setProxy: (enabled: boolean) => stub.setProxy(enabled),
}));

import { ProxyActivation } from "../../src/views/cockpit/proxy-activation.js";

afterEach(() => {
  cleanup();
  stub.fetchProxyStatus = () => Promise.resolve({ running: false });
  stub.setProxy = () =>
    Promise.resolve({ running: true, url: "http://127.0.0.1:8787", port: 8787 });
});

describe("ProxyActivation", () => {
  it("toggling on calls setProxy(true) and shows live status", async () => {
    let calledWith: boolean | null = null;
    stub.setProxy = (enabled) => {
      calledWith = enabled;
      return Promise.resolve({ running: true, url: "http://127.0.0.1:8787", port: 8787 });
    };
    render(<ProxyActivation />);
    await waitFor(() => expect(screen.getByText(/Proxy off/)).toBeDefined());
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(calledWith).toBe(true));
    await waitFor(() => expect(screen.getByText(/live ·/)).toBeDefined());
  });

  it("shows the error code/reason when the proxy failed to start", async () => {
    stub.fetchProxyStatus = () =>
      Promise.resolve({
        running: false,
        error: "listen EADDRINUSE: address already in use :::8787",
      });
    render(<ProxyActivation />);
    await waitFor(() => expect(screen.getByText(/EADDRINUSE/)).toBeDefined());
  });
});
