import { randomUUID } from "node:crypto";
import { type OverlayChunkSet, saveOverlayChunkSet } from "@megasaver/content-store";
import {
  type EvidenceRecordInput,
  type ReturnedChunkRef,
  type SourceKind,
  type SourceRef,
  type SourceRefRedactor,
  appendEvidence,
} from "@megasaver/evidence-ledger";
import {
  type FilterDecision,
  type FilterOutputResult,
  type OutputSourceKind,
  chunkByLines,
  filterOutput,
} from "@megasaver/output-filter";
import { redact } from "@megasaver/policy";
import { type TokenSaverMode, type WorkspaceKey, modeToBudget } from "@megasaver/shared";
import { appendOverlayEvent } from "@megasaver/stats";

// Matches the generic chunker default; the saver footer's line->id formula
// mirrors this.
export const OVERLAY_CHUNK_LINES = 40;

// Redacts every secret-bearing string field in a SourceRef using the policy
// redactor. hookTool is a tool name (not secret-bearing) and is left as-is.
const policyRedactSourceRef: SourceRefRedactor = (ref: SourceRef): SourceRef => {
  const r = (s: string): string => redact(s).redacted;
  return {
    ...(ref.command !== undefined ? { command: r(ref.command) } : {}),
    ...(ref.args !== undefined ? { args: ref.args.map(r) } : {}),
    ...(ref.url !== undefined ? { url: r(ref.url) } : {}),
    ...(ref.query !== undefined ? { query: r(ref.query) } : {}),
    ...(ref.path !== undefined ? { path: r(ref.path) } : {}),
    ...(ref.label !== undefined ? { label: r(ref.label) } : {}),
    ...(ref.hookTool !== undefined ? { hookTool: ref.hookTool } : {}),
  };
};

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
  // Ranking hint passed to filterOutput. Optional: when absent, ranking is
  // generic (today's behavior). The hook path fills it from the captured
  // session prompt; proxy tools already pass their own explicit intent.
  intent?: string;
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
  chunkCount?: number;
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

  const filtered = await filterOutput({
    raw: input.raw,
    mode: input.mode,
    maxReturnedBytes: modeToBudget(input.mode),
    ...(input.intent !== undefined ? { intent: input.intent } : {}),
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
  // The label is itself secret-bearing (full command line, fetch URL, file
  // path). Redact it before it reaches the persisted chunk-set source and the
  // overlay stats event — mirrors policyRedactSourceRef on the evidence path.
  const redactedLabel = redact(input.label).redacted;

  // A throw here is fine: the PostToolUse hook caller treats any failure as
  // passthrough (the original output reaches the model untouched), so a partial
  // write (chunk saved, event throws) is acceptable — no evidence is lost.
  let chunkSetId: string | undefined;
  let chunksStored = 0;
  let chunkRefs: ReturnedChunkRef[] = [];
  if (input.storeRawOutput) {
    chunkSetId = newId();
    const csid = chunkSetId;
    const pieces =
      redactedText === ""
        ? [{ text: "", startLine: 1, endLine: 1 }]
        : chunkByLines(redactedText, OVERLAY_CHUNK_LINES);
    const chunks = pieces.map((piece, i) => ({
      id: String(i),
      startLine: piece.startLine,
      endLine: piece.endLine,
      bytes: Buffer.byteLength(piece.text, "utf8"),
      text: piece.text,
    }));
    const chunkSet: OverlayChunkSet = {
      chunkSetId,
      workspaceKey: input.workspaceKey,
      liveSessionId: input.liveSessionId,
      createdAt,
      source: chunkSetSource(input.sourceKind, redactedLabel),
      rawBytes: filtered.rawBytes,
      redacted: secretCount > 0,
      chunks,
    };
    // Store the full redacted output (not just kept excerpts) so the agent can
    // recover EVERYTHING via expand — split into fixed 40-line chunks so an
    // expansion fetches only the needed slice (C12), not the whole raw again.
    await saveOverlayChunkSet({ storeRoot: input.storeRoot, chunkSet });
    chunksStored = chunks.length;
    chunkRefs = chunks.map((c) => ({ chunkSetId: csid, chunkId: c.id }));
  }

  appendOverlayEvent({
    store: { root: input.storeRoot },
    event: {
      id: newId(),
      liveSessionId: input.liveSessionId,
      workspaceKey: input.workspaceKey,
      createdAt,
      sourceKind: input.sourceKind,
      label: redactedLabel,
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
      // sourceRef redaction is handled by the policyRedactSourceRef port passed
      // to appendEvidence below — do NOT pre-redact here (single responsibility).
      sourceRef: { label: input.label },
      classification: input.sourceKind,
      redactionReport: {
        redacted: secretCount > 0,
        highRiskFindings: secretCount,
        unresolvedHighRisk: false,
      },
      redactedRawContent: redactedText,
      redactedReturnedContent: redactedReturnedText,
      redactedRawChunkSetId: chunkSetId,
      returnedChunkRefs: chunkRefs,
      createdAt,
      expiresAt: null,
      retentionClass: "session",
      policyVersion: "1",
      pipelineVersion: "1",
    };
    try {
      await appendEvidence({
        storeRoot: input.evidenceStoreRoot,
        redactSourceRef: policyRedactSourceRef,
        record: evidenceRecord,
      });
    } catch {
      // Best-effort: evidence failure must never surface to the caller.
    }
  }

  return {
    ...base,
    ...(chunkSetId !== undefined ? { chunkSetId, chunkCount: chunksStored } : {}),
  };
}
