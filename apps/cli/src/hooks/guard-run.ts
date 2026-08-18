import { randomUUID } from "node:crypto";
import { readSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import {
  appendFirewallEvent,
  extractFailureSignatures,
  readGuardCorpus,
} from "@megasaver/context-gate";
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
import { checkConflicts, drainInbox } from "@megasaver/mesh";
import { estimateTokens } from "@megasaver/output-filter";
import { redact } from "@megasaver/policy";
import { z } from "zod";
import { findProjectByCwd } from "../commands/warmup.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../store.js";
import { buildPackageFirewallText } from "./package-firewall-run.js";

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

function toRepoRelative(inputPath: string, cwd: string): string {
  try {
    if (inputPath.length === 0) return inputPath;
    if (isAbsolute(inputPath) && cwd.length > 0) {
      const cwdNorm = cwd.endsWith("/") ? cwd.slice(0, -1) : cwd;
      if (inputPath === cwdNorm) return ".";
      if (inputPath.startsWith(`${cwdNorm}/`)) return inputPath.slice(cwdNorm.length + 1);
      try {
        const rel = relative(cwd, inputPath);
        if (rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel)) return rel;
      } catch {}
    }
    return inputPath;
  } catch {
    return inputPath;
  }
}

function buildMeshConflictWarning(
  storeRoot: string,
  liveSessionId: string,
  cwd: string,
  call: import("@megasaver/core").GuardToolCall,
): string | undefined {
  try {
    const rawPath = call.tool === "Bash" ? call.command : call.filePath;
    if (typeof rawPath !== "string" || rawPath.trim() === "") return undefined;
    // For file edits, convert absolute to repo-relative; for Bash, keep raw but also try relative extraction
    const queryPaths: string[] = [];
    if (call.tool === "Bash") {
      queryPaths.push(rawPath);
      // Also try to extract a repo-relative if command contains cwd-like absolute
      // Best-effort: if command contains an absolute segment starting with cwd, add relative variant
      // Keep simple: push raw only
    } else {
      const rel = toRepoRelative(rawPath, cwd);
      if (rel !== rawPath) queryPaths.push(rel, rawPath);
      else queryPaths.push(rawPath);
    }
    const conflicts = checkConflicts(storeRoot, liveSessionId, queryPaths);
    if (conflicts.length === 0) return undefined;
    const lines = conflicts.map((c) => {
      const paths = c.paths.join(", ");
      const intent = c.intent ? ` — intent: ${c.intent.slice(0, 80)}` : "";
      return `⚠️ peer ${c.liveSessionId} claimed ${paths}${intent}`;
    });
    return lines.join("\n");
  } catch {
    return undefined;
  }
}

function buildMeshInboxSection(storeRoot: string, liveSessionId: string): string | undefined {
  try {
    const all = drainInbox(storeRoot, liveSessionId);
    if (all.length === 0) return undefined;
    const sliced = all.slice(0, 5);
    const headerTokens = 0;
    void headerTokens;
    const lines: string[] = [];
    let usedTokens = 0;
    for (const evt of sliced) {
      const rawLine = `untrusted peer ${evt.from} (${evt.kind}) at ${evt.createdAt}: ${evt.text}`;
      const toks = estimateTokens(rawLine);
      if (usedTokens + toks > 2000) {
        const remaining = 2000 - usedTokens;
        if (remaining > 20) {
          const chars = Math.max(0, remaining * 4 - 20);
          const truncated = rawLine.slice(0, chars);
          lines.push(`${truncated}… [truncated to fit 2000 token budget]`);
          usedTokens = 2000;
        }
        break;
      }
      usedTokens += toks;
      lines.push(rawLine);
    }
    if (lines.length === 0) return undefined;
    const overflowNote =
      all.length > sliced.length
        ? ` (+${all.length - sliced.length} more drained but bounded to 5)`
        : "";
    const truncatedNote = sliced.length > lines.length ? " (truncated to 2000 token budget)" : "";
    const header = `[Mesh Inbox — untrusted peer messages — ${lines.length}/${all.length} shown${overflowNote}${truncatedNote}]`;
    return `${header}\n${lines.join("\n")}`;
  } catch {
    return undefined;
  }
}

// Contract identical to buildWarmupHookOutput: NEVER throws — every failure
// returns "" so a PreToolUse hook can never break a tool call.

// The ONE guard-run composition seam (cross-pair contract, wave-2): shared
// with generated-file-fence and session-mesh pairs. Stage order inside the
// seam: mistake-firewall -> package-firewall. Mesh is NOT a stage — it passes
// through as data and is joined by the seam's \n\n delimiter (today's wire);
// the seam's own join is a single \n. On deny the package text is dropped but
// mesh stays. Whichever pair lands first CREATES this seam; later pairs
export type FenceStageResult = { kind: "none" } | { kind: "warn"; text: string };
export type FirewallStageResult =
  | { kind: "none" }
  | { kind: "warn"; text: string }
  | { kind: "deny"; reason: string };
export type PackageFirewallStageResult = { kind: "none" } | { kind: "warn"; text: string };

export function composeGuardOutputs(input: {
  fence?: FenceStageResult | undefined;
  firewall: FirewallStageResult;
  packageFirewall?: PackageFirewallStageResult | undefined;
  packageFirewallText?: string | undefined;
  meshAdditional?: string | undefined;
}): string {
  const { fence, firewall, packageFirewall, packageFirewallText, meshAdditional } = input;
  if (firewall.kind === "deny") {
    const hso: Record<string, unknown> = {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: firewall.reason,
    };
    // biome-ignore lint/complexity/useLiteralKeys: tsconfig noPropertyAccessFromIndexSignature requires brackets
    if (meshAdditional !== undefined) hso["additionalContext"] = meshAdditional;
    return JSON.stringify({ hookSpecificOutput: hso });
  }
  const parts: string[] = [];
  if (fence !== undefined && fence.kind === "warn") parts.push(fence.text);
  if (firewall.kind === "warn") parts.push(firewall.text);
  if (packageFirewall !== undefined && packageFirewall.kind === "warn") parts.push(packageFirewall.text);
  if (packageFirewallText !== undefined && packageFirewallText.length > 0) parts.push(packageFirewallText);
  const joined = parts.join("\n");
  const context =
    meshAdditional !== undefined
      ? joined === ""
        ? meshAdditional
        : `${joined}\n\n${meshAdditional}`
      : joined;
  if (context === "") return "";
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: context },
  });
}

type GuardCall = import("@megasaver/core").GuardToolCall;
type GuardRegistry = import("@megasaver/core").CoreRegistry;

async function firewallStage(input: {
  storeRoot: string;
  sessionId: string;
  project: ReturnType<typeof findProjectByCwd>;
  registry: GuardRegistry;
  call: GuardCall;
  now: () => number;
}): Promise<FirewallStageResult> {
  const { storeRoot, sessionId, project, registry, call, now } = input;
  if (project === null) return { kind: "none" };
  const nowIso = new Date(now()).toISOString();
  const state = readGuardState(storeRoot, project.id) ?? DEFAULT_GUARD_STATE;
  const session = state.sessions[sessionId] ?? { firedIds: [], intercepts: {} };

  const candidates: GuardCandidate[] = [
    ...registry
      .listFailedAttempts(project.id)
      .map((attempt) => ({ kind: "failed-attempt" as const, attempt })),
    ...readGuardCorpus(storeRoot, project.id).map((row) => ({
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
  if (match === null) return { kind: "none" };

  const deny = state.mode === "strict" && match.action === "deny-capable";
  const avoidedTokens = avoidedTokensOf(match.candidate);
  const text = match.action === "recall" ? recallText(match) : warnText(match, avoidedTokens);
  const eventId = randomUUID();
  const candidateId = guardCandidateId(match.candidate);
  // The agent's raw command may carry inline secrets (`curl -H "Authorization:
  // Bearer …"`); redact BEFORE it is persisted to the events ledger / state.
  // Matching (matchGuard above) uses the raw command in-memory and never
  // persists it. The outcome loop applies the same redact+normalize so its
  // re-run lookup still matches this stored value.
  const storedCommand =
    call.tool === "Bash" ? normalizeCommand(redact(call.command).redacted) : null;

  // Best-effort side writes — a ledger/state failure never suppresses the warn.
  try {
    appendGuardEvent(
      { root: storeRoot },
      {
        type: "intercept",
        id: eventId,
        projectId: project.id,
        sessionId,
        matchedId: candidateId,
        matchedKind: match.candidate.kind,
        normalizedCommand: storedCommand,
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
  // A strict DENY blocks the command (never executed) and must keep firing on
  // retry until the user mutes it or switches to warn — so it does NOT consume
  // the per-session cooldown and records no intercept (nothing to classify).
  // Only a delivered warn/recall fires once per session.
  if (!deny) {
    try {
      const intercepts = { ...session.intercepts };
      if (call.tool === "Bash" && storedCommand !== null && match.action !== "recall") {
        intercepts[eventId] = {
          command: storedCommand,
          signatures: extractFailureSignatures(guardCandidateErrorOutput(match.candidate)),
          candidateId,
        };
      }
      writeGuardState(storeRoot, project.id, {
        ...state,
        sessions: {
          ...state.sessions,
          [sessionId]: { firedIds: [...session.firedIds, candidateId], intercepts },
        },
      });
    } catch {
      /* advisory */
    }
  }

  if (deny) {
    return {
      kind: "deny",
      reason: `${text} Override: mega guard mute ${candidateId} — or mega guard mode warn.`,
    };
  }
  return { kind: "warn", text };
}
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

    // Mesh: conflict warning + inbox bounded ≤5/≤2000 tokens + board delta 500 tokens debounced 30s (best-effort, fail-open)
    // Compute before firewall branch so even non-project workspaces get mesh injection.
    let meshConflictWarning: string | undefined;
    let meshInboxSection: string | undefined;
    let boardDelta: string | undefined;
    try {
      meshConflictWarning = buildMeshConflictWarning(input.storeRoot, sessionId, cwd, call);
    } catch {}
    try {
      meshInboxSection = buildMeshInboxSection(input.storeRoot, sessionId);
    } catch {}
    try {
      const { buildBoardDeltaForSession } = await import("./board-inject.js");
      boardDelta = buildBoardDeltaForSession(input.storeRoot, sessionId);
    } catch {}
    const meshAdditional =
      [meshConflictWarning, meshInboxSection, boardDelta].filter(Boolean).join("\n\n") || undefined;

    let fence: FenceStageResult = { kind: "none" };
    if (call.tool !== "Bash" && call.filePath !== undefined) {
      try {
        const { evaluateFenceForWrite } = await import("@megasaver/fence");
        const fenceVerdict = evaluateFenceForWrite({
          cwd,
          filePath: call.filePath,
        });
        if (fenceVerdict.kind === "deny") {
          try {
            appendFirewallEvent(input.storeRoot, {
              at: new Date(input.now()).toISOString(),
              kind: "fence-deny",
              detector: `fence:${fenceVerdict.entry.class}`,
              count: 1,
              sourcePath: fenceVerdict.relPath,
              sessionId,
            });
          } catch {}
          const hso: Record<string, unknown> = {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: fenceVerdict.text,
          };
          return JSON.stringify({ hookSpecificOutput: hso });
        } else if (fenceVerdict.kind === "warn") {
          try {
            appendFirewallEvent(input.storeRoot, {
              at: new Date(input.now()).toISOString(),
              kind: "fence-warn",
              detector: `fence:${fenceVerdict.entry.class}`,
              count: 1,
              sourcePath: fenceVerdict.relPath,
              sessionId,
            });
          } catch {}
          fence = { kind: "warn", text: fenceVerdict.text };
        }
      } catch {}
    }

    const firewall = await firewallStage({
      storeRoot: input.storeRoot,
      sessionId,
      project,
      registry,
      call,
      now: input.now,
    });

    // Computed INDEPENDENTLY of the project lookup: the package firewall is
    // store-scoped and must fire with no registered project, so the firewall
    // stage's project === null short-circuit must not suppress it. Fail-open:
    // any failure or "" ⇒ { kind: "none" }.
    let packageFirewall: PackageFirewallStageResult = { kind: "none" };
    try {
      const text = await buildPackageFirewallText({
        payload: input.payload,
        storeRoot: input.storeRoot,
        now: input.now,
      });
      if (text !== "") packageFirewall = { kind: "warn", text };
    } catch {
      packageFirewall = { kind: "none" };
    }

    // NEVER "allow" — that would bypass the user's permission system.
    return composeGuardOutputs({
      fence,
      firewall,
      packageFirewall,
      meshAdditional,
    });
  } catch {
    return "";
  }
}

export async function handleGuard(
  input: {
    tool?: string;
    path?: string;
    storeRoot: string;
    liveSessionId: string;
    cwd?: string;
    command?: string;
  } & Record<string, unknown>,
): Promise<{ additionalContext?: string }> {
  try {
    const tool =
      (input.tool as string | undefined) ?? (input.command !== undefined ? "Bash" : "Edit");
    const filePath =
      (input.path as string | undefined) ?? (input as { filePath?: string }).filePath;
    const command =
      (input.command as string | undefined) ??
      (typeof input.path === "string" && tool === "Bash" ? (input.path as string) : undefined);
    const cwd = (input.cwd as string | undefined) ?? "/tmp";
    const sessionId = input.liveSessionId;
    const payload: unknown =
      tool === "Bash"
        ? {
            session_id: sessionId,
            cwd,
            tool_name: "Bash",
            tool_input: { command: command ?? filePath ?? "echo" },
          }
        : {
            session_id: sessionId,
            cwd,
            tool_name: tool,
            tool_input: { file_path: filePath ?? input.path },
          };
    const out = await buildGuardHookOutput({
      payload,
      storeRoot: input.storeRoot,
      now: () => Date.now(),
    });
    if (out === "") return {};
    const parsed = JSON.parse(out) as {
      hookSpecificOutput?: { additionalContext?: string; permissionDecisionReason?: string };
    };
    const ctx =
      parsed.hookSpecificOutput?.additionalContext ??
      parsed.hookSpecificOutput?.permissionDecisionReason;
    return ctx ? { additionalContext: ctx } : {};
  } catch {
    return {};
  }
}

export const MAX_GUARD_STDIN_BYTES = 256 * 1024;

function readStdinSync(): string | undefined {
  try {
    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= MAX_GUARD_STDIN_BYTES) {
      const capacity = Math.min(8192, MAX_GUARD_STDIN_BYTES - total + 1);
      const chunk = Buffer.allocUnsafe(capacity);
      const read = readSync(0, chunk, 0, capacity, null);
      if (read === 0) return Buffer.concat(chunks, total).toString("utf8");
      total += read;
      if (total > MAX_GUARD_STDIN_BYTES) return undefined;
      chunks.push(chunk.subarray(0, read));
    }
    return undefined;
  } catch {
    return undefined;
  }
}

// Always exits 0; empty stdout on any failure (PreToolUse "no output" = no
// injection, tool call proceeds untouched).
export async function runGuardHookFromProcess(storeFlag?: string): Promise<void> {
  process.exitCode = 0;
  try {
    const input = readStdinSync();
    if (input === undefined) return;
    const raw = input.trim();
    if (raw === "") return;
    const payload: unknown = JSON.parse(raw);
    const storeRoot = resolveStorePath(readStoreEnv(storeFlag));
    const text = await buildGuardHookOutput({ payload, storeRoot, now: () => Date.now() });
    if (text !== "") process.stdout.write(text);
  } catch {
    // Swallow — fail-open.
  }
}
