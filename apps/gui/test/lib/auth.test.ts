import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authHeaders, readAndStoreToken, withToken } from "../../src/lib/auth.js";

const KEY = "megasaver.gui.token";

type FakeLocation = { search: string; pathname: string };

function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

describe("readAndStoreToken", () => {
  let storage: Storage;
  beforeEach(() => {
    storage = makeStorage();
  });

  it("reads ?token= once, stores it, and strips it from the URL", () => {
    const loc: FakeLocation = { search: "?token=ABC", pathname: "/" };
    const replaceState = vi.fn();
    const token = readAndStoreToken(loc, storage, replaceState);
    expect(token).toBe("ABC");
    expect(storage.getItem(KEY)).toBe("ABC");
    expect(replaceState).toHaveBeenCalledTimes(1);
    // The URL passed to replaceState must not carry the token any more.
    const strippedUrl = replaceState.mock.calls[0]?.[2] as string;
    expect(strippedUrl).not.toContain("token=");
  });

  it("preserves other query params while stripping only token", () => {
    const loc: FakeLocation = { search: "?token=ABC&view=chart", pathname: "/app" };
    const replaceState = vi.fn();
    readAndStoreToken(loc, storage, replaceState);
    const strippedUrl = replaceState.mock.calls[0]?.[2] as string;
    expect(strippedUrl).not.toContain("token=");
    expect(strippedUrl).toContain("view=chart");
  });

  it("falls back to storage when no ?token= is present", () => {
    storage.setItem(KEY, "STORED");
    const loc: FakeLocation = { search: "", pathname: "/" };
    const replaceState = vi.fn();
    const token = readAndStoreToken(loc, storage, replaceState);
    expect(token).toBe("STORED");
    // Nothing to strip when the URL had no token.
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("returns undefined when neither URL nor storage has a token", () => {
    const loc: FakeLocation = { search: "", pathname: "/" };
    const token = readAndStoreToken(loc, storage, vi.fn());
    expect(token).toBeUndefined();
  });
});

describe("authHeaders / withToken (backed by sessionStorage)", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });
  afterEach(() => {
    sessionStorage.clear();
  });

  it("authHeaders returns a Bearer header when a token is stored", () => {
    sessionStorage.setItem(KEY, "TKN");
    expect(authHeaders()).toEqual({ Authorization: "Bearer TKN" });
  });

  it("authHeaders returns an empty object when no token is stored", () => {
    expect(authHeaders()).toEqual({});
  });

  it("withToken appends ?token= to a query-less url", () => {
    sessionStorage.setItem(KEY, "TKN");
    expect(withToken("/api/office/w/stream")).toBe("/api/office/w/stream?token=TKN");
  });

  it("withToken appends &token= when the url already has a query", () => {
    sessionStorage.setItem(KEY, "TKN");
    expect(withToken("/api/x?a=1")).toBe("/api/x?a=1&token=TKN");
  });

  it("withToken returns the url unchanged when no token is stored", () => {
    expect(withToken("/api/x")).toBe("/api/x");
  });
});
