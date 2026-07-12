import type { ChildProcess } from "node:child_process";
import { spawn as nodeSpawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  type ChunkSet,
  type OverlayChunkSet,
  saveChunkSet,
  saveOverlayChunkSet,
} from "@megasaver/content-store";
import {
  type FilterOutputResult,
  engineRankingDisabledByEnv,
  filterOutput,
  finalizeReplayTrace,
  pruneTraceSessions,
  seamTraceEnabledByEnv,
  writeReplayTrace,
} from "@megasaver/output-filter";
import {
  type PolicyDenyCode,
  type ProjectPermissions,
  evaluateCommand,
  redact,
  redactForLedger,
} from "@megasaver/policy";
import {
  type ProjectId,
  type SessionId,
  type TokenSaverMode,
  modeToBudget,
} from "@megasaver/shared";
import type { SessionFailureId } from "@megasaver/shared";
import {
  type OverlayTokenSaverEvent,
  type TokenSaverEvent,
  appendEvent,
  appendOverlayEvent,
} from "@megasaver/stats";
import { appendFirewallEventsFromFilter } from "./firewall-ledger.js";
import { captureGuardCorpusRow } from "./guard-corpus.js";
import { appendOverlayFailure, buildOverlayHints } from "./overlay-failures.js";
import {
  type LoadProjectPermissions,
  defaultNewId,
  defaultNow,
  resolveEffectiveSettings,
  resolveOverlayEffectiveSettings,
} from "./read.js";
import type { OrchestratorRegistry } from "./registry-port.js";
import { buildSessionHints } from "./session-hints.js";
import { applyShownDedup } from "./shown-index.js";
import { messageOf, redactedCount } from "./stats-helpers.js";

// evaluateCommand's `project` field is a vestigial label it never reads — a
// placeholder keeps the policy gate identical for the projectId-free overlay path.
const OVERLAY_COMMAND_PROJECT = "overlay" as unknown as ProjectId;

// Injectable spawn so unit tests never start a real process (CRITICAL §12).
export type RunCommandSpawn = typeof nodeSpawn;

export type RunOutputExecInput = {
  registry: OrchestratorRegistry;
  storeRoot: string;
  sessionId: SessionId;
  command: string;
  args: readonly string[];
  intent: string;
  // Computed by the CLI wrapper from process.env.MEGASAVER_ORIGIN_PID (or the
  // root pid) and injected so the orchestrator never reads process.env itself.
  originPid: string;
  timeoutMs: number;
  maxBytes: number;
  spawn?: RunCommandSpawn;
  now?: () => string;
  newId?: () => string;
  // Injectable project-permissions loader (default = real fs+yaml loader) so
  // tests drive absent/valid/throwing without a real file (permissions-yaml §5.2).
  loadPermissions?: LoadProjectPermissions;
};

export type ExecResult = FilterOutputResult & {
  childExitCode: number | null;
  terminated?: "timeout" | "max_bytes";
};

export type RunOutputExecResult =
  | { ok: true; result: ExecResult }
  | { ok: false; reason: "session_not_found" }
  | { ok: false; reason: "policy_load_failed"; detail: string }
  | { ok: false; reason: "command_denied"; code: PolicyDenyCode }
  | { ok: false; reason: "command_failed"; detail: string }
  | { ok: false; reason: "store_write_failed"; detail: string };

// Grace before SIGKILL after SIGTERM on a forced termination (§3.5).
const KILL_GRACE_MS = 2_000;
// Hard ceiling on the filter budget: 2 * modeToBudget("safe") (§5).
const MAX_RETURNED_CEILING = 2 * modeToBudget("safe");

export type Capture = {
  raw: string;
  terminated?: "timeout" | "max_bytes";
  childExitCode: number | null;
};

export type SpawnOutcome =
  | { ok: true; capture: Capture }
  | { ok: false; reason: "command_failed"; detail: string };

// Exported for `mega bench` (module 7): the paired benchmark reuses this exact
// capture (timeout/max-bytes/kill-grace) instead of replicating it.
// Callers MUST gate via evaluateCommand BEFORE invoking — runChild itself performs no policy check.
// Spawn the child, combine stdout+stderr in arrival order, and enforce the two
// caller bounds (timeout, max-bytes). On either bound the child is killed but
// the partial capture is returned (a partial chunkSet beats none, §3.5). The
// manual timer is used (not spawn's `timeout` option) so we own the signal.
export function runChild(input: {
  spawn: RunCommandSpawn;
  command: string;
  args: readonly string[];
  cwd: string;
  originPid: string;
  timeoutMs: number;
  maxBytes: number;
}): Promise<SpawnOutcome> {
  return new Promise<SpawnOutcome>((resolve) => {
    let child: ChildProcess;
    try {
      child = input.spawn(input.command, [...input.args], {
        cwd: input.cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, MEGASAVER_ORIGIN_PID: input.originPid },
      });
    } catch (err) {
      resolve({ ok: false, reason: "command_failed", detail: messageOf(err) });
      return;
    }

    const buffers: Buffer[] = [];
    let captured = 0;
    let terminated: "timeout" | "max_bytes" | undefined;
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;

    const timeoutTimer = setTimeout(() => {
      terminated = "timeout";
      forceKill();
    }, input.timeoutMs);

    function forceKill(): void {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
    }

    function append(chunk: Buffer): void {
      if (terminated !== undefined) return;
      const remaining = input.maxBytes - captured;
      if (chunk.length >= remaining) {
        if (remaining > 0) {
          buffers.push(chunk.subarray(0, remaining));
          captured += remaining;
        }
        terminated = "max_bytes";
        forceKill();
        return;
      }
      buffers.push(chunk);
      captured += chunk.length;
    }

    child.stdout?.on("data", (c: Buffer) => append(c));
    child.stderr?.on("data", (c: Buffer) => append(c));

    child.on("error", (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (killTimer !== undefined) clearTimeout(killTimer);
      resolve({ ok: false, reason: "command_failed", detail: err.message });
    });

    child.on("close", (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (killTimer !== undefined) clearTimeout(killTimer);
      resolve({
        ok: true,
        capture: {
          raw: Buffer.concat(buffers).toString("utf8"),
          ...(terminated !== undefined ? { terminated } : {}),
          // A bound-killed child has no meaningful exit code (§3.10).
          childExitCode: terminated !== undefined ? null : code,
        },
      });
    });
  });
}

// Steps 3b–10 of §3: policy gate BEFORE spawn, redact (inside filterOutput)
// BEFORE store, store BEFORE stats. This order is load-bearing and asserted by
// the orchestrator tests (spawn-never-called on every denial branch).
export async function runOutputExecCommand(
  input: RunOutputExecInput,
): Promise<RunOutputExecResult> {
  const resolved = resolveEffectiveSettings(input.registry, input.sessionId, input.loadPermissions);
  // Fail-closed (I3): a present-but-malformed permissions.yaml denies the run
  // here, before any spawn — the gate is shut before IO.
  if (!resolved.ok) {
    return resolved.reason === "policy_load_failed"
      ? { ok: false, reason: "policy_load_failed", detail: resolved.detail }
      : { ok: false, reason: "session_not_found" };
  }
  const { settings } = resolved;

  // Policy gate. The recursive_megasaver conjunct is enforced here via the
  // injected originPid (evaluateCommand compares it against String(process.pid)).
  // The loaded project permissions are the additional tighten-only deny gate (§4.2).
  const verdict = evaluateCommand({
    command: input.command,
    args: input.args,
    project: settings.projectId,
    env: { MEGASAVER_ORIGIN_PID: input.originPid },
    ...(settings.permissions !== null ? { permissions: settings.permissions } : {}),
  });
  if (!verdict.allowed) return { ok: false, reason: "command_denied", code: verdict.reason };

  const spawn = input.spawn ?? nodeSpawn;
  const outcome = await runChild({
    spawn,
    command: input.command,
    args: input.args,
    cwd: settings.projectRoot,
    originPid: input.originPid,
    timeoutMs: input.timeoutMs,
    maxBytes: input.maxBytes,
  });
  if (!outcome.ok) return { ok: false, reason: "command_failed", detail: outcome.detail };

  // filterOutput redacts its `raw` input unconditionally as its first step
  // (BB5) — no separate policy.redact call (§3.6). The filter budget is clamped
  // to the ceiling; the value came from a validated session record.
  const maxReturnedBytes =
    settings.maxReturnedBytes !== undefined
      ? Math.min(settings.maxReturnedBytes, MAX_RETURNED_CEILING)
      : undefined;
  // Failure-aware ranking: the session's prior SessionFailure signatures boost
  // any chunk that references them, so a fresh command's output surfaces the
  // lines tied to what recently broke.
  const { hints: sessionHints, warnings: hintWarnings } = buildSessionHints(
    input.registry,
    settings.projectId,
    input.sessionId,
  );
  const filtered = await filterOutput({
    raw: outcome.capture.raw,
    intent: input.intent,
    mode: settings.mode,
    ...(maxReturnedBytes !== undefined ? { maxReturnedBytes } : {}),
    source: { kind: "command", command: input.command, args: input.args },
    sessionHints,
    // On by default at the seam; MEGASAVER_ENGINE_RANKING=false is the A/B
    // kill switch. Trace recording is also ON by default (MEGASAVER_SEAM_TRACE=
    // {false,0,off,no} disables it), and a recorded trace makes both arms
    // measurable (§P2.6).
    engineRanking: !engineRankingDisabledByEnv(),
    recordTrace: seamTraceEnabledByEnv(),
  });

  appendFirewallEventsFromFilter(
    input.storeRoot,
    {
      at: new Date((input.now ?? defaultNow)()).toISOString(),
      sourcePath: redactForLedger(`${input.command} ${input.args.join(" ")}`.trim()),
      projectId: settings.projectId,
      sessionId: input.sessionId,
    },
    filtered.firewall,
  );

  const warnings = filtered.warnings ?? [];
  const redacted = warnings.some((w) => w.startsWith("redacted"));
  const secretsRedacted = redactedCount(warnings);
  // The command and args are secret-bearing (e.g. `curl -H "Authorization:
  // Bearer ..."`). Redact each before it reaches the persisted chunk-set source
  // and the stats event label — args element-wise, mirroring policyRedactSourceRef.
  const redactedCommand = redact(input.command).redacted;
  const redactedArgs = input.args.map((a) => redact(a).redacted);
  const redactedLabel = [redactedCommand, ...redactedArgs].join(" ");

  const now = input.now ?? defaultNow;
  const newId = input.newId ?? defaultNewId;

  // Ephemeral failure capture: a non-zero exit or a forced termination records
  // a session-scoped SessionFailure that later feeds failure-aware ranking.
  const captureWarnings: string[] = [];
  if (outcome.capture.childExitCode !== 0 || outcome.capture.terminated !== undefined) {
    // Cap the stored evidence: a SessionFailure is an ephemeral per-command
    // record for failure-aware ranking, not the full transcript (the chunkSet
    // holds that). 4000 chars bounds each record so a chatty failing command
    // cannot bloat the session-failure store. Redact the FULL raw output
    // BEFORE slicing: slicing first can cut a secret at the 4000 boundary,
    // leaving a truncated fragment the redactor no longer recognizes.
    const redactedErrorOutput = redact(outcome.capture.raw).redacted.slice(0, 4000);
    // Benign-exit filter: grep/rg/diff/test exit 1 with no output by convention
    // to signal "no match", not a failure. An evidence-free record contributes
    // zero signatures to failure-aware ranking — skip the disk noise. Any other
    // exit code, a termination, or exit 1 WITH output still captures.
    const benignExit =
      outcome.capture.childExitCode === 1 &&
      outcome.capture.terminated === undefined &&
      redactedErrorOutput.trim() === "";
    if (!benignExit) {
      // Best-effort telemetry: capture writes to disk (json-directory registry),
      // and an auxiliary write must never break command-output delivery. On failure
      // we surface a non-fatal warning (§13: no silent swallow) but never rethrow.
      // Not a silent retry — a genuinely degraded auxiliary concern.
      // SessionFailure ids must be uuids; newId is a caller-injectable determinism
      // hook that can be non-uuid, so mint the id directly.
      try {
        input.registry.createSessionFailure({
          id: randomUUID() as SessionFailureId,
          projectId: settings.projectId,
          sessionId: input.sessionId,
          // Redact before persist: the command line is secret-bearing (e.g.
          // `curl -H "Authorization: Bearer ..."`); reuse the already-redacted
          // command/args the label was built from so no raw secret hits disk.
          command: redactedLabel,
          errorOutput: redactedErrorOutput,
          source: "proxy-classifier",
          createdAt: now(),
        });
      } catch (err) {
        captureWarnings.push(`session-failure capture skipped: ${messageOf(err)}`);
      }

      // Durable guard-corpus twin of the ephemeral SessionFailure above: the
      // Mistake Firewall matches against this across sessions (spec §3.1).
      // Same best-effort contract — a corpus write failure never breaks
      // command-output delivery.
      try {
        captureGuardCorpusRow({
          storeRoot: input.storeRoot,
          projectId: settings.projectId,
          command: redactedLabel,
          errorOutput: redactedErrorOutput,
          raw: outcome.capture.raw,
          now: now(),
        });
      } catch (err) {
        captureWarnings.push(`guard corpus capture skipped: ${messageOf(err)}`);
      }
    }
  }

  // On a forced termination the partial output is still processed; surface the
  // cause both as a warning (alongside any redaction warning) and the typed
  // `terminated` field (§3.5). A skipped failure capture or hint source is
  // folded in as a non-fatal warning so a systemic outage is visible, not silent.
  const resultWarnings = [
    ...warnings,
    ...(outcome.capture.terminated !== undefined
      ? [`terminated: ${outcome.capture.terminated}`]
      : []),
    ...captureWarnings,
    ...hintWarnings,
  ];
  // trace + firewall are measurement data (§P2.6): trace is persisted below,
  // firewall feeds only the ledger call — both stripped from the agent-visible
  // result so they never spend the tokens they exist to measure.
  const { trace: rankingTrace, firewall: _firewall, ...filteredSansTrace } = filtered;
  let result: ExecResult = {
    ...filteredSansTrace,
    ...(resultWarnings.length > 0 ? { warnings: resultWarnings } : {}),
    childExitCode: outcome.capture.childExitCode,
    ...(outcome.capture.terminated !== undefined ? { terminated: outcome.capture.terminated } : {}),
  };

  if (settings.storeRawOutput) {
    const chunkSetId = newId();
    const chunkSet: ChunkSet = {
      chunkSetId,
      sessionId: input.sessionId,
      projectId: settings.projectId,
      createdAt: now(),
      source: { kind: "command", command: redactedCommand, args: redactedArgs },
      rawBytes: filtered.rawBytes,
      redacted,
      chunks: filtered.excerpts.map((e, i) => ({
        id: String(i),
        startLine: e.startLine,
        endLine: e.endLine,
        bytes: Buffer.byteLength(e.text, "utf8"),
        text: e.text,
      })),
    };
    try {
      await saveChunkSet({ storeRoot: input.storeRoot, chunkSet });
    } catch (err) {
      return { ok: false, reason: "store_write_failed", detail: messageOf(err) };
    }
    result.chunkSetId = chunkSetId;
    const sessionDir = join(input.storeRoot, "content", settings.projectId, input.sessionId);
    result = applyShownDedup({ result, sessionDir, chunkSetId });
  }

  // Best-effort seam measurement (§P2.6): append the ranking trace to a
  // per-session stats dir — per-session because writeReplayTrace owns the
  // fixed replay-traces.jsonl filename inside the dir it is given.
  if (rankingTrace !== undefined) {
    await writeReplayTrace(
      join(input.storeRoot, "stats", settings.projectId, `${input.sessionId}-traces`),
      finalizeReplayTrace(rankingTrace, {
        sessionId: input.sessionId,
        projectId: settings.projectId,
        toolName: "proxy_run_command",
        createdAt: now(),
        ...(result.chunkSetId !== undefined ? { chunkSetId: result.chunkSetId } : {}),
        redaction: { redacted, secretsRedacted },
      }),
    );
    // Bounds the only always-on new disk (tracing is on by default): cap the
    // retained trace-session dirs. Best-effort — never block or throw into the
    // response path (pruneTraceSessions swallows fs errors, but guard anyway).
    try {
      pruneTraceSessions(input.storeRoot, settings.projectId);
    } catch {
      // swallow — retention is housekeeping, not correctness
    }
  }

  const event: TokenSaverEvent = {
    id: newId(),
    sessionId: input.sessionId,
    projectId: settings.projectId,
    createdAt: now(),
    sourceKind: "command",
    label: redactedLabel,
    rawBytes: filtered.rawBytes,
    returnedBytes: filtered.returnedBytes,
    bytesSaved: filtered.bytesSaved,
    savingRatio: filtered.savingRatio,
    ...(result.chunkSetId !== undefined ? { chunkSetId: result.chunkSetId } : {}),
    summary: filtered.summary,
    mode: settings.mode,
  };
  try {
    appendEvent({
      store: { root: input.storeRoot },
      event,
      secretsRedacted,
      chunksStored: filtered.excerpts.length,
    });
  } catch (err) {
    return { ok: false, reason: "store_write_failed", detail: messageOf(err) };
  }

  return { ok: true, result };
}

// F4 live-first variant of runOutputExecCommand: keyed by (workspaceKey,
// liveSessionId, cwd) with caller-resolved settings — no registry/session.
export type RunOverlayOutputExecInput = {
  storeRoot: string;
  workspaceKey: string;
  liveSessionId: string;
  cwd: string;
  command: string;
  args: readonly string[];
  intent: string;
  originPid: string;
  timeoutMs: number;
  maxBytes: number;
  mode: TokenSaverMode;
  maxReturnedBytes?: number | undefined;
  storeRawOutput: boolean;
  permissions: ProjectPermissions | null;
  spawn?: RunCommandSpawn;
  now?: () => string;
  newId?: () => string;
};

export async function runOverlayOutputExecCommand(
  input: RunOverlayOutputExecInput,
): Promise<RunOutputExecResult> {
  const settings = resolveOverlayEffectiveSettings({
    cwd: input.cwd,
    permissions: input.permissions,
    mode: input.mode,
    maxReturnedBytes: input.maxReturnedBytes,
    storeRawOutput: input.storeRawOutput,
  });

  const verdict = evaluateCommand({
    command: input.command,
    args: input.args,
    project: OVERLAY_COMMAND_PROJECT,
    env: { MEGASAVER_ORIGIN_PID: input.originPid },
    ...(settings.permissions !== null ? { permissions: settings.permissions } : {}),
  });
  if (!verdict.allowed) return { ok: false, reason: "command_denied", code: verdict.reason };

  const spawn = input.spawn ?? nodeSpawn;
  const outcome = await runChild({
    spawn,
    command: input.command,
    args: input.args,
    cwd: settings.cwd,
    originPid: input.originPid,
    timeoutMs: input.timeoutMs,
    maxBytes: input.maxBytes,
  });
  if (!outcome.ok) return { ok: false, reason: "command_failed", detail: outcome.detail };

  const maxReturnedBytes =
    settings.maxReturnedBytes !== undefined
      ? Math.min(settings.maxReturnedBytes, MAX_RETURNED_CEILING)
      : undefined;
  // Failure-aware ranking: prior overlay-store failure signatures boost any
  // chunk that references them, mirroring the registry exec path.
  const { hints: sessionHints, warnings: hintWarnings } = buildOverlayHints(
    input.storeRoot,
    input.workspaceKey,
    input.liveSessionId,
  );
  const filtered = await filterOutput({
    raw: outcome.capture.raw,
    intent: input.intent,
    mode: settings.mode,
    ...(maxReturnedBytes !== undefined ? { maxReturnedBytes } : {}),
    source: { kind: "command", command: input.command, args: input.args },
    sessionHints,
    // Same A/B kill switch as the registry path; overlay trace recording is
    // deferred (§P2.6 keeps measurement scope to the registry sites).
    engineRanking: !engineRankingDisabledByEnv(),
  });

  appendFirewallEventsFromFilter(
    input.storeRoot,
    {
      at: new Date((input.now ?? defaultNow)()).toISOString(),
      sourcePath: redactForLedger(`${input.command} ${input.args.join(" ")}`.trim()),
      projectId: input.workspaceKey,
      sessionId: input.liveSessionId,
    },
    filtered.firewall,
  );

  const warnings = filtered.warnings ?? [];
  const redacted = warnings.some((w) => w.startsWith("redacted"));
  const secretsRedacted = redactedCount(warnings);
  // The command and args are secret-bearing (e.g. `curl -H "Authorization:
  // Bearer ..."`). Redact each before it reaches the persisted chunk-set source
  // and the stats event label — args element-wise, mirroring policyRedactSourceRef.
  const redactedCommand = redact(input.command).redacted;
  const redactedArgs = input.args.map((a) => redact(a).redacted);
  const redactedLabel = [redactedCommand, ...redactedArgs].join(" ");

  const now = input.now ?? defaultNow;
  const newId = input.newId ?? defaultNewId;

  // Ephemeral failure capture: a non-zero exit or a forced termination appends
  // an overlay failure record that later feeds failure-aware ranking — the
  // registry-less mirror of the registry path's SessionFailure capture.
  const captureWarnings: string[] = [];
  if (outcome.capture.childExitCode !== 0 || outcome.capture.terminated !== undefined) {
    // Cap the stored evidence: an overlay failure is an ephemeral per-command
    // record for failure-aware ranking, not the full transcript (the chunkSet
    // holds that). 4000 chars bounds each record so a chatty failing command
    // cannot bloat the overlay failure store. Redact the FULL raw output
    // BEFORE slicing: slicing first can cut a secret at the 4000 boundary,
    // leaving a truncated fragment the redactor no longer recognizes.
    const redactedErrorOutput = redact(outcome.capture.raw).redacted.slice(0, 4000);
    // Benign-exit filter: grep/rg/diff/test exit 1 with no output by convention
    // to signal "no match", not a failure. An evidence-free record contributes
    // zero signatures to failure-aware ranking — skip the disk noise. Any other
    // exit code, a termination, or exit 1 WITH output still captures.
    const benignExit =
      outcome.capture.childExitCode === 1 &&
      outcome.capture.terminated === undefined &&
      redactedErrorOutput.trim() === "";
    if (!benignExit) {
      // Best-effort telemetry: an auxiliary write must never break command-output
      // delivery. On failure we surface a non-fatal warning (§13: no silent
      // swallow) but never rethrow. Not a silent retry — a genuinely degraded
      // auxiliary concern.
      try {
        appendOverlayFailure(input.storeRoot, input.workspaceKey, input.liveSessionId, {
          // Redact before persist: the command line is secret-bearing (e.g.
          // `curl -H "Authorization: Bearer ..."`); reuse the already-redacted
          // command/args the label was built from so no raw secret hits disk.
          command: redactedLabel,
          errorOutput: redactedErrorOutput,
          source: "proxy-classifier",
          createdAt: now(),
        });
      } catch (err) {
        captureWarnings.push(`session-failure capture skipped: ${messageOf(err)}`);
      }
    }
  }

  // On a forced termination the partial output is still processed; surface the
  // cause both as a warning (alongside any redaction warning) and the typed
  // `terminated` field (§3.5). A skipped failure capture or hint source is
  // folded in as a non-fatal warning so a systemic outage is visible, not silent.
  const resultWarnings = [
    ...warnings,
    ...(outcome.capture.terminated !== undefined
      ? [`terminated: ${outcome.capture.terminated}`]
      : []),
    ...captureWarnings,
    ...hintWarnings,
  ];
  // Strip measurement-only fields (trace + firewall) — §P2.6, matching the
  // non-overlay exec path. The ledger already read filtered.firewall above.
  const { trace: _overlayTrace, firewall: _overlayFirewall, ...filteredSansMeta } = filtered;
  let result: ExecResult = {
    ...filteredSansMeta,
    ...(resultWarnings.length > 0 ? { warnings: resultWarnings } : {}),
    childExitCode: outcome.capture.childExitCode,
    ...(outcome.capture.terminated !== undefined ? { terminated: outcome.capture.terminated } : {}),
  };

  if (settings.storeRawOutput) {
    const chunkSetId = newId();
    const chunkSet: OverlayChunkSet = {
      chunkSetId,
      workspaceKey: input.workspaceKey,
      liveSessionId: input.liveSessionId,
      createdAt: now(),
      source: { kind: "command", command: redactedCommand, args: redactedArgs },
      rawBytes: filtered.rawBytes,
      redacted,
      chunks: filtered.excerpts.map((e, i) => ({
        id: String(i),
        startLine: e.startLine,
        endLine: e.endLine,
        bytes: Buffer.byteLength(e.text, "utf8"),
        text: e.text,
      })),
    };
    try {
      await saveOverlayChunkSet({ storeRoot: input.storeRoot, chunkSet });
    } catch (err) {
      return { ok: false, reason: "store_write_failed", detail: messageOf(err) };
    }
    result.chunkSetId = chunkSetId;
    const sessionDir = join(input.storeRoot, "content", input.workspaceKey, input.liveSessionId);
    result = applyShownDedup({ result, sessionDir, chunkSetId });
  }

  const event: OverlayTokenSaverEvent = {
    id: newId(),
    workspaceKey: input.workspaceKey,
    liveSessionId: input.liveSessionId,
    createdAt: now(),
    sourceKind: "command",
    label: redactedLabel,
    rawBytes: filtered.rawBytes,
    returnedBytes: filtered.returnedBytes,
    bytesSaved: filtered.bytesSaved,
    savingRatio: filtered.savingRatio,
    ...(result.chunkSetId !== undefined ? { chunkSetId: result.chunkSetId } : {}),
    summary: filtered.summary,
    mode: settings.mode,
  };
  try {
    appendOverlayEvent({
      store: { root: input.storeRoot },
      event,
      secretsRedacted,
      chunksStored: filtered.excerpts.length,
    });
  } catch (err) {
    return { ok: false, reason: "store_write_failed", detail: messageOf(err) };
  }

  return { ok: true, result };
}
