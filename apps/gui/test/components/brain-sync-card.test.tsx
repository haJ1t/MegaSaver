import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrainSyncCard } from "../../src/components/brain-sync-card.js";
import * as client from "../../src/lib/claude-sessions-client.js";

describe("BrainSyncCard", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders not_configured state and 1-click activation button when unconfigured", async () => {
    vi.spyOn(client, "fetchBrainSyncStatus").mockResolvedValue({
      configured: false,
      status: "not_configured",
      lastSyncedAt: null,
    });

    render(<BrainSyncCard dir="-Users-me-proj" id="sess1" />);

    await waitFor(() => {
      expect(screen.getByText("Not Activated")).toBeTruthy();
      expect(
        screen.getByRole("button", { name: /Activate Living Brain \(1-Click\)/i }),
      ).toBeTruthy();
    });
  });

  it("activates living brain on 1-click activation button click", async () => {
    const fetchSpy = vi
      .spyOn(client, "fetchBrainSyncStatus")
      .mockResolvedValueOnce({
        configured: false,
        status: "not_configured",
        lastSyncedAt: null,
      })
      .mockResolvedValueOnce({
        configured: true,
        status: "ok",
        lastSyncedAt: null,
        generation: 1,
        upToDate: true,
      } as client.BrainSyncStatusResponse);

    const autoInitSpy = vi.spyOn(client, "autoInitBrainSync").mockResolvedValue({
      ok: true,
      status: "ok",
      configured: true,
      generation: 1,
      recoveryCode: "ABCDE-12345-67890",
      workspaceKey: "key1",
      cwd: "/Users/me/proj",
    });

    render(<BrainSyncCard dir="-Users-me-proj" id="sess1" />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Activate Living Brain \(1-Click\)/i }),
      ).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /Activate Living Brain \(1-Click\)/i }));

    await waitFor(() => {
      expect(autoInitSpy).toHaveBeenCalledWith("-Users-me-proj", "sess1");
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(screen.getByText(/Recovery Code: ABCDE-12345-67890/)).toBeTruthy();
      expect(screen.getByText("Active")).toBeTruthy();
    });
  });

  it("renders generation and up-to-date badge when configured", async () => {
    vi.spyOn(client, "fetchBrainSyncStatus").mockResolvedValue({
      configured: true,
      status: "ok",
      lastSyncedAt: "2026-08-31T20:00:00.000Z",
      generation: 3,
      upToDate: true,
      remoteGeneration: 3,
      updatedAt: "2026-08-31T20:00:00.000Z",
    } as client.BrainSyncStatusResponse);

    render(<BrainSyncCard dir="-Users-me-proj" id="sess1" />);

    await waitFor(() => {
      expect(screen.getByText("Active")).toBeTruthy();
      expect(screen.getByText(/gen 3 · up to date/)).toBeTruthy();
    });
  });

  it("triggers push and refreshes status on Push click", async () => {
    const fetchSpy = vi
      .spyOn(client, "fetchBrainSyncStatus")
      .mockResolvedValueOnce({
        configured: true,
        status: "ok",
        lastSyncedAt: null,
        generation: 1,
        upToDate: false,
      } as client.BrainSyncStatusResponse)
      .mockResolvedValueOnce({
        configured: true,
        status: "ok",
        lastSyncedAt: "2026-08-31T20:05:00.000Z",
        generation: 2,
        upToDate: true,
      } as client.BrainSyncStatusResponse);

    const triggerSpy = vi.spyOn(client, "triggerBrainSync").mockResolvedValue({
      status: "pushed",
      syncedAt: "2026-08-31T20:05:00.000Z",
      generation: 2,
      merged: false,
      workspaceKey: "key1",
      cwd: "/Users/me/proj",
    });

    render(<BrainSyncCard dir="-Users-me-proj" id="sess1" />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /push/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /push/i }));

    await waitFor(() => {
      expect(triggerSpy).toHaveBeenCalledWith("-Users-me-proj", "sess1", "push");
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  it("surfaces error message when sync fails", async () => {
    vi.spyOn(client, "fetchBrainSyncStatus").mockResolvedValue({
      configured: true,
      status: "ok",
      lastSyncedAt: null,
      generation: 1,
      upToDate: true,
    } as client.BrainSyncStatusResponse);

    vi.spyOn(client, "triggerBrainSync").mockRejectedValue({
      code: "transport_error",
      error: "S3 connection failed",
    });

    render(<BrainSyncCard dir="-Users-me-proj" id="sess1" />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /push/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /push/i }));

    await waitFor(() => {
      expect(screen.getByText(/transport_error: S3 connection failed/)).toBeTruthy();
    });
  });
});
