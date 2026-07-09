import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendFirewallEvent,
  appendFirewallEventsFromFilter,
  firewallEventSchema,
  firewallLogPath,
} from "../src/firewall-ledger.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-fw-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const AT = "2026-07-08T12:00:00.000Z";

describe("firewall ledger", () => {
  it("appends schema-valid JSONL and creates the directory on first write", () => {
    appendFirewallEvent(root, {
      at: AT,
      kind: "blocked-read",
      detector: "secret-path",
      count: 1,
      sourcePath: "/repo/.env",
    });
    appendFirewallEvent(root, { at: AT, kind: "redacted", detector: "credit_card", count: 2 });
    const lines = readFileSync(firewallLogPath(root), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(firewallEventSchema.safeParse(JSON.parse(line)).success).toBe(true);
    }
  });

  it("swallows write failures (F-FW-3: auditing never breaks the pipeline)", () => {
    // Pre-create <root>/firewall as a FILE so mkdirSync(<root>/firewall) throws
    // ENOTDIR — a genuine, deterministic write failure that must be swallowed.
    writeFileSync(join(root, "firewall"), "x");
    expect(() =>
      appendFirewallEvent(root, { at: AT, kind: "redacted", detector: "iban", count: 1 }),
    ).not.toThrow();
    // The log was never written (its dir could not be created).
    expect(existsSync(firewallLogPath(root))).toBe(false);
  });

  it("maps filter firewall counts to one event per detector", () => {
    appendFirewallEventsFromFilter(
      root,
      { at: AT, sourcePath: "/repo/data.md", projectId: "p1", sessionId: "s1" },
      {
        findings: [
          { name: "credit_card", count: 2 },
          { name: "github_token", count: 1 },
        ],
        observed: [{ name: "email", count: 3 }],
      },
    );
    const lines = readFileSync(firewallLogPath(root), "utf8").trim().split("\n");
    const events = lines.map((l) => firewallEventSchema.parse(JSON.parse(l)));
    expect(events).toHaveLength(3);
    expect(events.filter((e) => e.kind === "redacted")).toHaveLength(2);
    expect(events.filter((e) => e.kind === "observed")).toEqual([
      expect.objectContaining({ detector: "email", count: 3, projectId: "p1", sessionId: "s1" }),
    ]);
  });

  it("is a no-op when the filter result carried no firewall field", () => {
    appendFirewallEventsFromFilter(root, { at: AT }, undefined);
    expect(existsSync(firewallLogPath(root))).toBe(false);
  });

  it("F-FW-1: the ledger never contains matched values", () => {
    // Even a hostile caller cannot put values in: the schema has no value
    // field and .strict() rejects extras.
    const parsed = firewallEventSchema.safeParse({
      at: AT,
      kind: "redacted",
      detector: "credit_card",
      count: 1,
      value: "4111111111111111",
    });
    expect(parsed.success).toBe(false);
  });
});
