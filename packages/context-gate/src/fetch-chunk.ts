import { randomUUID } from "node:crypto";
import { ContentStoreError, loadChunkSet, loadOverlayChunkSet } from "@megasaver/content-store";
import { appendEvent, appendOverlayEvent } from "@megasaver/stats";
import { type FetchOverlayChunkResult, fetchOverlayChunk } from "./fetch-overlay-chunk.js";
import { type LocatedChunkSet, locateChunkSet } from "./locate-chunk-set.js";

export type FetchChunkResult = FetchOverlayChunkResult;

function expansionLabel(chunkId: string, chunkSetId: string): string {
  return `expand chunk "${chunkId}" of "${chunkSetId}"`;
}

function expansionSummary(chunkId: string, fetchedBytes: number): string {
  return `expansion: chunk ${chunkId} re-injected (${fetchedBytes} B)`;
}

// B3 recovery debt for the overlay layout, keyed by EXPLICIT
// (workspaceKey, liveSessionId). Exported for the daemon's /expand route: it
// fetches with those keys directly, and charging the debt through
// locateChunkSet-based resolution could bill another session holding the same
// content-addressed chunk-set id. Best-effort with a swallowed failure — an
// accounting error must never block evidence recovery.
//
// Debt events use random ids — deliberately NOT the B11 deterministic dedupe.
// Every re-fetch of the same chunk re-injects real bytes the agent re-pays,
// so deduping would undercount legitimate repeat fetches; the residual a
// random id admits is a timeout-replay double-charge, and an OVERSTATED debt
// understates net savings — conservative for the A4 gate. The asymmetry with
// the deduped savings credits is intentional: credits inflate the meter,
// debts deflate it.
export async function recordOverlayExpansionDebt(input: {
  storeRoot: string;
  workspaceKey: string;
  liveSessionId: string;
  chunkSetId: string;
  chunkId: string;
  text: string;
}): Promise<void> {
  const fetchedBytes = Buffer.byteLength(input.text, "utf8");
  try {
    const set = await loadOverlayChunkSet({
      storeRoot: input.storeRoot,
      workspaceKey: input.workspaceKey,
      liveSessionId: input.liveSessionId,
      chunkSetId: input.chunkSetId,
    });
    appendOverlayEvent({
      store: { root: input.storeRoot },
      event: {
        id: randomUUID(),
        liveSessionId: input.liveSessionId,
        workspaceKey: input.workspaceKey,
        createdAt: new Date().toISOString(),
        sourceKind: set.source.kind,
        label: expansionLabel(input.chunkId, input.chunkSetId),
        rawBytes: 0,
        returnedBytes: fetchedBytes,
        bytesSaved: 0,
        deltaBytes: -fetchedBytes,
        savingRatio: 0,
        chunkSetId: input.chunkSetId,
        summary: expansionSummary(input.chunkId, fetchedBytes),
        kind: "expansion",
      },
      secretsRedacted: 0,
      chunksStored: 0,
    });
  } catch {
    /* best-effort accounting — the recovered evidence was already delivered */
  }
}

// B3 recovery debt: the ledger banks gross savings at compression time, but
// every expansion re-injects bytes the agent re-pays on each later turn.
// Charge it back as a signed expansion event (deltaBytes = −fetched bytes,
// same chunkSetId) so the signed aggregate reads NET — compression saving
// minus everything ever fetched back. Best-effort with a swallowed failure:
// an accounting error must never block evidence recovery — the fetch result
// stands (same fail-safe posture as record-output's own event append).
async function recordExpansionDebt(input: {
  storeRoot: string;
  located: LocatedChunkSet;
  chunkSetId: string;
  chunkId: string;
  text: string;
  // The registry branch already holds the loaded set; the overlay branch
  // delegates to fetchOverlayChunk, which returns only the chunk — so the
  // set's source kind is re-read here (one small JSON read, only on success).
  registrySourceKind?: "command" | "fetch" | "file" | "grep";
}): Promise<void> {
  const fetchedBytes = Buffer.byteLength(input.text, "utf8");
  if (input.located.layout === "overlay") {
    await recordOverlayExpansionDebt({
      storeRoot: input.storeRoot,
      workspaceKey: input.located.workspaceKey,
      liveSessionId: input.located.liveSessionId,
      chunkSetId: input.chunkSetId,
      chunkId: input.chunkId,
      text: input.text,
    });
    return;
  }
  try {
    if (input.registrySourceKind === undefined) return;
    appendEvent({
      store: { root: input.storeRoot },
      event: {
        id: randomUUID(),
        sessionId: input.located.sessionId,
        projectId: input.located.projectId,
        createdAt: new Date().toISOString(),
        sourceKind: input.registrySourceKind,
        label: expansionLabel(input.chunkId, input.chunkSetId),
        rawBytes: 0,
        returnedBytes: fetchedBytes,
        bytesSaved: 0,
        deltaBytes: -fetchedBytes,
        savingRatio: 0,
        chunkSetId: input.chunkSetId,
        summary: expansionSummary(input.chunkId, fetchedBytes),
        kind: "expansion",
      },
      secretsRedacted: 0,
      chunksStored: 0,
    });
  } catch {
    /* best-effort accounting — the recovered evidence was already delivered */
  }
}

export async function fetchChunk(input: {
  storeRoot: string;
  chunkSetId: string;
  chunkId: string;
}): Promise<FetchChunkResult> {
  const located = locateChunkSet({ storeRoot: input.storeRoot, chunkSetId: input.chunkSetId });
  if (located === null) return { ok: false, reason: "chunk_set_not_found" };

  // Overlay sets share fetchOverlayChunk's load + error translation — the two
  // layouts differ only in how the store path is keyed.
  if (located.layout === "overlay") {
    const out = await fetchOverlayChunk({
      storeRoot: input.storeRoot,
      workspaceKey: located.workspaceKey,
      liveSessionId: located.liveSessionId,
      chunkSetId: input.chunkSetId,
      chunkId: input.chunkId,
    });
    if (out.ok) {
      await recordExpansionDebt({
        storeRoot: input.storeRoot,
        located,
        chunkSetId: input.chunkSetId,
        chunkId: input.chunkId,
        text: out.chunk.text,
      });
    }
    return out;
  }

  let chunkSet: Awaited<ReturnType<typeof loadChunkSet>>;
  try {
    chunkSet = await loadChunkSet({
      storeRoot: input.storeRoot,
      projectId: located.projectId,
      sessionId: located.sessionId,
      chunkSetId: input.chunkSetId,
    });
  } catch (err) {
    if (err instanceof ContentStoreError) {
      if (err.code === "not_found") return { ok: false, reason: "chunk_set_not_found" };
      return { ok: false, reason: "store_corrupt", detail: err.message };
    }
    throw err;
  }

  const chunk = chunkSet.chunks.find((c) => c.id === input.chunkId);
  if (chunk === undefined) return { ok: false, reason: "chunk_not_found" };
  await recordExpansionDebt({
    storeRoot: input.storeRoot,
    located,
    chunkSetId: input.chunkSetId,
    chunkId: input.chunkId,
    text: chunk.text,
    registrySourceKind: chunkSet.source.kind,
  });
  return { ok: true, chunk };
}
