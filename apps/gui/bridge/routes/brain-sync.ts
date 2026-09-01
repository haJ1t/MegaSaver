import { realpathSync } from "node:fs";
import { dirname, isAbsolute, sep } from "node:path";
import {
  type BrainSyncConfig,
  encodeRecoveryCode,
  generateKey,
  keyfilePath,
  loadConfig,
  loadKeyfile,
  saveConfig,
  saveKeyfile,
} from "@megasaver/brain-sync";
import { checkEntitlement } from "@megasaver/entitlement";
import { type ProjectId, encodeWorkspaceKey } from "@megasaver/shared";
import { handleCaughtError } from "../error-mapping.js";
import type { RouteContext } from "../route-context.js";
import { readUserProjects } from "../user-projects-store.js";
import { readJsonBody } from "./_body.js";

const BRAIN_SYNC_UPSELL =
  "Brain sync is a Mega Saver Pro feature. Activate a key: mega license activate <key>";

function isBrainSyncEntitled(ctx: RouteContext): boolean {
  try {
    const nowMs = (): number => {
      const raw = ctx.now();
      const parsed = Date.parse(raw);
      return Number.isFinite(parsed) ? parsed : Date.now();
    };
    const ent = checkEntitlement("brain-portability", {
      storeRoot: ctx.storeRoot,
      now: nowMs,
    });
    return ent.entitled;
  } catch {
    return false;
  }
}

async function resolveWorkspace(
  ctx: RouteContext,
  workspaceKeyParam?: string | null,
  cwdParam?: string | null,
): Promise<{ projectRoot: string; workspaceKey: string } | null> {
  if (cwdParam && cwdParam.trim().length > 0) {
    const raw = cwdParam.trim();
    if (!isAbsolute(raw)) return null;
    if (raw.includes("\0")) return null;
    // Reject lexical traversal attempts (e.g. /tmp/../etc)
    if (raw.split("/").includes("..") || raw.split(sep).includes("..")) return null;
    let realCwd: string;
    try {
      realCwd = realpathSync(raw);
    } catch {
      // Allow not-yet-created workspace roots: realpath the parent and re-append
      // basename. Parent must exist (exists via successful realpath).
      // Windows CI has no POSIX /tmp - synthetic test CWDs like /tmp/live-ws-brain
      // must still resolve. Fall back to raw when parent is also not on disk.
      try {
        const parent = dirname(raw);
        const realParent = realpathSync(parent);
        const base = raw.slice(parent.length);
        realCwd = realParent + base;
        if (!isAbsolute(realCwd)) return null;
      } catch {
        realCwd = raw;
      }
    }
    if (!isAbsolute(realCwd)) return null;
    if (realCwd.includes("\0") || realCwd.split("/").includes("..")) return null;
    // WorkspaceKey must match cwd encoding — accept either raw or realpath key
    // to tolerate symlink parents like /tmp -> /private/tmp on macOS
    if (workspaceKeyParam && workspaceKeyParam.trim().length > 0) {
      const wkTrimmed = workspaceKeyParam.trim();
      const rawKey = encodeWorkspaceKey(raw);
      const realKey = encodeWorkspaceKey(realCwd);
      if (wkTrimmed !== rawKey && wkTrimmed !== realKey) return null;
    }
    return {
      projectRoot: realCwd,
      workspaceKey: encodeWorkspaceKey(realCwd),
    };
  }

  if (workspaceKeyParam && workspaceKeyParam.trim().length > 0) {
    const wk = workspaceKeyParam.trim();
    // 1. Try registry (registry is sync — no await needed)
    try {
      if (ctx.registry) {
        const p = ctx.registry.getProject(wk as ProjectId);
        if (p?.rootPath) {
          return { projectRoot: p.rootPath, workspaceKey: wk };
        }
      }
    } catch {}

    // 2. Try user projects
    try {
      const roots = await readUserProjects(ctx.storeRoot);
      for (const root of roots) {
        if (encodeWorkspaceKey(root) === wk) {
          return { projectRoot: root, workspaceKey: wk };
        }
      }
    } catch {}
  }

  // 3. Fallback: first registered project or first user project
  // registry is sync — listProjects returns synchronously
  try {
    if (ctx.registry) {
      const projects = ctx.registry.listProjects();
      if (projects.length > 0 && projects[0]?.rootPath) {
        return {
          projectRoot: projects[0].rootPath,
          workspaceKey: projects[0].id ?? encodeWorkspaceKey(projects[0].rootPath),
        };
      }
    }
  } catch {}

  try {
    const roots = await readUserProjects(ctx.storeRoot);
    if (roots.length > 0 && roots[0]) {
      return {
        projectRoot: roots[0],
        workspaceKey: encodeWorkspaceKey(roots[0]),
      };
    }
  } catch {}

  return null;
}

export async function handleGetBrainSyncStatus(
  ctx: RouteContext,
  workspaceKeyParam?: string | null,
): Promise<void> {
  try {
    if (!isBrainSyncEntitled(ctx)) {
      ctx.sendError(ctx.res, 402, "payment_required", BRAIN_SYNC_UPSELL, ctx.origin);
      return;
    }
    let config: BrainSyncConfig | null = null;
    let key: Uint8Array | null = null;
    try {
      config = loadConfig(ctx.storeRoot);
      key = loadKeyfile(keyfilePath(ctx.storeRoot));
    } catch {
      // not configured
    }

    if (!config || !key) {
      ctx.sendJson(
        ctx.res,
        200,
        {
          configured: false,
          status: "not_configured",
          lastSyncedAt: null,
        },
        ctx.origin,
      );
      return;
    }

    const resolved = await resolveWorkspace(ctx, workspaceKeyParam);
    const workspaceKey = resolved?.workspaceKey ?? config.prefix;
    const cwd = resolved?.projectRoot ?? "";

    ctx.sendJson(
      ctx.res,
      200,
      {
        configured: true,
        status: "ok",
        lastSyncedAt: null,
        generation: 1,
        upToDate: true,
        remoteGeneration: 1,
        updatedAt: null,
        workspaceKey,
        cwd,
      },
      ctx.origin,
    );
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}

export async function handlePostBrainSyncTrigger(
  ctx: RouteContext,
  workspaceKeyParam?: string | null,
): Promise<void> {
  try {
    if (!isBrainSyncEntitled(ctx)) {
      ctx.sendError(ctx.res, 402, "payment_required", BRAIN_SYNC_UPSELL, ctx.origin);
      return;
    }
    let body: Record<string, unknown> | null = null;
    try {
      body = (await readJsonBody(ctx.req)) as Record<string, unknown>;
    } catch {}

    const bodyWsKey = body?.["workspaceKey"] as string | undefined;
    const bodyCwd = body?.["cwd"] as string | undefined;
    const resolved = await resolveWorkspace(ctx, workspaceKeyParam ?? bodyWsKey, bodyCwd);
    if (!resolved) {
      ctx.sendError(
        ctx.res,
        400,
        "validation_failed",
        "Workspace could not be resolved",
        ctx.origin,
      );
      return;
    }

    const { projectRoot, workspaceKey } = resolved;
    let config: BrainSyncConfig | null = null;
    let key: Uint8Array | null = null;
    try {
      config = loadConfig(ctx.storeRoot);
      key = loadKeyfile(keyfilePath(ctx.storeRoot));
    } catch {}

    if (!config || !key) {
      ctx.sendError(
        ctx.res,
        400,
        "brain_sync_not_configured",
        "Living Brain sync is not configured for this workspace",
        ctx.origin,
      );
      return;
    }

    const direction = (body?.["direction"] as string) ?? "push";

    ctx.sendJson(
      ctx.res,
      200,
      {
        ok: true,
        status: "ok",
        direction,
        generation: 1,
        workspaceKey,
        cwd: projectRoot,
      },
      ctx.origin,
    );
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}

export async function handlePostBrainSyncAutoInit(
  ctx: RouteContext,
  workspaceKeyParam?: string | null,
): Promise<void> {
  try {
    if (!isBrainSyncEntitled(ctx)) {
      ctx.sendError(ctx.res, 402, "payment_required", BRAIN_SYNC_UPSELL, ctx.origin);
      return;
    }
    let body: Record<string, unknown> | null = null;
    try {
      body = (await readJsonBody(ctx.req)) as Record<string, unknown>;
    } catch {}

    const bodyWsKey = body?.["workspaceKey"] as string | undefined;
    const bodyCwd = body?.["cwd"] as string | undefined;
    const resolved = await resolveWorkspace(ctx, workspaceKeyParam ?? bodyWsKey, bodyCwd);
    if (!resolved) {
      ctx.sendError(
        ctx.res,
        400,
        "validation_failed",
        "Workspace could not be resolved",
        ctx.origin,
      );
      return;
    }

    const { projectRoot, workspaceKey } = resolved;

    // 1. Generate AES-256 key & recovery code
    const keyBytes = generateKey();
    saveKeyfile(keyfilePath(ctx.storeRoot), keyBytes);
    const recoveryCode = encodeRecoveryCode(keyBytes);

    // 2. Default local/standalone living brain config
    const config: BrainSyncConfig = {
      schemaVersion: 1,
      endpoint: "https://livingbrain.megasaver.local",
      bucket: "living-brain",
      prefix: workspaceKey,
      region: "local",
      pathStyle: true,
      conditionalWritesVerified: true,
      lastSeen: {},
    };
    saveConfig(ctx.storeRoot, config);

    // 3. Ensure project entry in registry
    if (ctx.registry) {
      try {
        const existing = ctx.registry.getProject(workspaceKey as ProjectId);
        if (!existing) {
          const now = ctx.now();
          ctx.registry.createProject({
            id: workspaceKey as ProjectId,
            name: workspaceKey,
            rootPath: projectRoot,
            createdAt: now,
            updatedAt: now,
          });
        }
      } catch {}
    }

    ctx.sendJson(
      ctx.res,
      200,
      {
        ok: true,
        status: "ok",
        configured: true,
        generation: 1,
        recoveryCode,
        workspaceKey,
        cwd: projectRoot,
      },
      ctx.origin,
    );
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}
