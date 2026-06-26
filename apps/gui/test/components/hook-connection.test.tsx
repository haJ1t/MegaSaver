import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HookConnection } from "../../src/views/cockpit/hook-connection.js";

const fetchStatus = vi.fn();
const connect = vi.fn();
const disconnect = vi.fn();
vi.mock("../../src/lib/claude-sessions-client.js", () => ({
  fetchClaudeHookStatus: () => fetchStatus(),
  connectClaudeHook: () => connect(),
  disconnectClaudeHook: () => disconnect(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const OFF = { connected: false, preInstalled: false, postInstalled: false };
const ON = { connected: true, preInstalled: true, postInstalled: true };

describe("HookConnection", () => {
  it("renders disconnected then connects on check", async () => {
    fetchStatus.mockResolvedValue(OFF);
    connect.mockResolvedValue(ON);
    render(<HookConnection />);
    const box = await screen.findByRole("checkbox");
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    await waitFor(() => expect(connect).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("checkbox")).toBeChecked());
  });

  it("confirms before disconnect; cancel does nothing", async () => {
    fetchStatus.mockResolvedValue(ON);
    vi.stubGlobal(
      "confirm",
      vi.fn(() => false),
    );
    render(<HookConnection />);
    const box = await screen.findByRole("checkbox");
    expect(box).toBeChecked();
    fireEvent.click(box);
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("disconnects when confirmed", async () => {
    fetchStatus.mockResolvedValue(ON);
    disconnect.mockResolvedValue(OFF);
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    render(<HookConnection />);
    const box = await screen.findByRole("checkbox");
    fireEvent.click(box);
    await waitFor(() => expect(disconnect).toHaveBeenCalledTimes(1));
  });

  it("renders an action error when connect fails", async () => {
    fetchStatus.mockResolvedValue(OFF);
    connect.mockRejectedValue({ error: "boom", code: "internal_error" });
    render(<HookConnection />);
    const box = await screen.findByRole("checkbox");
    fireEvent.click(box);
    expect(await screen.findByText(/could not update the hook/i)).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });
});
