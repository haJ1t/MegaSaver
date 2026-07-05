// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import type { ProxyStatus } from "../../src/lib/claude-sessions-client.js";

const OFF: ProxyStatus = {
  enabled: false,
  routed: false,
  routeConflict: false,
  reconcileBlocked: false,
  url: "http://127.0.0.1:8787",
};
const ON: ProxyStatus = {
  enabled: true,
  routed: true,
  routeConflict: false,
  reconcileBlocked: false,
  url: "http://127.0.0.1:8787",
};

const stub: {
  fetchProxyStatus: () => Promise<ProxyStatus>;
  setProxy: (enabled: boolean) => Promise<ProxyStatus>;
} = {
  fetchProxyStatus: () => Promise.resolve(OFF),
  setProxy: () => Promise.resolve(ON),
};

vi.mock("../../src/lib/claude-sessions-client.js", () => ({
  fetchProxyStatus: () => stub.fetchProxyStatus(),
  setProxy: (enabled: boolean) => stub.setProxy(enabled),
}));

import { ProxyActivation } from "../../src/views/cockpit/proxy-activation.js";

afterEach(() => {
  cleanup();
  stub.fetchProxyStatus = () => Promise.resolve(OFF);
  stub.setProxy = () => Promise.resolve(ON);
});

describe("ProxyActivation", () => {
  it("renders the checkbox unchecked when the server reports enabled:false", async () => {
    render(<ProxyActivation />);
    await waitFor(() => expect(screen.getByText(/Proxy off/)).toBeDefined());
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  });

  it("renders the checkbox checked and live status when the server reports enabled:true", async () => {
    stub.fetchProxyStatus = () => Promise.resolve(ON);
    render(<ProxyActivation />);
    await waitFor(() =>
      expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true),
    );
    expect(screen.getByText(/Proxy on/)).toBeDefined();
    expect(screen.getByText(/live · http:\/\/127\.0\.0\.1:8787/)).toBeDefined();
  });

  it("toggling on calls setProxy(true) and shows live status", async () => {
    let calledWith: boolean | null = null;
    stub.setProxy = (enabled) => {
      calledWith = enabled;
      return Promise.resolve(ON);
    };
    render(<ProxyActivation />);
    await waitFor(() => expect(screen.getByText(/Proxy off/)).toBeDefined());
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(calledWith).toBe(true));
    await waitFor(() => expect(screen.getByText(/live ·/)).toBeDefined());
  });

  it("instructs a manual restart but renders no clickable restart button while running", async () => {
    stub.fetchProxyStatus = () => Promise.resolve(ON);
    render(<ProxyActivation />);
    await waitFor(() => expect(screen.getByRole("status")).toBeDefined());
    expect(screen.getByRole("status").textContent).toMatch(/restart claude/i);
    expect(screen.queryByRole("button", { name: /restart claude/i })).toBeNull();
  });

  it("hides the bypass warning while the proxy is off", async () => {
    render(<ProxyActivation />);
    await waitFor(() => expect(screen.getByText(/Proxy off/)).toBeDefined());
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("notes a route conflict when the server reports routeConflict:true", async () => {
    stub.fetchProxyStatus = () =>
      Promise.resolve({
        enabled: true,
        routed: false,
        routeConflict: true,
        reconcileBlocked: false,
        url: "http://127.0.0.1:8787",
      });
    render(<ProxyActivation />);
    await waitFor(() => expect(screen.getByText(/route conflict/i)).toBeDefined());
  });

  it("notes a reconcile block when the server reports reconcileBlocked:true", async () => {
    stub.fetchProxyStatus = () =>
      Promise.resolve({
        enabled: true,
        routed: false,
        routeConflict: false,
        reconcileBlocked: true,
        url: "http://127.0.0.1:8787",
      });
    render(<ProxyActivation />);
    await waitFor(() => expect(screen.getByText(/reconcile blocked/i)).toBeDefined());
  });

  it("shows the error code/reason when the proxy failed to start", async () => {
    stub.fetchProxyStatus = () =>
      Promise.resolve({
        enabled: false,
        routed: false,
        routeConflict: false,
        reconcileBlocked: false,
        url: "http://127.0.0.1:8787",
        error: "legacy_service_present",
      });
    render(<ProxyActivation />);
    await waitFor(() => expect(screen.getByText(/legacy_service_present/)).toBeDefined());
  });

  it("clarifies the proxy is separate from the context daemon", async () => {
    render(<ProxyActivation />);
    await waitFor(() =>
      expect(screen.getByText(/separate from the context daemon/i)).toBeDefined(),
    );
  });
});
