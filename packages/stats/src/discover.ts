import { z } from "zod";

// Reader for the PreToolUse telemetry log written by the CLI hook
// (apps/cli/src/hooks/logger.ts). Same lenient JSONL discipline as
// ingestHookLog: a corrupt or partially-written line is skipped, never fatal.
// `agent` is carried, not gated — the log is single-agent in practice.
export const hookLogRowSchema = z.object({
  timestamp: z.string(),
  tool: z.string(),
  category: z.string(),
  agent: z.string().optional(),
  filePath: z.string().optional(),
  sessionId: z.string().optional(),
});

export type HookLogRow = z.infer<typeof hookLogRowSchema>;

export function parseHookLogRows(content: string): HookLogRow[] {
  const rows: HookLogRow[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const parsed = hookLogRowSchema.safeParse(raw);
    if (parsed.success) rows.push(parsed.data);
  }
  return rows;
}

import type { TokenSaverMode } from "@megasaver/shared";
import { tokensFromBytes } from "./honest-metrics.js";

export type ExposureCause =
  | "workspace_disabled"
  | "source_uncovered"
  | "mcp_unproxied"
  | "below_floor"
  | "command_unmeasured";

export type TopFile = { filePath: string; calls: number; measuredBytes: number };

export type ExposureGroup = {
  cause: ExposureCause;
  calls: number;
  measuredCalls: number;
  measuredBytes: number;
  estTokens: number;
  unmeasuredCalls: number;
  uniqueFiles: number;
  topFiles: TopFile[];
  remediation: string | null;
  caveat: string | null;
};

// Minimal event view: the fields the windowed fold needs. origin absent =
// PostToolUse (and every pre-wave-2 row); "exec-rewrite" = LD8.
export type MediatedEvent = {
  createdAt: string;
  rawBytes: number;
  returnedBytes: number;
  origin?: "exec-rewrite" | undefined;
};

export type MediatedFold = { calls: number; rawBytes: number; returnedBytes: number };

export type ExposureScanInput = {
  hookLogPresent: boolean;
  rows: readonly HookLogRow[];
  activation: { enabled: boolean; mode: TokenSaverMode } | null;
  floorFor: (tool: string) => number;
  coveredTool: (tool: string) => boolean;
  sizeOf: (filePath: string) => number | undefined;
  mediatedEvents: readonly MediatedEvent[];
};

export type ExposureReport = {
  hookLogPresent: boolean;
  saverEnabled: boolean;
  mode: TokenSaverMode | null;
  window: { from: string; to: string } | null;
  groups: ExposureGroup[];
  aboveFloor: { calls: number; measuredBytes: number } | null;
  unmeasuredCalls: number;
  mediated: { execRewrite: MediatedFold | null; postToolUse: MediatedFold | null };
  hint: string | null;
};

// Mirrors HOOK_MISSING_HINT discipline (metrics.ts): absent evidence yields
// an install suggestion, never a fabricated number.
export const DISCOVER_HOOK_MISSING_HINT =
  "No hook telemetry found. Exposure cannot be measured. Run: mega hooks install claude-code";

export const COMMAND_UNMEASURED_CAVEAT =
  "hook log is metadata-only — rewritten (exec-rewrite covered) and bypassed command calls are indistinguishable per row; the mediated lines carry the rewrite evidence. Levers: widen the exec-rewrite allowlist, or enable a smaller floor mode.";

export const BELOW_FLOOR_CAVEAT =
  "smaller floors mean more rewrites; the billed net effect is unmeasured (A4 open) — this is a coverage fact, not a savings promise.";

const NEXT_SMALLER_MODE: Record<TokenSaverMode, TokenSaverMode | null> = {
  safe: "balanced",
  balanced: "aggressive",
  aggressive: null,
};

function remediationFor(cause: ExposureCause, mode: TokenSaverMode | null): string | null {
  switch (cause) {
    case "workspace_disabled":
      return "mega session saver workspace enable";
    case "source_uncovered":
      return "none — Mega Saver coverage gap (report the tool name upstream)";
    case "mcp_unproxied":
      return "mega mcp install";
    case "command_unmeasured":
      return null;
    case "below_floor": {
      const next = mode === null ? null : NEXT_SMALLER_MODE[mode];
      return next === null
        ? "already at the smallest floor (aggressive)"
        : `mega session saver workspace enable --mode ${next}`;
    }
  }
}

function caveatFor(cause: ExposureCause): string | null {
  if (cause === "below_floor") return BELOW_FLOOR_CAVEAT;
  if (cause === "command_unmeasured") return COMMAND_UNMEASURED_CAVEAT;
  return null;
}

type MutableGroup = {
  calls: number;
  measuredCalls: number;
  measuredBytes: number;
  unmeasuredCalls: number;
  files: Map<string, { calls: number; measuredBytes: number }>;
};

const MAX_TOP_FILES = 5;

export function scanExposure(input: ExposureScanInput): ExposureReport {
  const enabled = input.activation?.enabled === true;
  const mode = enabled && input.activation !== null ? input.activation.mode : null;
  const empty = (): MutableGroup => ({
    calls: 0,
    measuredCalls: 0,
    measuredBytes: 0,
    unmeasuredCalls: 0,
    files: new Map(),
  });
  const groups = new Map<ExposureCause, MutableGroup>();
  let unmeasuredCalls = 0;
  let windowFromEpoch: number | null = null;
  let windowToEpoch: number | null = null;
  let fromRaw: string | null = null;
  let toRaw: string | null = null;
  let aboveFloorCalls = 0;
  let aboveFloorBytes = 0;

  const add = (cause: ExposureCause, r: HookLogRow, size: number | undefined): void => {
    const g = groups.get(cause) ?? empty();
    g.calls += 1;
    if (size === undefined) {
      g.unmeasuredCalls += 1;
    } else {
      g.measuredCalls += 1;
      g.measuredBytes += size;
      if (r.filePath !== undefined) {
        const f = g.files.get(r.filePath) ?? { calls: 0, measuredBytes: 0 };
        f.calls += 1;
        f.measuredBytes += size;
        g.files.set(r.filePath, f);
      }
    }
    groups.set(cause, g);
  };

  if (input.hookLogPresent) {
    for (const r of input.rows) {
      // Epoch comparison, never lexicographic: event offsets may differ.
      const t = Date.parse(r.timestamp);
      if (!Number.isNaN(t)) {
        if (windowFromEpoch === null || t < windowFromEpoch) {
          windowFromEpoch = t;
          fromRaw = r.timestamp;
        }
        if (windowToEpoch === null || t > windowToEpoch) {
          windowToEpoch = t;
          toRaw = r.timestamp;
        }
      }
      const size = r.filePath === undefined ? undefined : input.sizeOf(r.filePath);
      if (!enabled) {
        add("workspace_disabled", r, size);
        continue;
      }
      if (!input.coveredTool(r.tool)) {
        add("source_uncovered", r, size);
        continue;
      }
      if (r.category === "eligible_mcp") {
        add("mcp_unproxied", r, undefined);
        continue;
      }
      if (r.category === "eligible_command") {
        add("command_unmeasured", r, undefined);
        continue;
      }
      if (size !== undefined) {
        if (size <= input.floorFor(r.tool)) add("below_floor", r, size);
        else {
          aboveFloorCalls += 1;
          aboveFloorBytes += size;
        }
        continue;
      }
      unmeasuredCalls += 1;
    }
  }

  const finalized: ExposureGroup[] = [...groups.entries()]
    .map(([cause, g]) => ({
      cause,
      calls: g.calls,
      measuredCalls: g.measuredCalls,
      measuredBytes: g.measuredBytes,
      estTokens: tokensFromBytes(g.measuredBytes),
      unmeasuredCalls: g.unmeasuredCalls,
      uniqueFiles: g.files.size,
      topFiles: [...g.files.entries()]
        .map(([filePath, f]) => ({ filePath, calls: f.calls, measuredBytes: f.measuredBytes }))
        .sort(
          (a, b) =>
            b.measuredBytes - a.measuredBytes ||
            b.calls - a.calls ||
            a.filePath.localeCompare(b.filePath),
        )
        .slice(0, MAX_TOP_FILES),
      remediation: remediationFor(cause, mode),
      caveat: caveatFor(cause),
    }))
    .sort(
      (a, b) =>
        b.measuredBytes - a.measuredBytes || b.calls - a.calls || a.cause.localeCompare(b.cause),
    );

  const fold = (origin: "exec-rewrite" | "postToolUse"): MediatedFold | null => {
    if (windowFromEpoch === null || windowToEpoch === null) return null;
    let calls = 0;
    let rawBytes = 0;
    let returnedBytes = 0;
    for (const e of input.mediatedEvents) {
      if (origin === "exec-rewrite" ? e.origin !== "exec-rewrite" : e.origin === "exec-rewrite") {
        continue;
      }
      const t = Date.parse(e.createdAt);
      if (Number.isNaN(t) || t < windowFromEpoch || t > windowToEpoch) continue;
      calls += 1;
      rawBytes += e.rawBytes;
      returnedBytes += e.returnedBytes;
    }
    return calls === 0 ? null : { calls, rawBytes, returnedBytes };
  };

  return {
    hookLogPresent: input.hookLogPresent,
    saverEnabled: enabled,
    mode,
    window: fromRaw !== null && toRaw !== null ? { from: fromRaw, to: toRaw } : null,
    groups: finalized,
    aboveFloor:
      aboveFloorCalls === 0 ? null : { calls: aboveFloorCalls, measuredBytes: aboveFloorBytes },
    unmeasuredCalls,
    mediated: { execRewrite: fold("exec-rewrite"), postToolUse: fold("postToolUse") },
    hint: input.hookLogPresent ? null : DISCOVER_HOOK_MISSING_HINT,
  };
}
