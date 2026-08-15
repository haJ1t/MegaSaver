import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  REGISTRY_CACHE_MAX_NAMES,
  appendAllowlistEntry,
  appendCachedNames,
  isAllowlisted,
  readAllowlist,
  readKnownNames,
  readRegistryCache,
  registryCachePath,
} from "../src/package-registry-cache.js";

const roots: string[] = [];
function createStore(): string {
  const root = mkdtempSync(join(tmpdir(), "megasaver-pkg-cache-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe("readKnownNames / readRegistryCache", () => {
  it("includes seed members with no cache file present", () => {
    const store = createStore();
    expect(readKnownNames(store, "npm").has("react")).toBe(true);
    expect(readKnownNames(store, "npm").has("lodash")).toBe(true);
    expect(readKnownNames(store, "npm").has("left-pad")).toBe(true);
    expect(readKnownNames(store, "pypi").has("requests")).toBe(true);
    expect(readKnownNames(store, "pypi").has("numpy")).toBe(true);
  });

  it("appendCachedNames creates the cache file, dedupes, sets refreshedAt, round-trips", () => {
    const store = createStore();
    const res = appendCachedNames(store, "npm", ["react", "neato-pkg"], "2026-08-15T10:00:00.000Z");
    expect(res).toEqual({ added: 1, total: 1, capped: false, locked: true });
    expect(readRegistryCache(store, "npm")).toEqual({
      refreshedAt: "2026-08-15T10:00:00.000Z",
      names: ["neato-pkg"],
    });
    const again = appendCachedNames(
      store,
      "npm",
      ["neato-pkg", "preact"],
      "2026-08-15T11:00:00.000Z",
    );
    expect(again).toEqual({ added: 1, total: 2, capped: false, locked: true });
    expect(readKnownNames(store, "npm").has("preact")).toBe(true);
  });

  it("append past REGISTRY_CACHE_MAX_NAMES reports capped and does not grow", () => {
    const store = createStore();
    const many = Array.from({ length: REGISTRY_CACHE_MAX_NAMES + 50 }, (_, i) => `pkg-${i}`);
    const res = appendCachedNames(store, "npm", many, "2026-08-15T10:00:00.000Z");
    expect(res.capped).toBe(true);
    expect(res.total).toBe(REGISTRY_CACHE_MAX_NAMES);
    expect(readRegistryCache(store, "npm").names).toHaveLength(REGISTRY_CACHE_MAX_NAMES);
  });

  it("corrupt cache JSON fails open to the seeds", () => {
    const store = createStore();
    mkdirSync(join(store, "firewall", "registry-cache"), { recursive: true });
    writeFileSync(join(registryCachePath(store, "npm")), "{not json");
    expect(readRegistryCache(store, "npm")).toEqual({ refreshedAt: null, names: [] });
    expect(readKnownNames(store, "npm").has("react")).toBe(true);
  });
});

describe("allowlist", () => {
  it("appendAllowlistEntry + isAllowlisted round-trip; grammar-invalid names rejected", () => {
    const store = createStore();
    expect(
      appendAllowlistEntry(store, { name: "left-padd", ecosystem: "npm", addedAt: "now" }),
    ).toBe(true);
    expect(isAllowlisted(store, { name: "left-padd", ecosystem: "npm" })).toBe(true);
    expect(isAllowlisted(store, { name: "left-padd", ecosystem: "pypi" })).toBe(false);
    expect(
      appendAllowlistEntry(store, { name: "not a name!", ecosystem: "npm", addedAt: "now" }),
    ).toBe(false);
    expect(readAllowlist(store)).toHaveLength(1);
  });
});
