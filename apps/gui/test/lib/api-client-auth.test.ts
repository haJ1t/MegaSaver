import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteJson, getJson, postJson } from "../../src/lib/api-client.js";

const KEY = "megasaver.gui.token";

function stubFetch(): ReturnType<typeof vi.fn> {
  const f = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", f);
  return f;
}

function headerOf(f: ReturnType<typeof vi.fn>, call = 0): Record<string, string> {
  const init = f.mock.calls[call]?.[1] as RequestInit | undefined;
  return (init?.headers ?? {}) as Record<string, string>;
}

describe("api-client attaches the bridge token", () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem(KEY, "TKN");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it("getJson sends the Authorization header", async () => {
    const f = stubFetch();
    await getJson("/api/health");
    expect(headerOf(f)["Authorization"]).toBe("Bearer TKN");
  });

  it("postJson keeps content-type AND adds Authorization", async () => {
    const f = stubFetch();
    await postJson("/api/mcp/install", { target: "x", project: "p" });
    const h = headerOf(f);
    expect(h["Authorization"]).toBe("Bearer TKN");
    expect(h["content-type"]).toBe("application/json");
  });

  it("deleteJson sends the Authorization header", async () => {
    const f = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", f);
    await deleteJson("/api/office/w/roles/r");
    expect(headerOf(f)["Authorization"]).toBe("Bearer TKN");
  });

  it("omits Authorization when no token is stored", async () => {
    sessionStorage.clear();
    const f = stubFetch();
    await getJson("/api/health");
    expect(headerOf(f)["Authorization"]).toBeUndefined();
  });
});
