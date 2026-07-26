import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { explainEvidence, listEvidenceByWorkspace, pinEvidence } from "@megasaver/evidence-ledger";
import { memoryEntryIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sweepEvidenceStore } from "../src/evidence-gc.js";
import { fetchChunk } from "../src/fetch-chunk.js";
import { recordAndFilterOverlayOutput } from "../src/record-output.js";
import { pruneChunkSetsHonoringPins } from "../src/retention-prune.js";

const WK_A = "0123456789abcdef";
const WK_B = "fedcba9876543210";
const RAW = `line ${"x".repeat(40)}\n`.repeat(2000);
const DAY_MS = 86_400_000;
const MEM_ID = memoryEntryIdSchema.parse("00000000-0000-4000-8000-0000000000a1");
const NOW = Date.parse("2026-07-25T00:00:00.000Z");

// apps/cli/src/hooks/saver.ts:350 verbatim — the chunk-set id is sha256 of the
// raw output with no session or workspace salt, so two sessions that emit
// byte-identical output write the same filename in two different directories.
const saverNewId = (raw: string) => (): string =>
  `cs-${createHash("sha256").update(raw).digest("hex").slice(0, 32)}`;

let storeRoot: string;
beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "ms-evgc-collide-"));
});
afterEach(() => rmSync(storeRoot, { recursive: true, force: true }));

async function record(
  workspaceKey: string,
  liveSessionId: string,
  createdAtMs: number,
): Promise<{ chunkSetId: string; path: string; evidenceId: string }> {
  const createdAt = new Date(createdAtMs).toISOString();
  const res = await recordAndFilterOverlayOutput({
    storeRoot,
    evidenceStoreRoot: storeRoot,
    workspaceKey,
    liveSessionId,
    raw: RAW,
    sourceKind: "command",
    label: "cat big.log",
    mode: "aggressive",
    storeRawOutput: true,
    now: () => createdAt,
    newId: saverNewId(RAW),
  });
  expect(res.decision).toBe("compressed");
  const chunkSetId = res.chunkSetId ?? "";
  const records = await listEvidenceByWorkspace({ storeRoot, workspaceKey });
  const written = records.find((rec) => rec.createdAt === createdAt);
  return {
    chunkSetId,
    path: join(storeRoot, "content", workspaceKey, liveSessionId, `${chunkSetId}.json`),
    evidenceId: written?.evidenceId ?? "",
  };
}

function ageFile(path: string, ms: number): void {
  const seconds = ms / 1000;
  utimesSync(path, seconds, seconds);
}

async function statusBySession(workspaceKey: string): Promise<Record<string, string>> {
  const recs = await listEvidenceByWorkspace({ storeRoot, workspaceKey });
  const out: Record<string, string> = {};
  for (const rec of recs) {
    if (rec.sessionRef?.kind === "live") out[rec.sessionRef.id] = rec.status;
  }
  return out;
}

describe("evidence GC with colliding content-derived chunk-set ids", () => {
  it("collects the expired record's own chunk set and leaves the live twin alone", async () => {
    const expired = await record(WK_A, "old-session", NOW - 40 * DAY_MS);
    const live = await record(WK_A, "live-session", NOW);
    expect(expired.chunkSetId).toBe(live.chunkSetId);

    const { degraded } = await sweepEvidenceStore({ storeRoot, now: new Date(NOW) });

    expect(degraded).toBe(1);
    expect(existsSync(expired.path)).toBe(false);
    expect(existsSync(live.path)).toBe(true);
    expect(
      await fetchChunk({ storeRoot, chunkSetId: live.chunkSetId, chunkId: "0" }),
    ).toMatchObject({ ok: true });
    expect(await statusBySession(WK_A)).toEqual({
      "old-session": "retained_metadata_only",
      "live-session": "available",
    });
  });

  // maybeRunOverlayGc order: prune first, then the evidence sweep. Once prune
  // has collected the expired copy the only file left under the shared id is
  // the live session's — the store-wide scan then hands the GC that one.
  it("leaves the live twin after prune already collected the expired copy", async () => {
    const expired = await record(WK_A, "old-session", NOW - 40 * DAY_MS);
    const live = await record(WK_A, "live-session", NOW);
    ageFile(expired.path, NOW - 40 * DAY_MS);

    await pruneChunkSetsHonoringPins({ storeRoot, olderThan: new Date(NOW - 31 * DAY_MS) });
    expect(existsSync(expired.path)).toBe(false);

    await sweepEvidenceStore({ storeRoot, now: new Date(NOW) });

    expect(existsSync(live.path)).toBe(true);
    expect(
      await fetchChunk({ storeRoot, chunkSetId: live.chunkSetId, chunkId: "0" }),
    ).toMatchObject({ ok: true });
  });

  it("never reaches across workspaces: repo A's sweep leaves repo B's live chunk", async () => {
    const expired = await record(WK_A, "old-session", NOW - 40 * DAY_MS);
    const live = await record(WK_B, "live-session", NOW);
    expect(expired.chunkSetId).toBe(live.chunkSetId);
    ageFile(expired.path, NOW - 40 * DAY_MS);

    await pruneChunkSetsHonoringPins({ storeRoot, olderThan: new Date(NOW - 31 * DAY_MS) });
    await sweepEvidenceStore({ storeRoot, now: new Date(NOW) });

    expect(existsSync(live.path)).toBe(true);
    expect(await statusBySession(WK_B)).toEqual({ "live-session": "available" });
  });
});

// The triple is the file's ADDRESS, not its owner: two records in one session
// (the saver's first-sight index fails open — FIFO cap, lock skip, parse fail)
// point at one file. Collecting the expired one may not unlink a file another
// live or pinned record still advertises as `rawExpandable`.
describe("evidence GC with same-session records sharing one chunk file", () => {
  const SESSION = "one-live-session";

  it("keeps the file a pinned twin still points at", async () => {
    const expired = await record(WK_A, SESSION, NOW - 40 * DAY_MS);
    const pinned = await record(WK_A, SESSION, NOW);
    expect(pinned.path).toBe(expired.path);
    await pinEvidence({
      storeRoot,
      workspaceKey: WK_A,
      evidenceId: pinned.evidenceId,
      memoryId: MEM_ID,
    });

    const { degraded } = await sweepEvidenceStore({ storeRoot, now: new Date(NOW) });

    expect(degraded).toBe(1);
    expect(existsSync(pinned.path)).toBe(true);
    expect(
      await explainEvidence({ storeRoot, workspaceKey: WK_A, evidenceId: pinned.evidenceId }),
    ).toMatchObject({ rawExpandable: true });
    expect(
      await fetchChunk({ storeRoot, chunkSetId: pinned.chunkSetId, chunkId: "0" }),
    ).toMatchObject({ ok: true });
  });

  it("keeps the file an unexpired twin still points at", async () => {
    const expired = await record(WK_A, SESSION, NOW - 40 * DAY_MS);
    const live = await record(WK_A, SESSION, NOW);
    expect(live.path).toBe(expired.path);

    const { degraded } = await sweepEvidenceStore({ storeRoot, now: new Date(NOW) });

    expect(degraded).toBe(1);
    expect(existsSync(live.path)).toBe(true);
    expect(
      await fetchChunk({ storeRoot, chunkSetId: live.chunkSetId, chunkId: "0" }),
    ).toMatchObject({ ok: true });
  });

  it("still collects the file once no record points at it", async () => {
    const first = await record(WK_A, SESSION, NOW - 40 * DAY_MS);
    const second = await record(WK_A, SESSION, NOW - 39 * DAY_MS);
    expect(second.path).toBe(first.path);

    const { degraded } = await sweepEvidenceStore({ storeRoot, now: new Date(NOW) });

    expect(degraded).toBe(2);
    expect(existsSync(first.path)).toBe(false);
  });
});

// locateChunkSet answers "any file with this id", which is only sound for a
// READ (colliding sets are byte-identical). A delete or a hold must address the
// (workspaceKey, sessionDir, chunkSetId) triple, so neither may route through it.
describe("no delete/hold path resolves a chunk set by id alone", () => {
  for (const file of ["evidence-gc.ts", "retention-prune.ts"]) {
    it(`src/${file} does not reference locateChunkSet`, () => {
      const src = readFileSync(fileURLToPath(new URL(`../src/${file}`, import.meta.url)), "utf8");
      expect(src).not.toContain("locateChunkSet");
    });
  }
});
