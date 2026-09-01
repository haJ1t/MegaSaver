import { existsSync, realpathSync } from "node:fs";
import { sep } from "node:path";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { readHarnessTranscript } from "../claude-sessions/harness-transcript.js";
import { scanAllHarnessSessions } from "../claude-sessions/multi-harness-scanner.js";
import { readTranscript, safeSessionPath } from "../claude-sessions/reader.js";
import type { RouteContext } from "../route-context.js";
import { readUserProjects } from "../user-projects-store.js";

export type ResolvedSessionWorkspace = {
  workspaceKey: string;
  liveSessionId: string;
  cwd: string;
};

// §4.5 resolution contract. Universal & harness-agnostic resolver.
// Resolves Claude Code, Codex, Pi, OpenCode, any 39-harness session, or workspace root.
export async function resolveSessionWorkspace(
  ctx: RouteContext,
  dir: string,
  id: string,
): Promise<ResolvedSessionWorkspace | "unsafe" | "not_found"> {
  const path = await safeSessionPath(ctx.claudeProjectsDir, dir, id);
  if (path === null) return "unsafe";

  // 1. Try reading Claude Code transcript first
  try {
    const transcript = await readTranscript(ctx.claudeProjectsDir, dir, id);
    if (transcript !== null && transcript.projectLabel.length > 0) {
      return {
        workspaceKey: encodeWorkspaceKey(transcript.projectLabel),
        liveSessionId: id,
        cwd: transcript.projectLabel,
      };
    }
  } catch {}

  // 2. Try harness-specific transcript parsers (Codex, Pi, OpenCode)
  const home = ctx.homeDir ?? process.env["HOME"] ?? process.env["USERPROFILE"] ?? "";
  if (home && id !== "_workspace") {
    try {
      const harnessTranscript = await readHarnessTranscript(home, id);
      if (harnessTranscript !== null && harnessTranscript.projectLabel.length > 0) {
        return {
          workspaceKey: encodeWorkspaceKey(harnessTranscript.projectLabel),
          liveSessionId: id,
          cwd: harnessTranscript.projectLabel,
        };
      }
    } catch {}
  }

  // 3. Try multi-harness session scanner
  try {
    if (ctx.storeRoot && id !== "_workspace") {
      const scanned = await scanAllHarnessSessions({
        storeRoot: ctx.storeRoot,
        homeDir: ctx.homeDir,
      });
      const match = scanned.find((s) => s.id === id);
      if (match?.projectLabel && match.projectLabel.length > 0) {
        return {
          workspaceKey: encodeWorkspaceKey(match.projectLabel),
          liveSessionId: id,
          cwd: match.projectLabel,
        };
      }
    }
  } catch {}

  // 4. Workspace-level fallback (for id === "_workspace" or workspace views)
  try {
    const userRoots = await readUserProjects(ctx.storeRoot);
    for (const root of userRoots) {
      const dash = `-${root.slice(1).replace(/\//g, "-")}`;
      if (dir === dash || dir === encodeWorkspaceKey(root) || dir === root) {
        return {
          workspaceKey: encodeWorkspaceKey(root),
          liveSessionId: id,
          cwd: root,
        };
      }
    }
  } catch {}

  // 5. Try registry projects (registry is sync — no await needed)
  try {
    if (ctx.registry) {
      const projects = ctx.registry.listProjects();
      for (const p of projects) {
        const root = p.rootPath;
        if (root) {
          const dash = `-${root.slice(1).replace(/\//g, "-")}`;
          if (dir === dash || dir === p.id || dir === encodeWorkspaceKey(root)) {
            return {
              workspaceKey: encodeWorkspaceKey(root),
              liveSessionId: id,
              cwd: root,
            };
          }
        }
      }
    }
  } catch {}

  // 6. If dir starts with '-' and maps to an existing directory path on disk
  // — oracle hardening: only probe filesystem if candidate is within an allowed root
  // boundary (userRoots or registry roots). Prevents arbitrary existsSync oracle.
  if (dir.startsWith("-")) {
    const candidatePath = `/${dir.slice(1).replace(/-/g, "/")}`;
    if (candidatePath.includes("\0") || candidatePath.split("/").includes("..")) {
      return "not_found";
    }
    // Build allowed roots first — lexical boundary check before any FS probe
    const allowedRoots: string[] = [];
    try {
      const userRoots = await readUserProjects(ctx.storeRoot);
      allowedRoots.push(...userRoots);
    } catch {}
    try {
      if (ctx.registry) {
        const projects = ctx.registry.listProjects();
        for (const p of projects) if (p.rootPath) allowedRoots.push(p.rootPath);
      }
    } catch {}
    const lexicallyAllowed = allowedRoots.some(
      (root) => candidatePath === root || candidatePath.startsWith(root + sep),
    );
    if (!lexicallyAllowed) return "not_found";
    let realCandidate: string;
    try {
      if (!existsSync(candidatePath)) return "not_found";
      realCandidate = realpathSync(candidatePath);
    } catch {
      return "not_found";
    }
    const realAllowed = allowedRoots.some(
      (root) => realCandidate === root || realCandidate.startsWith(root + sep),
    );
    if (!realAllowed) return "not_found";
    return {
      workspaceKey: encodeWorkspaceKey(realCandidate),
      liveSessionId: id,
      cwd: realCandidate,
    };
  }

  return "not_found";
}

// Maps the resolver's failure tokens onto the standard 400/404 responses and
// returns true when it sent a response (caller should stop).
export function sendSessionResolveError(
  ctx: RouteContext,
  outcome: "unsafe" | "not_found",
  dir: string,
  id: string,
): void {
  if (outcome === "unsafe") {
    ctx.sendError(
      ctx.res,
      400,
      "validation_failed",
      `Invalid session path: ${dir}/${id}`,
      ctx.origin,
    );
    return;
  }
  ctx.sendError(
    ctx.res,
    404,
    "claude_session_not_found",
    `Claude session not found: ${dir}/${id}`,
    ctx.origin,
  );
}
