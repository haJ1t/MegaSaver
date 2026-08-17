import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJsonDirectoryCoreRegistry, initStore } from "@megasaver/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectSavingsReceipts,
  collectSessionMeta,
  parseSince,
  toSpendReceipts,
} from "../../src/commands/cost/collect.js";

// Real layout keys (stats wiki rule): overlay dirs are 16-hex workspaceKeys,
// registry dirs are project UUIDs. Fixture keys must be real-shaped.
const WORKSPACE = "00000000000000aa";
const PROJECT = "11111111-1111-4111-8111-111111111111";
const OVERLAY_SESSION = "1af7f8f0-2b3c-4d5e-8f60-718293a4b5c6";
const REGISTRY_SESSION = "22222222-2222-4222-8222-222222222222";
const TS = "2026-08-06T10:00:00.000Z";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-cli-cost-collect-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeEvents(dir: string, file: string, lines: readonly unknown[]): void {
  mkdirSync(join(root, "stats", dir), { recursive: true });
  writeFileSync(
    join(root, "stats", dir, file),
    `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`,
  );
}

describe("collectSavingsReceipts", () => {
  it("collects overlay and registry rows with project/session attribution", () => {
    writeEvents(WORKSPACE, `${OVERLAY_SESSION}.events.jsonl`, [
      { createdAt: TS, deltaTokens: 120, rawTokens: 150, returnedTokens: 30 },
    ]);
    writeEvents(PROJECT, `${REGISTRY_SESSION}.events.jsonl`, [{ createdAt: TS }]);
    const receipts = collectSavingsReceipts(root);
    expect(receipts).toHaveLength(2);
    const overlay = receipts.find((r) => r.project === WORKSPACE);
    expect(overlay?.session).toBe(OVERLAY_SESSION);
    expect(overlay?.deltaTokens).toBe(120);
    const registry = receipts.find((r) => r.project === PROJECT);
    expect(registry?.session).toBe(REGISTRY_SESSION);
    expect(registry?.deltaTokens).toBeUndefined();
  });

  it("skips non-layout dirs, decoy files, and non-session sibling ledgers", () => {
    writeEvents("task-kickoff-sessions", "x.events.jsonl", [{ createdAt: TS, deltaTokens: 5 }]);
    writeEvents(PROJECT, "guard.events.jsonl", [{ createdAt: TS, deltaTokens: 7 }]);
    writeFileSync(join(root, "stats", "budget.json"), "{}");
    expect(collectSavingsReceipts(root)).toEqual([]);
  });

  it("skips torn lines and returns [] for a missing store", () => {
    mkdirSync(join(root, "stats", WORKSPACE), { recursive: true });
    writeFileSync(
      join(root, "stats", WORKSPACE, `${OVERLAY_SESSION}.events.jsonl`),
      '{"createdAt":',
    );
    expect(collectSavingsReceipts(root)).toEqual([]);
    expect(collectSavingsReceipts(join(root, "does-not-exist"))).toEqual([]);
  });
});

describe("collectSessionMeta", () => {
  it("maps registry sessions to agentId; mesh adds task, registry agent wins", async () => {
    await initStore(root);
    const registry = createJsonDirectoryCoreRegistry({ rootDir: root });
    registry.createProject({
      id: PROJECT as never,
      name: "fixture",
      rootPath: root,
      createdAt: TS,
      updatedAt: TS,
    });
    registry.createSession({
      id: REGISTRY_SESSION as never,
      projectId: PROJECT as never,
      agentId: "claude-code",
      riskLevel: "medium",
      title: null,
      startedAt: TS,
      endedAt: null,
    });
    mkdirSync(join(root, "mesh", "presence"), { recursive: true });
    // Authoritative PresenceRecord shape (session-mesh plan, locked). This
    // fixture deliberately makes the live session id equal the registry
    // session id — the only case where a registry row gains a task label.
    writeFileSync(
      join(root, "mesh", "presence", `${REGISTRY_SESSION}.json`),
      JSON.stringify({
        liveSessionId: REGISTRY_SESSION,
        workspaceKey: WORKSPACE,
        agent: "codex",
        cwd: root,
        taskLabel: "cost ledger",
        status: "working",
        registeredAt: TS,
        lastSeenAt: TS,
      }),
    );
    // A live-only presence record (no registry session) keys by liveSessionId.
    writeFileSync(
      join(root, "mesh", "presence", `${OVERLAY_SESSION}.json`),
      JSON.stringify({
        liveSessionId: OVERLAY_SESSION,
        workspaceKey: WORKSPACE,
        agent: "codex",
        cwd: root,
        taskLabel: "warm start",
        status: "idle",
        registeredAt: TS,
        lastSeenAt: TS,
      }),
    );
    const meta = collectSessionMeta(root);
    expect(meta.get(REGISTRY_SESSION)).toEqual({ agent: "claude-code", task: "cost ledger" });
    expect(meta.get(OVERLAY_SESSION)).toEqual({ agent: "codex", task: "warm start" });
  });

  it("degrades to an empty map on an uninitialized store (no mesh, no registry)", () => {
    expect(collectSessionMeta(root).size).toBe(0);
  });
});

describe("toSpendReceipts / parseSince", () => {
  it("carries the four counters and only stamps workspaceKey when present", () => {
    const receipts = toSpendReceipts([
      {
        id: "00000000-0000-4000-8000-000000000000",
        ts: TS,
        model: "claude-sonnet-5",
        inputTokens: 1,
        outputTokens: 2,
        cacheReadTokens: 3,
        cacheCreationTokens: 4,
        messageCount: 1,
        stream: false,
      },
    ]);
    expect(receipts[0]).toEqual({
      ts: TS,
      model: "claude-sonnet-5",
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 3,
      cacheCreationTokens: 4,
    });
  });

  it("parses ISO datetimes and relative windows; rejects garbage", () => {
    const NOW = Date.parse("2026-08-06T12:00:00.000Z");
    expect(parseSince("2026-08-01T00:00:00.000Z", NOW)).toBe(
      Date.parse("2026-08-01T00:00:00.000Z"),
    );
    expect(parseSince("7d", NOW)).toBe(NOW - 7 * 86_400_000);
    expect(parseSince("6h", NOW)).toBe(NOW - 6 * 3_600_000);
    expect(parseSince("next tuesday", NOW)).toBeUndefined();
  });
});
