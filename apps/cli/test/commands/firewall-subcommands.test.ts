import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runFirewallAllow } from "../../src/commands/firewall/allow.js";
import { registryUrl, runFirewallRefresh } from "../../src/commands/firewall/refresh.js";
import { runFirewallStatus } from "../../src/commands/firewall/status.js";
import { appendCachedNames, appendFirewallEvent } from "@megasaver/context-gate";

const roots: string[] = [];
let store: string;
let out: string[];
let err: string[];

beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "megasaver-fw-sub-"));
  roots.push(store);
  out = [];
  err = [];
});
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe("runFirewallAllow", () => {
  it("valid name → exit 0, allowlist written, output line", () => {
    const code = runFirewallAllow({
      storeRoot: store,
      name: "left-padd",
      ecosystem: "npm",
      now: () => 1_700_000_000_000,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
    });
    expect(code).toBe(0);
    expect(out).toEqual(["allowed left-padd (npm)"]);
    const raw = readFileSync(join(store, "firewall", "allowlist.json"), "utf8");
    expect(raw).toContain("left-padd");
  });

  it("grammar-invalid name → exit 1, stderr explains", () => {
    const code = runFirewallAllow({
      storeRoot: store,
      name: "not a name!",
      ecosystem: "npm",
      now: () => 1_700_000_000_000,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
    });
    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.join("\n")).toContain("invalid");
  });
});

describe("runFirewallStatus", () => {
  it("empty store → seed sizes, cache: none, allowlist 0, private-name notice", () => {
    expect(
      runFirewallStatus({ storeRoot: store, now: () => 1_700_000_000_000, stdout: (l) => out.push(l) }),
    ).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("cache: none");
    expect(text).toContain("allowlist: 0 entries");
    expect(text).toContain("refresh sends bare package names to public registries");
  });

  it("after append + allow → counts and refreshedAt shown", () => {
    appendCachedNames(store, "npm", ["preact"], "2026-08-15T10:00:00.000Z");
    runFirewallAllow({
      storeRoot: store,
      name: "left-padd",
      ecosystem: "npm",
      now: () => 1_700_000_000_000,
      stdout: () => {},
      stderr: () => {},
    });
    runFirewallStatus({ storeRoot: store, now: () => 1_700_000_000_000, stdout: (l) => out.push(l) });
    const text = out.join("\n");
    expect(text).toContain("cache: 1 names");
    expect(text).toContain("refreshed 2026-08-15T10:00:00.000Z");
    expect(text).toContain("allowlist: 1 entries");
  });
});

describe("runFirewallRefresh", () => {
  function stubFetch(expected: Map<string, number>): typeof fetch {
    return (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : String(input);
      const status = expected.get(url);
      return new Response("{}", { status: status ?? 500 });
    }) as typeof fetch;
  }

  it("200 → verified + cache append; 404 → likely hallucinated; exact URLs asserted", async () => {
    const expected = new Map<string, number>([
      ["https://registry.npmjs.org/preact", 200],
      ["https://registry.npmjs.org/left-padd", 404],
    ]);
    const code = await runFirewallRefresh({
      storeRoot: store,
      names: ["left-padd", "preact"],
      ecosystem: "npm",
      fetchImpl: stubFetch(expected),
      now: () => 1_700_000_000_000,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
    });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("left-padd NOT FOUND — likely hallucinated");
    expect(out.join("\n")).toContain("preact verified");
    const raw = readFileSync(join(store, "firewall", "registry-cache", "npm.json"), "utf8");
    expect(raw).toContain("preact");
    expect(raw).not.toContain("left-padd");
  });

  it("grammar-invalid name → exit 1, never fetched (architect M5)", async () => {
    let fetchCount = 0;
    const code = await runFirewallRefresh({
      storeRoot: store,
      names: ["not a name!"],
      ecosystem: "npm",
      fetchImpl: (async () => {
        fetchCount += 1;
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
      now: () => 1_700_000_000_000,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
    });
    expect(code).toBe(1);
    expect(fetchCount).toBe(0);
  });

  it("network error → per-name unverified, exit 0", async () => {
    const code = await runFirewallRefresh({
      storeRoot: store,
      names: ["preact"],
      ecosystem: "npm",
      fetchImpl: (async () => {
        throw new Error("down");
      }) as typeof fetch,
      now: () => 1_700_000_000_000,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
    });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("unverified (network error)");
  });

  it("no names and no ledger unknowns → friendly no-op, exit 0", async () => {
    const code = await runFirewallRefresh({
      storeRoot: store,
      names: [],
      ecosystem: undefined,
      fetchImpl: stubFetch(new Map()),
      now: () => 1_700_000_000_000,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
    });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("nothing to refresh");
  });

  it("ledger unknowns become the refresh set; allowlisted names skipped", async () => {
    appendFirewallEvent(store, {
      at: new Date(Date.now() - 3_600_000).toISOString(),
      kind: "unknown-package",
      detector: "package-firewall",
      count: 1,
      packageName: "left-padd",
      ecosystem: "npm",
    });
    runFirewallAllow({
      storeRoot: store,
      name: "preact",
      ecosystem: "npm",
      now: () => 1_700_000_000_000,
      stdout: () => {},
      stderr: () => {},
    });
    appendFirewallEvent(store, {
      at: new Date(Date.now() - 3_600_000).toISOString(),
      kind: "unknown-package",
      detector: "package-firewall",
      count: 1,
      packageName: "preact",
      ecosystem: "npm",
    });
    const expected = new Map<string, number>([["https://registry.npmjs.org/left-padd", 200]]);
    const code = await runFirewallRefresh({
      storeRoot: store,
      names: [],
      ecosystem: undefined,
      fetchImpl: stubFetch(expected),
      now: () => 1_700_000_000_000,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
    });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("left-padd verified");
    expect(out.join("\n")).toContain("skipped (allowlisted): preact");
  });

  it("registryUrl builds the pinned endpoints", () => {
    expect(registryUrl({ name: "@scope/pkg", ecosystem: "npm" })).toBe(
      "https://registry.npmjs.org/%40scope%2Fpkg",
    );
    expect(registryUrl({ name: "requests", ecosystem: "pypi" })).toBe(
      "https://pypi.org/pypi/requests/json",
    );
  });
});
