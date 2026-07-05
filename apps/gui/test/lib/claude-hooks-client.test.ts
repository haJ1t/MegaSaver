import { afterEach, describe, expect, it, vi } from "vitest";
import {
  connectClaudeHook,
  disconnectClaudeHook,
  fetchClaudeHookStatus,
} from "../../src/lib/claude-sessions-client.js";

afterEach(() => vi.restoreAllMocks());

function mockFetch(body: unknown, ok = true): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, json: async () => body, status: ok ? 200 : 500 })),
  );
}

describe("claude hook client", () => {
  it("fetchClaudeHookStatus GETs the global route", async () => {
    mockFetch({ connected: true, preInstalled: true, postInstalled: true });
    const status = await fetchClaudeHookStatus();
    expect(status.connected).toBe(true);
    expect(fetch).toHaveBeenCalledWith("/api/hooks/claude-code", { headers: {} });
  });

  it("connectClaudeHook POSTs", async () => {
    mockFetch({ connected: true, preInstalled: true, postInstalled: true });
    await connectClaudeHook();
    expect(fetch).toHaveBeenCalledWith(
      "/api/hooks/claude-code",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("disconnectClaudeHook DELETEs", async () => {
    mockFetch({ connected: false, preInstalled: false, postInstalled: false });
    await disconnectClaudeHook();
    expect(fetch).toHaveBeenCalledWith(
      "/api/hooks/claude-code",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
