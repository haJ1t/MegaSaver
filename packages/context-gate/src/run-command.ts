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
import { type FilterOutputResult, filterOutput } from "@megasaver/output-filter";
import {
  type PolicyDenyCode,
  type ProjectPermissions,
  evaluateCommand,
  redact,
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
import {
  type LoadProjectPermissions,
  defaultNewId,
  defaultNow,
  resolveEffectiveSettings,
  resolveOverlayEffectiveSettings,
} from "./read.js";
import type { OrchestratorRegistry } from "./registry-port.js";
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

type Capture = {
  raw: string;
  terminated?: "timeout" | "max_bytes";
  childExitCode: number | null;
};

type SpawnOutcome =
  | { ok: true; capture: Capture }
  | { ok: false; reason: "command_failed"; detail: string };

// Spawn the child, combine stdout+stderr in arrival order, and enforce the two
// caller bounds (timeout, max-bytes). On either bound the child is killed but
// the partial capture is returned (a partial chunkSet beats none, §3.5). The
// manual timer is used (not spawn's `timeout` option) so we own the signal.
function runChild(input: {
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
  const filtered = await filterOutput({
    raw: outcome.capture.raw,
    intent: input.intent,
    mode: settings.mode,
    ...(maxReturnedBytes !== undefined ? { maxReturnedBytes } : {}),
    source: { kind: "command", command: input.command, args: input.args },
  });

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
  if (outcome.capture.childExitCode !== 0 || outcome.capture.terminated !== undefined) {
    // Best-effort telemetry: capture writes to disk (json-directory registry),
    // and an auxiliary write must never break command-output delivery. Swallow
    // capture failures so the command result is still returned. Not a silent
    // retry — a genuinely degraded auxiliary concern.
    // SessionFailure ids must be uuids; newId is a caller-injectable determinism
    // hook that can be non-uuid, so mint the id directly.
    try {
      input.registry.createSessionFailure({
        id: randomUUID() as SessionFailureId,
        projectId: settings.projectId,
        sessionId: input.sessionId,
        command: [input.command, ...input.args].join(" "),
        errorOutput: outcome.capture.raw.slice(0, 4000),
        source: "proxy-classifier",
        createdAt: now(),
      });
    } catch {}
  }

  // On a forced termination the partial output is still processed; surface the
  // cause both as a warning (alongside any redaction warning) and the typed
  // `terminated` field (§3.5).
  const resultWarnings =
    outcome.capture.terminated !== undefined
      ? [...warnings, `terminated: ${outcome.capture.terminated}`]
      : warnings;
  let result: ExecResult = {
    ...filtered,
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
  const filtered = await filterOutput({
    raw: outcome.capture.raw,
    intent: input.intent,
    mode: settings.mode,
    ...(maxReturnedBytes !== undefined ? { maxReturnedBytes } : {}),
    source: { kind: "command", command: input.command, args: input.args },
  });

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

  const resultWarnings =
    outcome.capture.terminated !== undefined
      ? [...warnings, `terminated: ${outcome.capture.terminated}`]
      : warnings;
  let result: ExecResult = {
    ...filtered,
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
