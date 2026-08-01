import { createHash, randomUUID } from "node:crypto";
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
  countTokens,
  filterOutput,
} from "@megasaver/output-filter";
import { redact } from "@megasaver/policy";
import { type TokenSaverMode, type WorkspaceKey, modeToBudget } from "@megasaver/shared";
import { appendOverlayEvent, isStoreFresh } from "@megasaver/stats";
import { DEFAULT_SAVING_FLOORS, admitCompression } from "./admission-guard.js";
import { recoverableChunks } from "./recoverable-chunks.js";
import { buildRecoveryFooter, looksPreTruncated } from "./recovery-footer.js";

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

// Session evidence points at an overlay chunk set the store GC deletes after
// 30 days, so it must expire on the same clock: a null expiresAt means "never"
// to gcEvidence, which left every record — and its one ref per raw chunk —
// on disk forever.
export const EVIDENCE_RETENTION_MS = 30 * 86_400_000;

// §W1 lever (a): "is this output worth touching at all". It used to be
// modeToBudget(mode) — the same constant that sized the OUTPUT — which made
// eligibility a function of how hard the mode compresses. Under the shipped
// default (safe, 32 KB) that suppressed everything below 32 KB, and since this
// function returns before storing anything, such output was not merely
// uncompressed: it had no recovery handle either.
//
// The decoupled eligibility floor — §W1 lever (a). NOT the default.
//
// 2048 is where safe mode's share stops being overridden: fit.ts targets
// max(MIN_TARGET_BYTES, rawBytes * ratio), so below MIN_TARGET_BYTES / 0.5 the
// 1024-byte minimum-signal clamp binds instead of safe's half-share and the
// saving collapses toward zero. That makes it the smallest input for which
// every mode's target is still its own ratio.
//
// It is exported and tested but not wired as the default, because adopting it
// moves the shipped trigger from 32 KB to 2 KB under `safe` — many more, much
// smaller rewrites. What each rewrite costs on the billed ledger is
// UNMEASURED: the in-place cache-churn tax once cited here (~18k tokens) was
// retracted (wiki/syntheses/saver-cache-churn, CORRECTION 2026-07-30 — the
// figure reads as trajectory divergence, not a mechanism-backed tax). The
// ratio case for adopting it is measured; the cost case is not, and the cost
// case is the one the §W1 gate (the open A4 billed-S leg) turns on. Pass it
// explicitly via `compressFloorBytes` to opt in.
export const COMPRESS_FLOOR_BYTES = 2_048;

// B11 event-identity bucket. The daemon write and the hook's timeout fallback
// stamp createdAt seconds apart (1.5s abort + pipeline time), so they share a
// bucket; a genuine re-delivery of byte-identical output later in the session
// (the first-sight ledger failing open) lands in a new bucket and still
// counts. A race exactly on a bucket edge still double-counts — residual
// probability ~skew/width, against 100% without the bucket.
export const OVERLAY_EVENT_ID_BUCKET_MS = 600_000;
// Bounds the WAIT, not the work. Sized above the tokenizer's cold start, which
// is what the spawned hook pays on every invocation: measured 101/109/132 ms
// for the first countTokens in a fresh process (2026-08-01, three runs), plus
// ~90 ms for a 250 KB payload's two calls. 50 ms made the timer win on every
// real event, so the fields were omitted always and the feature was inert in
// production while every test passed.
export const TOKEN_COUNT_BUDGET_MS = 500;

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
  countTokensImpl?: (text: string) => Promise<number>;
  // The byte gate the caller already applied (hook minBytesFor). Both token
  // thresholds derive from it so the caller's gate is the single eligibility
  // authority — no passthrough/light dead band can open between the gate and
  // the decision (B8). Absent -> COMPRESS_FLOOR_BYTES (old callers, old daemon).
  compressFloorBytes?: number;
  // Ranking hint passed to filterOutput. Optional: when absent, ranking is
  // generic (today's behavior). The hook path fills it from the captured
  // session prompt; proxy tools already pass their own explicit intent.
  intent?: string;
  // Which stream of a dual-stream (stdout+stderr) tool response this part is.
  // Joins the overlay event identity when present: byte-identical parts on
  // BOTH streams otherwise derive the same ove- id and the second event is
  // silently absorbed. Absent = old identity (backward compatible — old
  // events and single-part callers keep their ids). The daemon /excerpt body
  // carries it so the daemon and the in-process fallback derive the SAME id
  // for the same part.
  streamSlot?: "stdout" | "stderr";
  // F30: when true and the decision compresses with a stored chunk set, the
  // canonical recovery footer is appended to returnedText INSIDE record so
  // the persisted returnedBytes/bytesSaved count everything the model
  // receives. Callers must NOT append their own footer.
  includeFooter?: boolean;
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
  // Signed savings, never clamped (B1's shape, wired at this producer too):
  // bytesSaved floors at zero, so on its own it cannot distinguish a
  // break-even rewrite from an inflating one. Optional for the same reason the
  // stats event field is: this struct also arrives over HTTP from the daemon
  // (saver-run.ts casts /excerpt's JSON to it), and a daemon predating the
  // field omits it. Every branch of recordAndFilterOverlayOutput sets it.
  deltaBytes?: number;
  chunkSetId?: string;
  chunkCount?: number;
};

// D16: excerpts render in SOURCE order with gap markers so spliced fragments
// can never parse as contiguous code. Line numbers live in the excerpts' OWN
// (post-collapse / post-compression) space — chunkedLineCount, never raw — so a
// collapsed tail can't produce a phantom range. Recovery stays fetch-by-chunk-id
// (the wave-2 footer), so no line->id promise is made here.
function returnedTextOf(result: FilterOutputResult): string {
  // A3 (§W3): gap markers are numbered in the RAW output's coordinate system —
  // the one the stored chunks index and the one the agent reads its file in.
  //
  // They used to be numbered in post-collapse space while the chunks indexed
  // the raw output, so an agent reading `… [lines 146-902 omitted]` had no
  // sound way to pick a chunk: the published ~40-lines-per-chunk rule resolved
  // it to unrelated content. Measured on a 1700-line log: the marker resolved
  // to chunk 3, holding raw lines 121-160; the right chunk was ~23.
  //
  // Raw coordinates exist only when every excerpt carries them, i.e. when no
  // specialized compressor synthesised lines. When one did, no line number is
  // truthful, so we emit a countless marker rather than a wrong number.
  const addressable =
    result.rawLineCount !== undefined &&
    result.excerpts.every((e) => e.rawStartLine !== undefined && e.rawEndLine !== undefined);

  const ordered = [...result.excerpts].sort(
    (a, b) => a.startLine - b.startLine || a.endLine - b.endLine,
  );
  const parts: string[] = [result.summary];

  if (!addressable) {
    for (const e of ordered) parts.push(e.text);
    if (ordered.length > 0) {
      parts.push("… [remainder omitted — recover any part with the chunk ids below]");
    }
    return parts.join("\n");
  }

  const total = result.rawLineCount ?? 0;
  let cursor = 1;
  for (const e of ordered) {
    const start = e.rawStartLine as number;
    const end = e.rawEndLine as number;
    if (start > cursor) parts.push(`… [lines ${cursor}-${start - 1} omitted]`);
    parts.push(e.text);
    cursor = Math.max(cursor, end + 1);
  }
  if (cursor <= total) parts.push(`… [lines ${cursor}-${total} omitted]`);
  return parts.join("\n");
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
  // input.newId derives ONLY the chunk-set id, so identical content re-emitted in
  // a new session yields an identical chunk-set id (P1 cache friendliness). The
  // overlay event id is content-derived too (B11, below); only evidenceId stays
  // a unique random UUID — it is UUID-schema-constrained — and its append is
  // gated on the event being a first sight, not a replay.
  const chunkSetIdGen = input.newId ?? (() => randomUUID());

  const floorBytes = input.compressFloorBytes ?? modeToBudget(input.mode);
  // ~4 bytes/token, mirroring output-filter estimateTokens.
  const thresholdTokens = Math.max(1, Math.ceil(floorBytes / 4));

  const filtered = await filterOutput({
    raw: input.raw,
    mode: input.mode,
    // A4: deliberately NOT passing maxReturnedBytes. It used to be set to
    // modeToBudget(mode) — the exact value the filter defaults to — so it
    // changed nothing, but `maxReturnedBytes` means "the caller named an
    // explicit size" and therefore SUPPRESSES the mode's target ratio. Passing
    // a redundant default here silently pinned every hook-path output to the
    // mode ceiling, which is the fixed-size-truncator behaviour A4 exists to
    // remove. Sessions that genuinely set a size still reach the filter through
    // run-command's settings.maxReturnedBytes.
    passthroughThresholdTokens: thresholdTokens,
    hardWrapThresholdTokens: thresholdTokens,
    // RAW label, not the redacted one: the file extension must survive for
    // semantic chunking to trigger. In-memory hint only — the persisted
    // chunk-set source below still uses redactedLabel.
    source: chunkSetSource(input.sourceKind, input.label),
    ...(input.intent !== undefined ? { intent: input.intent } : {}),
  });

  // No rewrite happens below the compressed band, so nothing here is delivered:
  // the PostToolUse hook maps every non-compressed decision to PASSTHROUGH
  // (saver.ts) and emits no JSON, which leaves the model holding the ORIGINAL
  // tool output; the daemon's /excerpt only relays this struct back to that
  // same hook. Reporting returnedTextOf(filtered) and filtered.returnedBytes
  // therefore described a rendering nobody receives — and since that rendering
  // prepends a summary line, it measured 30-140 bytes MORE than the raw on
  // real source files while savingRatio's floor reported that loss as 0.
  // Report the raw, exactly as the net-negative degradation below does.
  if (filtered.decision !== "compressed") {
    return {
      decision: filtered.decision,
      summary: filtered.summary,
      returnedText: input.raw,
      rawBytes: filtered.rawBytes,
      returnedBytes: filtered.rawBytes,
      bytesSaved: 0,
      savingRatio: 0,
      deltaBytes: 0,
    };
  }

  const createdAt = now();
  const { redacted: redactedText, count: secretCount } = redact(input.raw);
  // The label is itself secret-bearing (full command line, fetch URL, file
  // path). Redact it before it reaches the persisted chunk-set source and the
  // overlay stats event — mirrors policyRedactSourceRef on the evidence path.
  const redactedLabel = redact(input.label).redacted;

  // Chunk pieces are prepared IN MEMORY first: the footer needs chunkCount
  // and the net-negative guard below must run before any side effect.
  let chunkSetId: string | undefined;
  let chunks: OverlayChunkSet["chunks"] = [];
  if (input.storeRawOutput) {
    chunkSetId = chunkSetIdGen();
    // Through recoverableChunks, not an inline chunker: this path used to
    // duplicate the split, and a second copy is a second coordinate system
    // waiting to drift away from the delivered gap markers.
    chunks = recoverableChunks(input.raw);
  }

  // F30 honest accounting: persisted numbers count the bytes the model
  // actually receives — summary + excerpts + D16 markers, plus the recovery
  // footer when the caller asks for one.
  const text0 = returnedTextOf(filtered);
  let finalText = text0;
  if (input.includeFooter === true && chunkSetId !== undefined) {
    const text0Bytes = Buffer.byteLength(text0, "utf8");
    const footerInput = {
      rawBytes: filtered.rawBytes,
      chunkSetId,
      chunkCount: chunks.length,
      rawLooksTruncated: looksPreTruncated(input.raw),
    };
    let footer = buildRecoveryFooter({ ...footerInput, returnedBytes: text0Bytes });
    // Fixed point on the displayed size: the footer's own bytes are part of
    // the delivered size it reports. One correction pass almost always
    // converges; the second absorbs a digit-width rollover. A rollover ON
    // the second pass is accepted — the display drifts by at most its own
    // digit-width change, while the PERSISTED numbers stay exact byte
    // counts of the final text.
    for (let i = 0; i < 2; i++) {
      const next = buildRecoveryFooter({
        ...footerInput,
        returnedBytes: text0Bytes + Buffer.byteLength(footer, "utf8"),
      });
      if (Buffer.byteLength(next, "utf8") === Buffer.byteLength(footer, "utf8")) {
        footer = next;
        break;
      }
      footer = next;
    }
    finalText = text0 + footer;
  }
  const finalReturnedBytes = Buffer.byteLength(finalText, "utf8");

  // Admission guard, BEFORE any side effect (saveOverlayChunkSet,
  // appendOverlayEvent, evidence): a near-no-op rewrite must clear a minimum
  // saving, not merely avoid inflating. See admission-guard.ts for why a
  // one-byte saving used to pass, why its unmeasured-cost trade is refused,
  // and how the shipped floors were measured. Degrading to passthrough also
  // structurally preserves the honest-metrics invariant
  // returnedTokens <= rawTokens.
  if (!admitCompression(filtered.rawBytes, finalReturnedBytes, DEFAULT_SAVING_FLOORS).admit) {
    return {
      decision: "passthrough",
      summary: filtered.summary,
      returnedText: input.raw,
      rawBytes: filtered.rawBytes,
      returnedBytes: filtered.rawBytes,
      bytesSaved: 0,
      savingRatio: 0,
      deltaBytes: 0,
    };
  }

  const bytesSaved = filtered.rawBytes - finalReturnedBytes;
  const savingRatio = bytesSaved / filtered.rawBytes;

  // A throw here is fine: the PostToolUse hook caller treats any failure as
  // passthrough (the original output reaches the model untouched), so a partial
  // write (chunk saved, event throws) is acceptable — no evidence is lost.
  let chunksStored = 0;
  let chunkRefs: ReturnedChunkRef[] = [];
  if (input.storeRawOutput && chunkSetId !== undefined) {
    const csid = chunkSetId;
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

  // B11: the hook aborts a slow daemon POST and replays the SAME compression
  // through the in-process fallback — two writers, one compression. The event
  // identity is derived from the compression's stable inputs plus a coarse
  // creation bucket (exact createdAt would differ between the racing writers'
  // clocks) so appendOverlayEvent can absorb the replay as a no-op.
  const createdBucket = Math.floor(Date.parse(createdAt) / OVERLAY_EVENT_ID_BUCKET_MS);
  // streamSlot joins the identity ONLY when present, so an absent slot hashes
  // to the exact pre-slot id (old daemons/callers stay id-compatible).
  const slotSegment = input.streamSlot !== undefined ? `${input.streamSlot}\0` : "";
  const overlayEventId = `ove-${createHash("sha256")
    .update(
      `${input.workspaceKey}\0${input.liveSessionId}\0${input.sourceKind}\0${input.mode}\0${input.label}\0${createdBucket}\0${slotSegment}`,
    )
    .update(input.raw)
    .digest("hex")
    .slice(0, 32)}`;
  // Measured over the SAME two texts deltaBytes is computed over, so bytes and
  // tokens describe one object. A failure or a slow lazy encoder load yields
  // OMITTED fields — a value in a field named rawTokens is measured or absent.
  const counter = input.countTokensImpl ?? countTokens;
  let tokenFields: {
    rawTokens?: number;
    returnedTokens?: number;
    deltaTokens?: number;
  } = {};
  let timerId: NodeJS.Timeout | undefined;
  try {
    const [rawTokens, returnedTokens] = await Promise.race([
      Promise.all([counter(input.raw), counter(finalText)]),
      new Promise<never>((_, reject) => {
        timerId = setTimeout(
          () => reject(new Error("token_budget_exceeded")),
          TOKEN_COUNT_BUDGET_MS,
        );
      }),
    ]);
    tokenFields = { rawTokens, returnedTokens, deltaTokens: rawTokens - returnedTokens };
  } catch {
    tokenFields = {};
  } finally {
    if (timerId !== undefined) clearTimeout(timerId);
  }

  // The append itself reports first sight vs replay: the store checks the id
  // and appends under ONE file lock (the daemon and the hook's timeout
  // fallback race from two processes, so a separate pre-check here would
  // re-open the interleave), and the evidence write below runs only when
  // `appended` says this writer won.
  const { appended } = appendOverlayEvent({
    store: { root: input.storeRoot },
    event: {
      id: overlayEventId,
      liveSessionId: input.liveSessionId,
      workspaceKey: input.workspaceKey,
      createdAt,
      sourceKind: input.sourceKind,
      label: redactedLabel,
      rawBytes: filtered.rawBytes,
      returnedBytes: finalReturnedBytes,
      bytesSaved,
      // B1's signed field, wired at the producer: `bytesSaved` is clamped at 0,
      // so without this the ledger cannot tell a break-even rewrite from an
      // inflating one. Positive here by construction (the admission guard
      // rejects the rest), but the field must be present or `deltaBytesOf`
      // falls back to the clamped value and the capability stays inert.
      deltaBytes: filtered.rawBytes - finalReturnedBytes,
      ...tokenFields,
      isFreshStore: isStoreFresh(input.storeRoot),
      savingRatio,
      ...(chunkSetId !== undefined ? { chunkSetId } : {}),
      summary: filtered.summary,
      mode: input.mode,
      // W5: event-carried counters — rebuilds recover them without
      // carryForward when the summary file is lost.
      secretsRedacted: secretCount,
      chunksStored,
    },
    secretsRedacted: secretCount,
    chunksStored,
  });

  // Evidence write: only when chunk was persisted AND a store is configured AND
  // the overlay event was a first sight (a B11 replay must not duplicate the
  // evidence row — the ledger is append-only and its ids are random UUIDs).
  // Fire-and-await but swallowed: evidence failure must never block compressed output
  // (same fail-safe posture as appendOverlayEvent above).
  if (appended && input.evidenceStoreRoot !== undefined && chunkSetId !== undefined) {
    const { redacted: redactedReturnedText } = redact(finalText);
    const evidenceRecord: EvidenceRecordInput = {
      evidenceId: randomUUID(),
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
      expiresAt: new Date(Date.parse(createdAt) + EVIDENCE_RETENTION_MS).toISOString(),
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
    decision: "compressed",
    summary: filtered.summary,
    returnedText: finalText,
    rawBytes: filtered.rawBytes,
    returnedBytes: finalReturnedBytes,
    bytesSaved,
    savingRatio,
    // Equal to bytesSaved on this branch (it is unclamped here, and the
    // admission guard forbids a negative), but present so a caller reading
    // result.deltaBytes never has to know which branch produced the result.
    deltaBytes: filtered.rawBytes - finalReturnedBytes,
    ...(chunkSetId !== undefined ? { chunkSetId, chunkCount: chunksStored } : {}),
  };
}
