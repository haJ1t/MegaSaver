// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceSaverStatus } from "../../src/lib/claude-sessions-client.js";

const stub: {
  fetch: () => Promise<WorkspaceSaverStatus>;
  set: (i: { enabled: boolean; mode: string }) => Promise<WorkspaceSaverStatus>;
} = {
  fetch: () => Promise.reject(new Error("not set")),
  set: () => Promise.reject(new Error("not set")),
};

vi.mock("../../src/lib/claude-sessions-client.js", () => ({
  fetchWorkspaceSaver: () => stub.fetch(),
  setWorkspaceSaver: (_d: string, _i: string, input: { enabled: boolean; mode: string }) =>
    stub.set(input),
}));

import { SaverModeActivation } from "../../src/views/cockpit/saver-mode-activation.js";

const DISABLED: WorkspaceSaverStatus = {
  enabled: false,
  mode: "balanced",
  blockPresent: false,
  mcpInstalled: true,
};

afterEach(() => {
  cleanup();
  stub.fetch = () => Promise.reject(new Error("not set"));
  stub.set = () => Promise.reject(new Error("not set"));
});

describe("SaverModeActivation", () => {
  it("renders the current disabled status", async () => {
    stub.fetch = () => Promise.resolve(DISABLED);
    render(<SaverModeActivation dir="d" id="i" />);
    await waitFor(() => expect(screen.getByLabelText(/Saver Mode/i)).toBeDefined());
    expect((screen.getByLabelText(/Saver Mode/i) as HTMLInputElement).checked).toBe(false);
  });

  it("enabling calls setWorkspaceSaver with the selected mode", async () => {
    stub.fetch = () => Promise.resolve(DISABLED);
    const calls: Array<{ enabled: boolean; mode: string }> = [];
    stub.set = (input) => {
      calls.push(input);
      return Promise.resolve({ ...DISABLED, enabled: true, blockPresent: true });
    };
    render(<SaverModeActivation dir="d" id="i" />);
    await waitFor(() => expect(screen.getByLabelText(/Saver Mode/i)).toBeDefined());
    fireEvent.click(screen.getByLabelText(/Saver Mode/i));
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]).toEqual({ enabled: true, mode: "balanced" });
  });

  it("changing the mode select calls setWorkspaceSaver with the new mode", async () => {
    stub.fetch = () => Promise.resolve(DISABLED);
    const calls: Array<{ enabled: boolean; mode: string }> = [];
    stub.set = (input) => {
      calls.push(input);
      return Promise.resolve({ ...DISABLED, mode: input.mode as WorkspaceSaverStatus["mode"] });
    };
    render(<SaverModeActivation dir="d" id="i" />);
    await waitFor(() => expect(screen.getByLabelText("Compression budget")).toBeDefined());
    fireEvent.change(screen.getByLabelText("Compression budget"), { target: { value: "safe" } });
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]).toEqual({ enabled: false, mode: "safe" });
  });

  it("warns when enabled but MCP is not installed", async () => {
    stub.fetch = () =>
      Promise.resolve({ enabled: true, mode: "balanced", blockPresent: true, mcpInstalled: false });
    render(<SaverModeActivation dir="d" id="i" />);
    await waitFor(() => expect(screen.getByText(/has no effect/i)).toBeDefined());
  });
});
