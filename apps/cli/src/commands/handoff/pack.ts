import { execFile } from "node:child_process";
import { type KeyObject, randomUUID } from "node:crypto";
import { renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ProjectPermissions } from "@megasaver/policy";
import { defineCommand } from "citty";
import { invalidTargetMessage } from "../../errors.js";
import { type ExecGit, gatherDirtyState, gatherGitDelta } from "../../git-delta.js";
import { isKnownTargetId } from "../../known-targets.js";
import {
  type EnsureStoreReadyResult,
  ensureStoreReady,
  readStoreEnv,
  resolveStorePath,
} from "../../store.js";
import { findProjectByCwd } from "../warmup.js";
import { gate, parseExpires } from "./shared.js";

export type RunHandoffPackInput = {
  storeRoot: string;
  cwd: string;
  now: () => number;
  newId: () => string;
  to: string;
  from?: string;
  outPath?: string;
  expires?: string;
  budget?: number;
  dryRun: boolean;
  copy: boolean;
  json: boolean;
  publicKey?: KeyObject | string;
  execGit?: ExecGit;
  copyPath?: (path: string) => void;
  ensureStore: () => Promise<EnsureStoreReadyResult>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

function defaultFileName(projectName: string, nowMs: number): string {
  const d = new Date(nowMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
  return `${projectName}-${stamp}.megahandoff`;
}

function renderResumeInstructions(to: string, from: string, projectName: string): string {
  const source = from === "unknown" ? "another agent" : from;
  return `You are resuming a task handed off from ${source} to ${to} on project "${projectName}". The handoff block below carries the task summary, git state, and known dead ends — continue the work without asking the user to restate it.`;
}

// Scope decision 4: darwin pbcopy of the packet PATH only, best-effort, silent skip elsewhere.
function defaultCopyPath(path: string): void {
  if (process.platform !== "darwin") return;
  try {
    const child = execFile("pbcopy");
    child.on("error", () => {});
    child.stdin?.end(path);
  } catch {
    // clipboard is best-effort
  }
}

export async function runHandoffPack(input: RunHandoffPackInput): Promise<0 | 1> {
  if (!isKnownTargetId(input.to)) {
    input.stderr(invalidTargetMessage(input.to).message);
    return 1;
  }
  const expiresAt = parseExpires(input.expires, input.now());
  if (expiresAt === null) {
    input.stderr(`error: invalid --expires "${String(input.expires)}", expected <n>h or <n>d`);
    return 1;
  }
  // --dry-run is the free read-only surface; the gate applies to real packs only.
  if (!input.dryRun && !gate(input)) return 0;

  // Lazy import after the gate: never load core's packer on the free path.
  const {
    DEFAULT_WARM_START_BUDGET,
    appendHandoffEvent,
    buildHandoffPacket,
    serializeHandoffPacket,
  } = await import("@megasaver/core");
  const { loadProjectPermissions } = await import("@megasaver/context-gate");

  const { registry } = await input.ensureStore();
  const project = findProjectByCwd(registry.listProjects(), input.cwd);
  if (project === null) {
    input.stderr(`error: no project matches ${input.cwd} — run: mega init`);
    return 1;
  }

  // Latest open session across ALL agents — --from is manifest metadata, never a session filter.
  const openSessions = registry.listSessions(project.id).filter((s) => s.endedAt === null);
  const session =
    openSessions.length === 0
      ? null
      : openSessions.reduce((latest, current) =>
          Date.parse(current.startedAt) > Date.parse(latest.startedAt) ? current : latest,
        );

  let permissions: ProjectPermissions | null;
  try {
    permissions = loadProjectPermissions(project.rootPath);
  } catch (e) {
    input.stderr(
      `error: ${join(project.rootPath, ".megasaver", "permissions.yaml")} is malformed — pack aborted: ${e instanceof Error ? e.message : String(e)}`,
    );
    return 1;
  }

  const nowMs = input.now();
  const gitDelta = gatherGitDelta(input.cwd, null, input.execGit, new Date(nowMs).toISOString());
  const dirtyState = gatherDirtyState(input.cwd, input.execGit);

  const { packet, report } = buildHandoffPacket({
    projectName: project.name,
    projectId: project.id,
    sourceAgent: input.from ?? "unknown",
    targetAgent: input.to,
    resumeInstructions: renderResumeInstructions(input.to, input.from ?? "unknown", project.name),
    now: nowMs,
    expiresAt,
    memories: registry.listMemoryEntries(project.id),
    failedAttempts: registry.listFailedAttempts(project.id),
    rules: registry.listProjectRules(project.id),
    sessionId: session === null ? null : session.id,
    gitDelta,
    dirtyState,
    permissions,
    budgetTokens: input.budget ?? DEFAULT_WARM_START_BUDGET,
  });

  const notes = (emit: (line: string) => void): void => {
    if (report.noOpenSession) emit("note: no open session — project-scoped content only");
    if (report.degradedGit) emit("note: git unavailable — packet carries no git state");
  };

  if (input.dryRun) {
    if (input.json) {
      input.stdout(
        JSON.stringify({
          status: "dry-run",
          counts: report.counts,
          redactionFindings: report.redactionFindings,
          secretPathsExcluded: report.secretPathsExcluded,
          excludedPaths: report.excludedPaths,
          noOpenSession: report.noOpenSession,
          degradedGit: report.degradedGit,
          badges: report.badges,
        }),
      );
      return 0;
    }
    input.stdout(
      `dry-run: would pack memories ${report.counts.memories} | failures ${report.counts.failures} | diff files ${report.counts.diffFiles} | commits ${report.counts.commits}`,
    );
    input.stdout(
      `redactions ${report.redactionFindings} | secret paths excluded ${report.secretPathsExcluded}`,
    );
    for (const path of report.excludedPaths) input.stdout(`excluded: ${path}`);
    for (const badge of report.badges) input.stdout(`memory ${badge.memoryId}: ${badge.badge}`);
    notes(input.stdout);
    return 0;
  }

  const text = serializeHandoffPacket(packet);
  const path = resolve(input.cwd, input.outPath ?? defaultFileName(project.name, nowMs));
  // One id identifies this pack run: it names the tmp file AND tags the stats
  // event, so a pack correlates with its open at zero schema cost (T9 review).
  const eventId = input.newId();
  const tmp = join(dirname(path), `.${eventId}.megahandoff.tmp`);
  try {
    writeFileSync(tmp, text);
    renameSync(tmp, path);
  } catch {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // tmp may not exist
    }
    input.stderr(`error: cannot write packet to ${path}`);
    return 1;
  }

  try {
    appendHandoffEvent(
      { root: input.storeRoot },
      {
        id: eventId,
        projectId: project.id,
        kind: "pack",
        targetAgent: input.to,
        memories: report.counts.memories,
        failures: report.counts.failures,
        redactionFindings: report.redactionFindings,
        createdAt: new Date(nowMs).toISOString(),
      },
    );
  } catch {
    // stats are advisory — never fail the pack over a bad event write
  }

  if (input.copy) (input.copyPath ?? defaultCopyPath)(path);

  if (input.json) {
    input.stdout(
      JSON.stringify({
        status: "packed",
        path,
        counts: report.counts,
        redactionFindings: report.redactionFindings,
        secretPathsExcluded: report.secretPathsExcluded,
        excludedPaths: report.excludedPaths,
        noOpenSession: report.noOpenSession,
        degradedGit: report.degradedGit,
      }),
    );
    return 0;
  }
  input.stdout(`packed ${path}`);
  input.stdout(
    `memories ${report.counts.memories} | failures ${report.counts.failures} | diff files ${report.counts.diffFiles} | commits ${report.counts.commits} | redactions ${report.redactionFindings}`,
  );
  if (report.secretPathsExcluded > 0) {
    input.stdout(`secret paths excluded: ${report.excludedPaths.join(", ")}`);
  }
  notes(input.stdout);
  return 0;
}

export const handoffPackCommand = defineCommand({
  meta: {
    name: "handoff",
    description:
      "Pack the current task into a .megahandoff packet (Mega Saver Pro; --dry-run free).",
  },
  args: {
    to: { type: "string", required: true, description: "Target agent (codex, claude-code, …)." },
    from: { type: "string", description: "Source agent id recorded in the manifest." },
    out: {
      type: "string",
      description: "Output file path (default <project>-<YYYYMMDD-HHmm>.megahandoff).",
    },
    expires: { type: "string", description: "Packet lifetime, <n>h or <n>d (default 24h)." },
    budget: {
      type: "string",
      description: "Task-summary token budget (default 2000, min 300, max 8000).",
    },
    "dry-run": {
      type: "boolean",
      default: false,
      description: "Print what would be packed; write nothing (free).",
    },
    copy: {
      type: "boolean",
      default: false,
      description: "Copy the packet path to the clipboard (macOS only).",
    },
    json: { type: "boolean", default: false, description: "Emit the pack report as JSON." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const budget = args.budget === undefined ? undefined : Number.parseInt(String(args.budget), 10);
    if (budget !== undefined && (Number.isNaN(budget) || budget < 300 || budget > 8000)) {
      console.error("error: --budget must be an integer in [300, 8000]");
      process.exitCode = 1;
      return;
    }
    const storeRoot = resolveStorePath(
      readStoreEnv(typeof args.store === "string" ? args.store : undefined),
    );
    const code = await runHandoffPack({
      storeRoot,
      cwd: process.cwd(),
      now: () => Date.now(),
      newId: randomUUID,
      to: String(args.to),
      ...(typeof args.from === "string" ? { from: args.from } : {}),
      ...(typeof args.out === "string" ? { outPath: args.out } : {}),
      ...(typeof args.expires === "string" ? { expires: args.expires } : {}),
      ...(budget !== undefined ? { budget } : {}),
      dryRun: args["dry-run"] === true,
      copy: !!args.copy,
      json: !!args.json,
      ensureStore: () => ensureStoreReady(storeRoot),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
