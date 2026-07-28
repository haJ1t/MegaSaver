import { describe, expect, it, vi } from "vitest";
import {
  applyTheme,
  nextTheme,
  readStoredTheme,
  resolveTheme,
  storeTheme,
} from "../../src/lib/theme.js";

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    dump: () => Object.fromEntries(map),
  };
}

describe("readStoredTheme", () => {
  it("defaults to system when nothing is stored", () => {
    expect(readStoredTheme(fakeStorage())).toBe("system");
  });
  it("reads a stored explicit choice", () => {
    expect(readStoredTheme(fakeStorage({ "megasaver.theme": "dark" }))).toBe("dark");
  });
  it("falls back to system on a junk value", () => {
    expect(readStoredTheme(fakeStorage({ "megasaver.theme": "neon" }))).toBe("system");
  });
});

describe("resolveTheme", () => {
  it("follows the OS when the choice is system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
  it("an explicit choice wins over the OS preference", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("applyTheme", () => {
  it("removes the attribute for system so the media query takes over", () => {
    const root = { setAttribute: vi.fn(), removeAttribute: vi.fn() };
    applyTheme(root, "system");
    expect(root.removeAttribute).toHaveBeenCalledWith("data-theme");
    expect(root.setAttribute).not.toHaveBeenCalled();
  });
  it("pins the attribute for an explicit choice", () => {
    const root = { setAttribute: vi.fn(), removeAttribute: vi.fn() };
    applyTheme(root, "light");
    expect(root.setAttribute).toHaveBeenCalledWith("data-theme", "light");
  });
});

describe("nextTheme", () => {
  it("flips away from whatever is currently rendered", () => {
    expect(nextTheme("system", true)).toBe("light");
    expect(nextTheme("system", false)).toBe("dark");
    expect(nextTheme("dark", false)).toBe("light");
    expect(nextTheme("light", true)).toBe("dark");
  });
});

describe("storeTheme", () => {
  it("clears storage for system and writes for explicit", () => {
    const s = fakeStorage({ "megasaver.theme": "dark" });
    storeTheme(s, "system");
    expect(s.dump()).toEqual({});
    storeTheme(s, "light");
    expect(s.dump()).toEqual({ "megasaver.theme": "light" });
  });
});
