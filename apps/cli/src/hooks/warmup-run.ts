import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  type GitDelta,
  appendWarmStartEvent,
  assembleWarmStartBrief,
  readWarmStartState,
  stampWarmStartSeen,
} from "@megasaver/core";
import { checkEntitlement } from "@megasaver/entitlement";
import { z } from "zod";
import { findProjectByCwd } from "../commands/warmup.js";
import { gatherGitDelta } from "../git-delta.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../store.js";

const sessionStartPayloadSchema = z
  .object({ session_id: z.string(), cwd: z.string(), source: z.string() })
  .passthrough();

export type BuildWarmupHookInput = {
  payload: unknown;
  storeRoot: string;
  now: () => number;
  gatherDelta: (cwd: string, lastSeenAt: string | null) => GitDelta | null;
};

// Pure-ish core of the hook, extracted for tests. Contract: NEVER throws —
// every failure returns "" so the SessionStart hook can never block a session.
export async function buildWarmupHookOutput(input: BuildWarmupHookInput): Promise<string> {
  try {
    const parsed = sessionStartPayloadSchema.safeParse(input.payload);
    if (!parsed.success) return "";
    const cwd = parsed.data.cwd;
    const { registry } = await ensureStoreReady(input.storeRoot);
    const project = findProjectByCwd(registry.listProjects(), cwd);
    if (project === null) return "";

    const nowIso = new Date(input.now()).toISOString();
    const lastSeenAt = readWarmStartState(input.storeRoot, project.id)?.lastSeenAt ?? null;
    const reonboardUnlocked = checkEntitlement("savings-analytics", {
      storeRoot: input.storeRoot,
      now: input.now,
    }).entitled;

    const brief = assembleWarmStartBrief({
      projectName: project.name,
      branch: null,
      now: nowIso,
      lastSeenAt,
      reonboardUnlocked,
      timeless: false,
      memories: registry.listMemoryEntries(project.id),
      rules: registry.listProjectRules(project.id),
      failedAttempts: registry.listFailedAttempts(project.id),
      gitDelta: input.gatherDelta(cwd, lastSeenAt),
    });

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
      // advisory
    }
    return brief.text;
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

// Always exits 0; empty stdout on any failure (SessionStart "no output" = no
// injection). A crashing SessionStart hook would block every session — this
// is the one place error handling is not optional.
export async function runWarmupHookFromProcess(): Promise<void> {
  process.exitCode = 0;
  try {
    const raw = readStdinSync().trim();
    if (raw === "") return;
    const payload: unknown = JSON.parse(raw);
    const storeRoot = resolveStorePath(readStoreEnv(undefined));
    const text = await buildWarmupHookOutput({
      payload,
      storeRoot,
      now: () => Date.now(),
      gatherDelta: (cwd, lastSeenAt) => gatherGitDelta(cwd, lastSeenAt),
    });
    if (text !== "") process.stdout.write(text);
  } catch {
    // Swallow — fail-open.
  }
}
