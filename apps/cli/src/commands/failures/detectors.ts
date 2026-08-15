import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { type OverlayTokenSaverEvent, hashPath } from "@megasaver/core";
import { redact } from "@megasaver/policy";
import type { FailureSnapshot } from "./snapshot.js";

export type DetectorId =
  | "tool-error"
  | "context-overflow"
  | "partial-completion"
  | "hallucinated-state";
export type DetectorVerdict = "findings" | "clear" | "no-signal" | "disabled";
export type DetectorResult = {
  id: DetectorId;
  verdict: DetectorVerdict;
  findings: readonly string[]; // already-redacted messages
  info: readonly string[]; // outside-workspace / exists-uncaptured listings (never findings)
  reason: string | undefined; // no-signal reason
  fix: string | undefined;
};
export type DetectOptions = {
  windowMinutes: number;
  nowMs: number;
  cwd: string;
  enabled: Readonly<Record<DetectorId, boolean>>;
  fileExists?: (absolutePath: string) => boolean; // default existsSync; injected in tests
  redactText?: (raw: string) => string; // default: policy redact(raw).redacted
};

function inWindow(createdAt: string, nowMs: number, windowMinutes: number): boolean {
  const ts = Date.parse(createdAt);
  if (!Number.isFinite(ts)) return false;
  const floor = nowMs - windowMinutes * 60_000;
  return ts >= floor && ts <= nowMs;
}

function isRecorded(event: OverlayTokenSaverEvent): boolean {
  return event.sourceKind === "command" && event.childExitCode !== undefined;
}

function isFailing(event: OverlayTokenSaverEvent): boolean {
  return isRecorded(event) && event.childExitCode !== 0;
}

function failingLabel(event: OverlayTokenSaverEvent, redactText: (raw: string) => string): string {
  const killed = event.childExitCode === null;
  return `${redactText(event.label)} — ${killed ? "killed (timeout/max-bytes)" : `exit ${event.childExitCode}`}`;
}

export function unresolvedFailingReceipts(
  events: readonly OverlayTokenSaverEvent[],
  opts: { windowMinutes: number; nowMs: number },
): readonly OverlayTokenSaverEvent[] {
  const failures: OverlayTokenSaverEvent[] = [];
  for (const event of events) {
    if (!inWindow(event.createdAt, opts.nowMs, opts.windowMinutes)) continue;
    if (!isFailing(event)) continue;
    const recordedAt = Date.parse(event.createdAt);
    const resolved = events.some((later) => {
      if (!inWindow(later.createdAt, opts.nowMs, opts.windowMinutes)) return false;
      const laterAt = Date.parse(later.createdAt);
      if (laterAt <= recordedAt) return false;
      if (later.kind === "expansion" && event.chunkSetId !== undefined) {
        return later.chunkSetId === event.chunkSetId;
      }
      return isRecorded(later) && later.childExitCode === 0;
    });
    if (!resolved) failures.push(event);
  }
  return failures;
}

const NO_RECEIPTS_REASON = "no exec receipts recorded in window — run commands through mega output exec";

function toolErrorDetector(
  events: readonly OverlayTokenSaverEvent[],
  opts: { windowMinutes: number; nowMs: number; redactText: (raw: string) => string },
): DetectorResult {
  const recorded = events.filter(
    (e) => isRecorded(e) && inWindow(e.createdAt, opts.nowMs, opts.windowMinutes),
  );
  if (recorded.length === 0) {
    return { id: "tool-error", verdict: "no-signal", findings: [], info: [], reason: NO_RECEIPTS_REASON, fix: undefined };
  }
  const failing = recorded.filter((e) => e.childExitCode !== 0);
  if (failing.length === 0) {
    return { id: "tool-error", verdict: "clear", findings: [], info: [], reason: undefined, fix: undefined };
  }
  return {
    id: "tool-error",
    verdict: "findings",
    findings: failing.map((e) => failingLabel(e, opts.redactText)),
    info: [],
    reason: undefined,
    fix: "re-run the failing command through mega output exec so the next attempt carries a receipt",
  };
}

function partialCompletionDetector(
  events: readonly OverlayTokenSaverEvent[],
  opts: { windowMinutes: number; nowMs: number; redactText: (raw: string) => string },
): DetectorResult {
  const recorded = events.filter(
    (e) => isRecorded(e) && inWindow(e.createdAt, opts.nowMs, opts.windowMinutes),
  );
  if (recorded.length === 0) {
    return { id: "partial-completion", verdict: "no-signal", findings: [], info: [], reason: NO_RECEIPTS_REASON, fix: undefined };
  }
  const unresolved = unresolvedFailingReceipts(events, opts);
  if (unresolved.length === 0) {
    return { id: "partial-completion", verdict: "clear", findings: [], info: [], reason: undefined, fix: undefined };
  }
  return {
    id: "partial-completion",
    verdict: "findings",
    findings: unresolved.map(
      (e) => `unacknowledged-failure candidate: ${failingLabel(e, opts.redactText)}`,
    ),
    info: [],
    reason: undefined,
    fix: "re-run the failing command or re-inject its chunk output so the failure is acknowledged",
  };
}

function contextOverflowDetector(
  snapshot: FailureSnapshot,
): DetectorResult {
  if (snapshot.refs === undefined) {
    return {
      id: "context-overflow",
      verdict: "no-signal",
      findings: [],
      info: [],
      reason: "no input text — pass --file or pipe stdin",
      fix: undefined,
    };
  }
  const known = new Set<string>();
  for (const event of snapshot.events) {
    if (event.chunkSetId !== undefined) known.add(event.chunkSetId);
  }
  const dangling = snapshot.refs.chunkRefs.filter((id) => !known.has(id));
  if (dangling.length === 0) {
    return { id: "context-overflow", verdict: "clear", findings: [], info: [], reason: undefined, fix: undefined };
  }
  return {
    id: "context-overflow",
    verdict: "findings",
    findings: dangling.map((id) => `referenced chunk ${id} is not in this session's store`),
    info: [],
    reason: undefined,
    fix: "re-fetch the referenced chunk with mega output chunk",
  };
}

function hallucinatedStateDetector(
  snapshot: FailureSnapshot,
  opts: DetectOptions,
): DetectorResult {
  if (snapshot.refs === undefined) {
    return {
      id: "hallucinated-state",
      verdict: "no-signal",
      findings: [],
      info: [],
      reason: "no input text — pass --file or pipe stdin",
      fix: undefined,
    };
  }
  if (snapshot.readIndex === undefined) {
    return {
      id: "hallucinated-state",
      verdict: "no-signal",
      findings: [],
      info: [],
      reason: "no capture stores for this session",
      fix: undefined,
    };
  }
  const fileExists = opts.fileExists ?? existsSync;
  const redactText = opts.redactText ?? ((raw: string) => redact(raw).redacted);
  const findings: string[] = [];
  const info: string[] = [];
  const root = resolve(opts.cwd);
  for (const ref of snapshot.refs.pathRefs) {
    const abs = isAbsolute(ref) ? resolve(ref) : resolve(root, ref);
    const rel = relative(root, abs);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      info.push(`outside-workspace: ${redactText(ref)} (not probed)`);
      continue;
    }
    if (snapshot.readIndex[hashPath(abs)] !== undefined) continue; // captured
    if (fileExists(abs)) {
      info.push(`exists-uncaptured: ${redactText(ref)} (on disk, never captured — agent-written?)`);
      continue;
    }
    findings.push(`phantom path: ${redactText(ref)} — referenced but never captured and not on disk`);
  }
  return {
    id: "hallucinated-state",
    verdict: findings.length > 0 ? "findings" : "clear",
    findings,
    info,
    reason: undefined,
    fix: findings.length > 0 ? "verify the referenced paths exist; re-read real files through mega output file" : undefined,
  };
}

export function detectSilentFailures(
  snapshot: FailureSnapshot,
  opts: DetectOptions,
): readonly DetectorResult[] {
  const redactText = opts.redactText ?? ((raw: string) => redact(raw).redacted);
  const shared = { windowMinutes: opts.windowMinutes, nowMs: opts.nowMs, redactText };
  const detectors: Readonly<Record<DetectorId, () => DetectorResult>> = {
    "tool-error": () => toolErrorDetector(snapshot.events, shared),
    "context-overflow": () => contextOverflowDetector(snapshot),
    "partial-completion": () => partialCompletionDetector(snapshot.events, shared),
    "hallucinated-state": () => hallucinatedStateDetector(snapshot, opts),
  };
  return (Object.keys(detectors) as DetectorId[]).map((id) =>
    opts.enabled[id] ? detectors[id]() : { id, verdict: "disabled", findings: [], info: [], reason: undefined, fix: undefined },
  );
}
