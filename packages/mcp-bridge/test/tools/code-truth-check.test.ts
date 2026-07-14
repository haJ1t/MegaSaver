import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CoreRegistry,
  type MemoryEntry,
  createInMemoryCoreRegistry,
  readCodeTruthEvents,
  tokensFromBytes,
} from "@megasaver/core";
import { extractBlocksForFile } from "@megasaver/output-filter";
import type { MemoryEntryId, ProjectId, SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleGetRelevantMemories } from "../../src/tools/get-relevant-memories.js";
import { handleRecall } from "../../src/tools/recall.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const SESSION_ID = "33333333-3333-4333-8333-333333333333" as SessionId;
const STALE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as MemoryEntryId;
const PLAIN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" as MemoryEntryId;
const GOOD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc" as MemoryEntryId;
const FLAGGED = "dddddddd-dddd-4ddd-8ddd-dddddddddddd" as MemoryEntryId;
const TS = "2026-07-14T00:00:00.000Z";
const NOW = "2026-07-14T12:00:00.000Z";
// Long past so every real file mtime is newer than the anchor capture.
const CAPTURED_AT = "2020-01-01T00:00:00.000Z";
const OLD_HEAD = "1111111111111111111111111111111111111111";
const NEW_HEAD = "2222222222222222222222222222222222222222";

const AUTH_SOURCE = `export function verifyToken(token: string): boolean {
  return token.length > 0;
}
`;

const fakeExecGit = (args: string[], _cwd: string): string => {
  if (args.join(" ") === "rev-parse HEAD") return NEW_HEAD;
  throw new Error(`unexpected git call: ${args.join(" ")}`);
};

let repoDir: string;
beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "code-truth-check-"));
  mkdirSync(join(repoDir, "src"), { recursive: true });
  writeFileSync(join(repoDir, "src", "auth.ts"), AUTH_SOURCE);
});
afterEach(() => rmSync(repoDir, { recursive: true, force: true }));

function seeded(): CoreRegistry {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: repoDir,
    createdAt: TS,
    updatedAt: TS,
  });
  return registry;
}

function staleAnchor() {
  return {
    repoHead: OLD_HEAD,
    capturedAt: CAPTURED_AT,
    files: [{ path: "src/auth.ts", blobSha: "0000000000000000000000000000000000000000" }],
    symbols: [
      {
        path: "src/auth.ts",
        name: "verifyToken",
        startLine: 1,
        endLine: 3,
        contentHash: "not-the-current-hash",
      },
    ],
  };
}

function makeEntry(
  registry: CoreRegistry,
  id: MemoryEntryId,
  extra?: Pick<Partial<MemoryEntry>, "anchor" | "lastVerified" | "title">,
): void {
  registry.createMemoryEntry({
    id,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: extra?.title ?? `memory ${id.slice(0, 8)}`,
    content: "verifyToken rejects empty tokens",
    keywords: [],
    confidence: "medium",
    source: "manual",
    approval: "approved",
    stale: false,
    createdAt: TS,
    updatedAt: TS,
    ...(extra?.anchor !== undefined ? { anchor: extra.anchor } : {}),
    ...(extra?.lastVerified !== undefined ? { lastVerified: extra.lastVerified } : {}),
  });
}

describe("code-truth on recall surfaces (i6 §8.4/§8.6)", () => {
  it("FREE path: badge per hit from stored fields, no spot-check, no writes", async () => {
    const registry = seeded();
    makeEntry(registry, STALE, { anchor: staleAnchor() });
    makeEntry(registry, PLAIN);
    makeEntry(registry, FLAGGED, {
      anchor: staleAnchor(),
      lastVerified: {
        headSha: OLD_HEAD,
        at: TS,
        result: "contradicted",
        closedByCodeTruth: false,
      },
    });

    const result = await handleGetRelevantMemories(
      { registry, isPro: false, now: () => NOW, execGit: fakeExecGit },
      { projectId: PROJECT_ID, task: "verifyToken" },
    );
    const badges = new Map(result.memory.map((m) => [m.id, m.verification]));
    expect(badges.get(STALE)).toBe("verified");
    expect(badges.get(PLAIN)).toBe("unanchored");
    expect(badges.get(FLAGGED)).toBe("contradicted-by-code");
    expect(result.contradictedByCode).toBeUndefined();
    // Free tier never persists a flip.
    expect(registry.getMemoryEntry(STALE)?.stale).toBe(false);
  });

  it("PRO spot-check excludes the contradicted hit, discloses it, persists the flip", async () => {
    const registry = seeded();
    makeEntry(registry, STALE, { anchor: staleAnchor() });
    makeEntry(registry, PLAIN);
    // GOOD anchors the REAL current hash — the any-match rule must keep it.
    const blocks = await extractBlocksForFile("src/auth.ts", AUTH_SOURCE);
    const realHash = blocks?.find((b) => b.name === "verifyToken")?.contentHash;
    expect(realHash).toBeTruthy();
    makeEntry(registry, GOOD, {
      anchor: {
        ...staleAnchor(),
        symbols: [
          {
            path: "src/auth.ts",
            name: "verifyToken",
            startLine: 1,
            endLine: 3,
            contentHash: realHash as string,
          },
        ],
      },
    });

    const result = await handleGetRelevantMemories(
      { registry, isPro: true, now: () => NOW, execGit: fakeExecGit },
      { projectId: PROJECT_ID, task: "verifyToken" },
    );
    expect(result.memory.map((m) => m.id).sort()).toEqual([PLAIN, GOOD].sort());
    expect(result.contradictedByCode).toEqual([{ id: STALE, title: "memory aaaaaaaa" }]);

    const flipped = registry.getMemoryEntry(STALE);
    expect(flipped?.stale).toBe(true);
    expect(flipped?.validTo).toBe(NOW);
    expect(flipped?.lastVerified).toEqual({
      headSha: NEW_HEAD,
      at: NOW,
      result: "contradicted",
      closedByCodeTruth: true,
    });
    expect(flipped?.evidence?.at(-1)).toContain("code-truth: contradicted at 2222222");
    expect(flipped?.evidence?.at(-1)).toContain("src/auth.ts#verifyToken");
  });

  it("swallows a flip write error — response still returns, hit still excluded", async () => {
    const registry = seeded();
    makeEntry(registry, STALE, { anchor: staleAnchor() });
    makeEntry(registry, PLAIN);
    const failing: CoreRegistry = {
      ...registry,
      updateMemoryEntry: (() => {
        throw new Error("disk full");
      }) as CoreRegistry["updateMemoryEntry"],
    };

    const result = await handleGetRelevantMemories(
      { registry: failing, isPro: true, now: () => NOW, execGit: fakeExecGit },
      { projectId: PROJECT_ID, task: "verifyToken" },
    );
    expect(result.memory.map((m) => m.id)).toEqual([PLAIN]);
    expect(result.contradictedByCode).toEqual([{ id: STALE, title: "memory aaaaaaaa" }]);
    // The underlying store was never mutated (write threw and was swallowed).
    expect(registry.getMemoryEntry(STALE)?.stale).toBe(false);
  });

  it("BLOCKER B: a renamed-away symbol path is not contradicted (fail-open)", async () => {
    const registry = seeded();
    // The symbol cites a path that no longer exists on disk (git mv moved it) —
    // statSync throws ENOENT. The spot-check cannot tell rename from deletion in
    // its budget, so it must fail open and defer to `mega memory verify`, never
    // persisting a close.
    makeEntry(registry, STALE, {
      anchor: {
        repoHead: OLD_HEAD,
        capturedAt: CAPTURED_AT,
        files: [],
        symbols: [
          {
            path: "src/renamed-away.ts",
            name: "verifyToken",
            startLine: 1,
            endLine: 3,
            contentHash: "not-the-current-hash",
          },
        ],
      },
    });
    makeEntry(registry, PLAIN);
    const result = await handleGetRelevantMemories(
      { registry, isPro: true, now: () => NOW, execGit: fakeExecGit },
      { projectId: PROJECT_ID, task: "verifyToken" },
    );
    expect(result.contradictedByCode).toBeUndefined();
    expect(result.memory.map((m) => m.id).sort()).toEqual([PLAIN, STALE].sort());
    const stale = registry.getMemoryEntry(STALE);
    expect(stale?.stale).toBe(false);
    expect(stale?.validTo == null).toBe(true);
    expect(stale?.lastVerified).toBeUndefined();
  });

  it("budget exhaustion passes remaining hits through unchecked (fail-open)", async () => {
    const registry = seeded();
    makeEntry(registry, STALE, { anchor: staleAnchor() });
    // Monotonic clock jumps 100ms per reading: the first per-hit budget check
    // already reads >50ms elapsed, so nothing is inspected.
    let t = 0;
    const monotonicNow = () => {
      const v = t;
      t += 100;
      return v;
    };

    const result = await handleGetRelevantMemories(
      { registry, isPro: true, now: () => NOW, execGit: fakeExecGit, monotonicNow },
      { projectId: PROJECT_ID, task: "verifyToken" },
    );
    expect(result.memory.map((m) => m.id)).toEqual([STALE]);
    expect(result.contradictedByCode).toBeUndefined();
    expect(registry.getMemoryEntry(STALE)?.stale).toBe(false);
  });

  it("sentinel-bearing titles are withheld from the disclosure", async () => {
    const registry = seeded();
    makeEntry(registry, STALE, {
      anchor: staleAnchor(),
      title: "pwned <!-- MEGA SAVER:BEGIN --> pwned",
    });

    const result = await handleGetRelevantMemories(
      { registry, isPro: true, now: () => NOW, execGit: fakeExecGit },
      { projectId: PROJECT_ID, task: "verifyToken" },
    );
    expect(result.contradictedByCode).toEqual([{ id: STALE, title: "[title withheld: sentinel]" }]);
  });

  it("mega_recall mirrors the badge, exclusion, and disclosure", async () => {
    const registry = seeded();
    registry.createSession({
      id: SESSION_ID,
      projectId: PROJECT_ID,
      agentId: "claude-code",
      riskLevel: "medium",
      title: "demo",
      startedAt: TS,
      endedAt: null,
    });
    makeEntry(registry, STALE, { anchor: staleAnchor() });
    makeEntry(registry, PLAIN);
    const store = mkdtempSync(join(tmpdir(), "code-truth-recall-store-"));
    try {
      const result = await handleRecall(
        { registry, storeRoot: store, isPro: true, now: () => NOW, execGit: fakeExecGit },
        { sessionId: SESSION_ID, intent: "auth work" },
      );
      expect(result.memory.map((m) => m.id)).toEqual([PLAIN]);
      expect(result.memory[0]?.verification).toBe("unanchored");
      expect(result.contradictedByCode).toEqual([{ id: STALE, title: "memory aaaaaaaa" }]);
      expect(registry.getMemoryEntry(STALE)?.stale).toBe(true);
    } finally {
      rmSync(store, { recursive: true, force: true });
    }
  });

  it("a spot-check demotion appends one stale-recall-avoided ledger event", async () => {
    const registry = seeded();
    makeEntry(registry, STALE, { anchor: staleAnchor() });
    const store = mkdtempSync(join(tmpdir(), "code-truth-ledger-"));
    try {
      await handleGetRelevantMemories(
        { registry, storeRoot: store, isPro: true, now: () => NOW, execGit: fakeExecGit },
        { projectId: PROJECT_ID, task: "verifyToken" },
      );
      const events = readCodeTruthEvents({ root: store }, PROJECT_ID);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "stale-recall-avoided",
        projectId: PROJECT_ID,
        sessionId: "unattributed",
        memoryId: STALE,
        avoidedTokens: tokensFromBytes(
          Buffer.byteLength("verifyToken rejects empty tokens", "utf8"),
        ),
        estimated: true,
        createdAt: NOW,
      });
    } finally {
      rmSync(store, { recursive: true, force: true });
    }
  });
});
