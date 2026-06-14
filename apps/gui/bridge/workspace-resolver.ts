import { realpath } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import {
  type WorkspaceKey,
  encodeWorkspaceKey,
  workspaceKeySchema,
  workspaceLabel,
} from "@megasaver/shared";

export type ResolvedWorkspace = { workspaceKey: WorkspaceKey; label: string; cwd: string };

export function resolveWorkspace(cwd: string): ResolvedWorkspace {
  return { workspaceKey: encodeWorkspaceKey(cwd), label: workspaceLabel(cwd), cwd };
}

type OverlayFeature = "index" | "rules" | "tools";

// The overlay dir for <feature> must stay inside <storeRoot>/<feature>. The key
// is schema-validated to 16 hex chars (no traversal possible), and we re-check
// containment lexically as defence-in-depth.
export function safeWorkspaceOverlayDir(
  storeRoot: string,
  feature: OverlayFeature,
  key: WorkspaceKey,
): string | null {
  if (!workspaceKeySchema.safeParse(key).success) return null;
  const base = resolve(storeRoot, feature);
  const candidate = resolve(base, key);
  if (candidate !== join(base, key)) return null;
  if (!candidate.startsWith(base + sep)) return null;
  return candidate;
}

// Defence-in-depth for any read under the real cwd (e.g. permissions.yaml): the
// resolved target must remain inside cwd. Mirrors safeSessionPath's lexical-then-
// realpath check.
export async function assertCwdContains(cwd: string, target: string): Promise<boolean> {
  const base = resolve(cwd);
  const candidate = resolve(target);
  if (!candidate.startsWith(base + sep)) return false;
  try {
    const [realBase, realCandidate] = await Promise.all([realpath(base), realpath(candidate)]);
    if (!realCandidate.startsWith(realBase + sep)) return false;
  } catch {
    // base or candidate doesn't exist yet — lexical check already passed.
  }
  return true;
}
