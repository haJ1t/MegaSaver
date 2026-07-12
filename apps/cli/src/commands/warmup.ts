import { type KeyObject, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import {
  type CoreRegistry,
  type GitDelta,
  type Project,
  type WarmStartMode,
  appendWarmStartEvent,
  assembleWarmStartBrief,
  readWarmStartState,
  stampWarmStartSeen,
} from "@megasaver/core";
import { checkEntitlement } from "@megasaver/entitlement";
import { defineCommand } from "citty";
import { gatherGitDelta } from "../git-delta.js";
import {
  type EnsureStoreReadyResult,
  ensureStoreReady,
  readStoreEnv,
  resolveStorePath,
} from "../store.js";

export const WARMUP_WRITE_UPSELL =
  "Cross-agent warm start (--write) is a Mega Saver Pro feature. Activate a key: mega license activate <key>.";

export function findProjectByCwd(projects: readonly Project[], cwd: string): Project | null {
  const matches = projects.filter((p) => cwd === p.rootPath || cwd.startsWith(p.rootPath + sep));
  matches.sort((a, b) => b.rootPath.length - a.rootPath.length);
  return matches[0] ?? null;
}

export type RunWarmupInput = {
  storeRoot: string;
  cwd: string;
  now: () => number;
  budget?: number;
  mode?: WarmStartMode;
  projectName?: string;
  json: boolean;
  write: boolean;
  writeTarget?: string;
  publicKey?: KeyObject | string;
  gatherDelta: (cwd: string, lastSeenAt: string | null) => GitDelta | null;
  ensureStore: () => Promise<EnsureStoreReadyResult>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runWarmup(input: RunWarmupInput): Promise<0 | 1> {
  const { registry } = await input.ensureStore();
  const project =
    input.projectName !== undefined
      ? (registry.listProjects().find((p) => p.name === input.projectName) ?? null)
      : findProjectByCwd(registry.listProjects(), input.cwd);
  if (project === null) {
    input.stderr(`error: no project matches ${input.projectName ?? input.cwd} — run: mega init`);
    return 1;
  }

  const nowIso = new Date(input.now()).toISOString();
  const lastSeenAt = readWarmStartState(input.storeRoot, project.id)?.lastSeenAt ?? null;
  const reonboardUnlocked = checkEntitlement("savings-analytics", {
    storeRoot: input.storeRoot,
    now: input.now,
    ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
  }).entitled;

  if (input.write) {
    const ent = checkEntitlement("brain-portability", {
      storeRoot: input.storeRoot,
      now: input.now,
      ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
    });
    if (!ent.entitled) {
      input.stdout(WARMUP_WRITE_UPSELL);
      return 0;
    }
    return runWarmupWrite(input, registry, project, nowIso, reonboardUnlocked);
  }

  const brief = assembleWarmStartBrief({
    projectName: project.name,
    branch: null,
    now: nowIso,
    ...(input.budget !== undefined ? { budgetTokens: input.budget } : {}),
    ...(input.mode !== undefined ? { mode: input.mode } : {}),
    lastSeenAt,
    reonboardUnlocked,
    timeless: false,
    memories: registry.listMemoryEntries(project.id),
    rules: registry.listProjectRules(project.id),
    failedAttempts: registry.listFailedAttempts(project.id),
    gitDelta: input.gatherDelta(input.cwd, lastSeenAt),
  });

  input.stdout(input.json ? JSON.stringify(brief) : brief.text);
  stampWarmStartSeen(input.storeRoot, project.id, nowIso);
  try {
    appendWarmStartEvent(
      { root: input.storeRoot },
      {
        id: randomUUID(),
        projectId: project.id,
        createdAt: nowIso,
        mode: brief.mode,
        briefTokens: brief.tokenEstimate,
        estimated: true,
      },
    );
  } catch {
    // stats are advisory — never fail the brief over a bad event write
  }
  return 0;
}

async function runWarmupWrite(
  input: RunWarmupInput,
  registry: CoreRegistry,
  project: Project,
  nowIso: string,
  reonboardUnlocked: boolean,
): Promise<0 | 1> {
  const { renderWarmStartBlockText, upsertBlock, readTargetFile, writeTargetFile } = await import(
    "@megasaver/connectors-shared"
  );
  const { KNOWN_TARGETS, isKnownTargetId } = await import("../known-targets.js");
  const { buildConnectorContext } = await import("./connector/shared.js");
  const { invalidTargetMessage } = await import("../errors.js");

  const targetFilter = input.writeTarget ?? "all";
  if (targetFilter !== "all" && !isKnownTargetId(targetFilter)) {
    const cli = invalidTargetMessage(targetFilter);
    input.stderr(cli.message);
    return 1;
  }
  const targets = KNOWN_TARGETS.filter((t) => targetFilter === "all" || t.id === targetFilter);

  const brief = assembleWarmStartBrief({
    projectName: project.name,
    branch: null,
    now: nowIso,
    lastSeenAt: null,
    reonboardUnlocked,
    timeless: true, // sentinel block carries only timeless sections
    memories: registry.listMemoryEntries(project.id),
    rules: registry.listProjectRules(project.id),
    failedAttempts: registry.listFailedAttempts(project.id),
    gitDelta: null,
  });
  const block = renderWarmStartBlockText({ briefText: brief.text, asOf: nowIso });

  const sessions = registry.listSessions(project.id);
  const memoryEntries = registry.listMemoryEntries(project.id);
  let anyFailed = false;
  for (const target of targets) {
    try {
      const absPath = join(project.rootPath, target.relativePath);
      const existing = await readTargetFile(absPath);
      if (existing === null && targetFilter === "all") {
        input.stdout(`${target.id}: skipped (no ${target.relativePath})`);
        continue; // 'all' never creates files; an explicit --target does
      }

      const context = buildConnectorContext(target, project, sessions, memoryEntries);
      const next = upsertBlock({
        existingContent: existing ?? ("header" in target ? (target.header ?? "") : ""),
        context,
        warmStartBlock: block,
      });
      if (existing === null) {
        await mkdir(dirname(absPath), { recursive: true });
      }
      await writeTargetFile({ absPath, content: next });
      input.stdout(`${target.id}: wrote warm-start block (${brief.tokenEstimate} tokens)`);
    } catch (err) {
      anyFailed = true;
      input.stderr(`${target.id}: error — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return anyFailed ? 1 : 0;
}

const MODES = ["auto", "micro", "standard", "reonboard"] as const;

export const warmupCommand = defineCommand({
  meta: {
    name: "warmup",
    description: "Print a budgeted session boot brief assembled from the project brain.",
  },
  args: {
    budget: { type: "string", description: "Token budget (default 2000, min 300, max 8000)." },
    mode: { type: "string", description: "auto|micro|standard|reonboard (default auto)." },
    project: { type: "string", description: "Project name (default: resolve by cwd)." },
    json: { type: "boolean", default: false, description: "Emit the WarmStartBrief as JSON." },
    write: {
      type: "boolean",
      default: false,
      description: "Upsert the brief as a sentinel block into agent files (Mega Saver Pro).",
    },
    target: { type: "string", description: "With --write: connector target or 'all'." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const budget = args.budget === undefined ? undefined : Number.parseInt(String(args.budget), 10);
    if (budget !== undefined && (Number.isNaN(budget) || budget < 300 || budget > 8000)) {
      console.error("error: --budget must be an integer in [300, 8000]");
      process.exitCode = 1;
      return;
    }
    const modeArg = args.mode === undefined ? "auto" : String(args.mode);
    if (!(MODES as readonly string[]).includes(modeArg)) {
      console.error("error: --mode must be one of auto|micro|standard|reonboard");
      process.exitCode = 1;
      return;
    }
    const storeRoot = resolveStorePath(
      readStoreEnv(typeof args.store === "string" ? args.store : undefined),
    );
    const code = await runWarmup({
      storeRoot,
      cwd: process.cwd(),
      now: () => Date.now(),
      ...(budget !== undefined ? { budget } : {}),
      ...(modeArg !== "auto" ? { mode: modeArg as WarmStartMode } : {}),
      ...(typeof args.project === "string" ? { projectName: args.project } : {}),
      json: !!args.json,
      write: !!args.write,
      ...(typeof args.target === "string" ? { writeTarget: args.target } : {}),
      gatherDelta: (cwd, lastSeenAt) => gatherGitDelta(cwd, lastSeenAt),
      ensureStore: () => ensureStoreReady(storeRoot),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
