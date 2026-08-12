import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { canonicalFamilyPath, familyKeyFromPath } from "@megasaver/context-gate";
import {
  type GitDelta,
  appendWarmStartEvent,
  assembleWarmStartBrief,
  readWarmStartState,
  stampWarmStartSeen,
} from "@megasaver/core";
import { checkEntitlement } from "@megasaver/entitlement";
import { registerSession } from "@megasaver/mesh";
import { encodeWorkspaceKey } from "@megasaver/shared";
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

const SAFE_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function tryRegisterMeshSession(
  storeRoot: string,
  payload: unknown,
  branch: string | null | undefined,
  now: () => number,
): void {
  try {
    const parsed = sessionStartPayloadSchema.safeParse(payload);
    if (!parsed.success) return;
    const cwd = parsed.data.cwd;
    const liveSessionId = parsed.data.session_id;
    if (typeof liveSessionId !== "string" || typeof cwd !== "string") return;
    if (!SAFE_SEGMENT_RE.test(liveSessionId)) return;
    const workspaceKey = encodeWorkspaceKey(cwd);
    let repositoryFamilyKey: string | undefined;
    try {
      const canon = canonicalFamilyPath(cwd, process.platform, {
        realpathNative: (p: string) => p,
        caseMode: () =>
          process.platform === "darwin" || process.platform === "win32"
            ? "insensitive"
            : "sensitive",
      });
      const fk = familyKeyFromPath(process.platform, canon.caseMode, canon.canonicalPath);
      repositoryFamilyKey = fk.key;
    } catch {}
    const rec = {
      liveSessionId,
      agent: "claude-code",
      status: "working" as const,
      lastSeenAt: new Date(now()).toISOString(),
      workspaceKey,
      ...(repositoryFamilyKey !== undefined ? { repositoryFamilyKey } : {}),
      cwd,
      ...(typeof branch === "string" && branch.length > 0 ? { branch } : {}),
    };
    registerSession(storeRoot, rec as never);
  } catch {}
}

// Pure-ish core of the hook, extracted for tests. Contract: NEVER throws —
// every failure returns "" so the SessionStart hook can never block a session.
export async function buildWarmupHookOutput(input: BuildWarmupHookInput): Promise<string> {
  try {
    const parsed = sessionStartPayloadSchema.safeParse(input.payload);
    if (!parsed.success) return "";
    const cwd = parsed.data.cwd;
    const { registry } = await ensureStoreReady(input.storeRoot);
    const project = findProjectByCwd(registry.listProjects(), cwd);
    let earlyBranch: string | null = null;
    if (project === null) {
      // Still register mesh presence even without project.
      try {
        const tempDelta = input.gatherDelta(cwd, null);
        earlyBranch = tempDelta?.branch ?? null;
      } catch {}
      tryRegisterMeshSession(input.storeRoot, input.payload, earlyBranch, input.now);
      // Board digest even without project (repo-scoped)
      try {
        const { buildBoardDigestForSession } = await import("./board-inject.js");
        const liveSessionId = (parsed.data as { session_id: string }).session_id;
        const digest = buildBoardDigestForSession(input.storeRoot, liveSessionId);
        if (digest) return digest;
      } catch {}
      return "";
    }

    const nowIso = new Date(input.now()).toISOString();
    const lastSeenAt = readWarmStartState(input.storeRoot, project.id)?.lastSeenAt ?? null;
    const reonboardUnlocked = checkEntitlement("savings-analytics", {
      storeRoot: input.storeRoot,
      now: input.now,
    }).entitled;

    const gitDelta = input.gatherDelta(cwd, lastSeenAt);
    // Register mesh presence (best-effort, fail-open) even before brief assembly
    // so live peers show up regardless of brief generation.
    tryRegisterMeshSession(input.storeRoot, input.payload, gitDelta?.branch ?? null, input.now);
    const brief = assembleWarmStartBrief({
      projectName: project.name,
      branch: gitDelta?.branch ?? null,
      now: nowIso,
      lastSeenAt,
      reonboardUnlocked,
      timeless: false,
      memories: registry.listMemoryEntries(project.id),
      rules: registry.listProjectRules(project.id),
      failedAttempts: registry.listFailedAttempts(project.id),
      gitDelta,
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
    // Board SessionStart digest: capped 500 tokens, best-effort fail-open
    try {
      const { buildBoardDigestForSession } = await import("./board-inject.js");
      const liveSessionId = (parsed.data as { session_id: string }).session_id;
      const digest = buildBoardDigestForSession(input.storeRoot, liveSessionId);
      if (digest) return `${brief.text}\n\n${digest}`;
    } catch {}
    return brief.text;
  } catch {
    return "";
  }
}

export async function handleWarmup(payload: unknown, storeRoot?: string): Promise<void> {
  try {
    const root = storeRoot ?? resolveStorePath(readStoreEnv(undefined));
    tryRegisterMeshSession(root, payload, null, Date.now);
  } catch {}
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
export async function runWarmupHookFromProcess(storeFlag?: string): Promise<void> {
  process.exitCode = 0;
  try {
    const raw = readStdinSync().trim();
    if (raw === "") return;
    const payload: unknown = JSON.parse(raw);
    const storeRoot = resolveStorePath(readStoreEnv(storeFlag));
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
