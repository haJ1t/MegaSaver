import { randomUUID } from "node:crypto";
import { type OverlayChunkSet, saveOverlayChunkSet } from "@megasaver/content-store";
import {
  type EvidenceRecordInput,
  type SourceKind,
  appendEvidence,
} from "@megasaver/evidence-ledger";
import {
  type FilterDecision,
  type FilterOutputResult,
  type OutputSourceKind,
  filterOutput,
} from "@megasaver/output-filter";
import { redact } from "@megasaver/policy";
import { type TokenSaverMode, type WorkspaceKey, modeToBudget } from "@megasaver/shared";
import { appendOverlayEvent } from "@megasaver/stats";

export type RecordOverlayOutputInput = {
  storeRoot: string;
  // When set, one evidence row is written per compressed+stored chunk set.
  // Absent → no evidence row (backward-compatible for callers without a store).
  evidenceStoreRoot?: string;
  workspaceKey: string;
  liveSessionId: string;
  raw: string;
  sourceKind: OutputSourceKind;
  label: string;
  mode: TokenSaverMode;
  storeRawOutput: boolean;
  now?: () => string;
  newId?: () => string;
};

export type RecordOverlayOutputResult = {
  decision: FilterDecision;
  summary: string;
  returnedText: string;
  rawBytes: number;
  returnedBytes: number;
  bytesSaved: number;
  savingRatio: number;
  chunkSetId?: string;
};

function returnedTextOf(result: FilterOutputResult): string {
  return [result.summary, ...result.excerpts.map((e) => e.text)].join("\n");
}

function chunkSetSource(kind: OutputSourceKind, label: string): OverlayChunkSet["source"] {
  switch (kind) {
    case "command":
      return { kind: "command", command: label, args: [] };
    case "grep":
      return { kind: "grep", query: label };
    case "fetch":
      return { kind: "fetch", url: label };
    case "file":
      return { kind: "file", path: label };
  }
}

// Filter an already-produced output buffer (no re-execution, no path gating —
// the output is the tool's own trusted result), record the overlay event keyed
// by (workspaceKey, liveSessionId), and store the FULL output (secrets redacted)
// as a recoverable chunk so the agent can expand back to EVERYTHING the filter
// dropped (lossless expand). Returns the compressed view to the caller, or
// "passthrough" with no side effects when filterOutput keeps the buffer whole.
export async function recordAndFilterOverlayOutput(
  input: RecordOverlayOutputInput,
): Promise<RecordOverlayOutputResult> {
  const now = input.now ?? (() => new Date().toISOString());
  const newId = input.newId ?? (() => randomUUID());

  const filtered = filterOutput({
    raw: input.raw,
    mode: input.mode,
    maxReturnedBytes: modeToBudget(input.mode),
  });

  const base = {
    decision: filtered.decision,
    summary: filtered.summary,
    returnedText: returnedTextOf(filtered),
    rawBytes: filtered.rawBytes,
    returnedBytes: filtered.returnedBytes,
    bytesSaved: filtered.bytesSaved,
    savingRatio: filtered.savingRatio,
  };
  if (filtered.decision !== "compressed") return base;

  const createdAt = now();
  const { redacted: redactedText, count: secretCount } = redact(input.raw);

  // A throw here is fine: the PostToolUse hook caller treats any failure as
  // passthrough (the original output reaches the model untouched), so a partial
  // write (chunk saved, event throws) is acceptable — no evidence is lost.
  let chunkSetId: string | undefined;
  let chunksStored = 0;
  if (input.storeRawOutput) {
    chunkSetId = newId();
    const lineCount = redactedText.length === 0 ? 1 : redactedText.split("\n").length;
    const chunkSet: OverlayChunkSet = {
      chunkSetId,
      workspaceKey: input.workspaceKey,
      liveSessionId: input.liveSessionId,
      createdAt,
      source: chunkSetSource(input.sourceKind, input.label),
      rawBytes: filtered.rawBytes,
      redacted: secretCount > 0,
      chunks: [
        {
          id: "0",
          startLine: 1,
          endLine: lineCount,
          bytes: Buffer.byteLength(redactedText, "utf8"),
          text: redactedText,
        },
      ],
    };
    // Store the full redacted output (not just the kept excerpts) so the agent
    // can recover EVERYTHING via expand — the hook auto-replaces output, so
    // dropped content must stay recoverable (evidence-preserving, §1/§12).
    await saveOverlayChunkSet({ storeRoot: input.storeRoot, chunkSet });
    chunksStored = 1;
  }

  appendOverlayEvent({
    store: { root: input.storeRoot },
    event: {
      id: newId(),
      liveSessionId: input.liveSessionId,
      workspaceKey: input.workspaceKey,
      createdAt,
      sourceKind: input.sourceKind,
      label: input.label,
      rawBytes: filtered.rawBytes,
      returnedBytes: filtered.returnedBytes,
      bytesSaved: filtered.bytesSaved,
      savingRatio: filtered.savingRatio,
      ...(chunkSetId !== undefined ? { chunkSetId } : {}),
      summary: filtered.summary,
      mode: input.mode,
    },
    secretsRedacted: secretCount,
    chunksStored,
  });

  // Evidence write: only when chunk was persisted AND a store is configured.
  // Fire-and-await but swallowed: evidence failure must never block compressed output
  // (same fail-safe posture as appendOverlayEvent above).
  if (input.evidenceStoreRoot !== undefined && chunkSetId !== undefined) {
    const { redacted: redactedReturnedText } = redact(returnedTextOf(filtered));
    const evidenceRecord: EvidenceRecordInput = {
      evidenceId: newId(),
      // workspaceKey in RecordOverlayOutputInput is plain string; evidence schema
      // requires the branded WorkspaceKey — the value is already validated upstream
      // by the overlay event path, so this cast is safe at the call boundary.
      workspaceKey: input.workspaceKey as WorkspaceKey,
      sessionRef: { kind: "live", id: input.liveSessionId },
      // OutputSourceKind values are a strict subset of SourceKind — cast is safe.
      sourceKind: input.sourceKind as SourceKind,
      // label is secret-bearing (full command line, path, or fetch URL). The
      // evidence spec forbids an unredacted secret in stored sourceRef, and
      // appendEvidence does not redact on append — so redact here, same detector
      // as raw/returned content above.
      sourceRef: { label: redact(input.label).redacted },
      classification: input.sourceKind,
      redactionReport: {
        redacted: secretCount > 0,
        highRiskFindings: secretCount,
        unresolvedHighRisk: false,
      },
      redactedRawContent: redactedText,
      redactedReturnedContent: redactedReturnedText,
      redactedRawChunkSetId: chunkSetId,
      returnedChunkRefs: [{ chunkSetId, chunkId: "0" }],
      createdAt,
      expiresAt: null,
      retentionClass: "session",
      policyVersion: "1",
      pipelineVersion: "1",
    };
    try {
      await appendEvidence({ storeRoot: input.evidenceStoreRoot, record: evidenceRecord });
    } catch {
      // Best-effort: evidence failure must never surface to the caller.
    }
  }

  return { ...base, ...(chunkSetId !== undefined ? { chunkSetId } : {}) };
}
