import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { extractFailureSignatures, readGuardCorpus } from "@megasaver/context-gate";
import {
  DEFAULT_GUARD_STATE,
  type GuardCandidate,
  type GuardMatch,
  INPUT_PRICE_PER_MTOK_USD,
  appendGuardEvent,
  formatDollarsSaved,
  guardCandidateCreatedAt,
  guardCandidateErrorOutput,
  guardCandidateId,
  matchGuard,
  normalizeCommand,
  readGuardState,
  writeGuardState,
} from "@megasaver/core";
import { estimateTokens } from "@megasaver/output-filter";
import { z } from "zod";
import { findProjectByCwd } from "../commands/warmup.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../store.js";

const GUARDED_EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

const preToolUsePayloadSchema = z
  .object({
    session_id: z.string(),
    cwd: z.string(),
    tool_name: z.string(),
    tool_input: z.unknown(),
  })
  .passthrough();

export type BuildGuardHookInput = {
  payload: unknown;
  storeRoot: string;
  now: () => number;
};

function asStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

// The edit-context text for the T2 BM25 signal: whatever content fields the
// edit tool carries, joined.
function editText(input: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of ["new_string", "content", "old_string"]) {
    const v = asStr(input[key]);
    if (v !== undefined) parts.push(v);
  }
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  const edits = input["edits"];
  if (Array.isArray(edits)) {
    for (const e of edits) {
      if (typeof e === "object" && e !== null) {
        // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
        const v = asStr((e as Record<string, unknown>)["new_string"]);
        if (v !== undefined) parts.push(v);
      }
    }
  }
  return parts.join(" ");
}

function dollarLine(avoidedTokens: number): string {
  if (avoidedTokens <= 0) return "";
  const dollars = (avoidedTokens / 1_000_000) * INPUT_PRICE_PER_MTOK_USD;
  return ` That failure cost ~${avoidedTokens} tokens (~${formatDollarsSaved(dollars)}, estimated).`;
}

function warnText(match: GuardMatch, avoidedTokens: number): string {
  const c = match.candidate;
  const date = guardCandidateCreatedAt(c).slice(0, 10);
  const tail = guardCandidateErrorOutput(c).trim().slice(-200);
  const cause =
    c.kind === "failed-attempt" && c.attempt.suspectedCause !== undefined
      ? ` Suspected cause: ${c.attempt.suspectedCause}.`
      : "";
  const failed = tail === "" ? "" : ` — failed: ${tail}`;
  return `⛨ Mistake Firewall: you tried this on ${date}${failed}.${cause}${dollarLine(avoidedTokens)} Cumulative retry-cost avoided: mega roi (Pro).`;
}

function recallText(match: GuardMatch): string {
  const resolution =
    match.candidate.kind === "failed-attempt" ? (match.candidate.attempt.resolution ?? "") : "";
  return `⛨ Mistake Firewall: you solved this before: ${resolution}`;
}

function avoidedTokensOf(candidate: GuardCandidate): number {
  if (candidate.kind === "auto-capture") return candidate.row.wastedTokens;
  const err = candidate.attempt.errorOutput;
  return err === undefined ? 0 : estimateTokens(err);
}

// Contract identical to buildWarmupHookOutput: NEVER throws — every failure
// returns "" so a PreToolUse hook can never break a tool call.
export async function buildGuardHookOutput(input: BuildGuardHookInput): Promise<string> {
  try {
    const parsed = preToolUsePayloadSchema.safeParse(input.payload);
    if (!parsed.success) return "";
    const { session_id: sessionId, cwd, tool_name: tool } = parsed.data;
    const ti =
      typeof parsed.data.tool_input === "object" && parsed.data.tool_input !== null
        ? (parsed.data.tool_input as Record<string, unknown>)
        : {};

    let call: import("@megasaver/core").GuardToolCall;
    if (tool === "Bash") {
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      const command = asStr(ti["command"]);
      if (command === undefined || command.trim() === "") return "";
      call = { tool: "Bash", command };
    } else if (GUARDED_EDIT_TOOLS.has(tool)) {
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      const filePath = asStr(ti["file_path"]) ?? asStr(ti["notebook_path"]);
      if (filePath === undefined) return "";
      call = { tool: tool as "Edit", filePath, text: editText(ti) };
    } else {
      return "";
    }

    const { registry } = await ensureStoreReady(input.storeRoot);
    const project = findProjectByCwd(registry.listProjects(), cwd);
    if (project === null) return "";

    const nowIso = new Date(input.now()).toISOString();
    const state = readGuardState(input.storeRoot, project.id) ?? DEFAULT_GUARD_STATE;
    const session = state.sessions[sessionId] ?? { firedIds: [], intercepts: {} };

    const candidates: GuardCandidate[] = [
      ...registry
        .listFailedAttempts(project.id)
        .map((attempt) => ({ kind: "failed-attempt" as const, attempt })),
      ...readGuardCorpus(input.storeRoot, project.id).map((row) => ({
        kind: "auto-capture" as const,
        row,
      })),
    ];
    const match = matchGuard({
      call,
      candidates,
      mutedIds: state.mutedIds,
      firedIds: session.firedIds,
      asOf: nowIso,
    });
    if (match === null) return "";

    const deny = state.mode === "strict" && match.action === "deny-capable";
    const avoidedTokens = avoidedTokensOf(match.candidate);
    const text = match.action === "recall" ? recallText(match) : warnText(match, avoidedTokens);
    const eventId = randomUUID();
    const candidateId = guardCandidateId(match.candidate);

    // Best-effort side writes — a ledger/state failure never suppresses the warn.
    try {
      appendGuardEvent(
        { root: input.storeRoot },
        {
          type: "intercept",
          id: eventId,
          projectId: project.id,
          sessionId,
          matchedId: candidateId,
          matchedKind: match.candidate.kind,
          normalizedCommand: call.tool === "Bash" ? normalizeCommand(call.command) : null,
          tier: match.tier,
          action: deny ? "deny" : match.action === "recall" ? "recall" : "warn",
          avoidedTokens,
          estimated: true,
          createdAt: nowIso,
        },
      );
    } catch {
      /* advisory */
    }
    try {
      const intercepts = { ...session.intercepts };
      if (call.tool === "Bash" && match.action !== "recall") {
        intercepts[eventId] = {
          command: normalizeCommand(call.command),
          signatures: extractFailureSignatures(guardCandidateErrorOutput(match.candidate)),
          candidateId,
        };
      }
      writeGuardState(input.storeRoot, project.id, {
        ...state,
        sessions: {
          ...state.sessions,
          [sessionId]: { firedIds: [...session.firedIds, candidateId], intercepts },
        },
      });
    } catch {
      /* advisory */
    }

    if (deny) {
      return JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: `${text} Override: mega guard mute ${candidateId} — or mega guard mode warn.`,
        },
      });
    }
    // NEVER "allow" — that would bypass the user's permission system.
    return JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: text },
    });
  } catch {
    return "";
  }
}

function readStdinSync(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

// Always exits 0; empty stdout on any failure (PreToolUse "no output" = no
// injection, tool call proceeds untouched).
export async function runGuardHookFromProcess(): Promise<void> {
  process.exitCode = 0;
  try {
    const raw = readStdinSync().trim();
    if (raw === "") return;
    const payload: unknown = JSON.parse(raw);
    const storeRoot = resolveStorePath(readStoreEnv(undefined));
    const text = await buildGuardHookOutput({ payload, storeRoot, now: () => Date.now() });
    if (text !== "") process.stdout.write(text);
  } catch {
    // Swallow — fail-open.
  }
}
