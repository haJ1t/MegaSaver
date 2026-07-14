import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const HOOK_BLOCK_START = "# MEGA_SAVER_BLOCK_START";
export const HOOK_BLOCK_END = "# MEGA_SAVER_BLOCK_END";
export const HOOK_CREATED_MARKER = "# created-by-mega-saver";

// POSIX single-quote escaping: the store dir may contain spaces.
const shq = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;

export function renderHookBlock(projectId: string, storeDir: string): string {
  return `${HOOK_BLOCK_START}\nmega memory verify ${projectId} --changed --quiet --store ${shq(storeDir)} || true\n${HOOK_BLOCK_END}`;
}

export type HookResult =
  | { ok: true; path: string; deleted: boolean }
  | { ok: false; message: string };

// Confinement (spec §8.2): only ever touches <rootPath>/.git/hooks/post-commit.
// Foreign bytes outside the sentinel block are preserved exactly — replacement
// is a string-index splice, never a line rebuild.
export function installPostCommitHook(opts: {
  rootPath: string;
  projectId: string;
  storeDir: string;
}): HookResult {
  const gitDir = join(opts.rootPath, ".git");
  if (!existsSync(gitDir)) {
    return { ok: false, message: `error: ${opts.rootPath} is not a git repository` };
  }
  const hooksDir = join(gitDir, "hooks");
  const hookPath = join(hooksDir, "post-commit");
  const block = renderHookBlock(opts.projectId, opts.storeDir);

  if (!existsSync(hookPath)) {
    mkdirSync(hooksDir, { recursive: true });
    // Marker on the bootstrap: uninstall may delete the file ONLY when we
    // created it (the marker is the ownership record).
    writeFileSync(hookPath, `#!/bin/sh\n${HOOK_CREATED_MARKER}\n${block}\n`, { mode: 0o755 });
    return { ok: true, path: hookPath, deleted: false };
  }

  const raw = readFileSync(hookPath, "utf8");
  const start = raw.indexOf(HOOK_BLOCK_START);
  const end = raw.indexOf(HOOK_BLOCK_END);
  const next =
    start !== -1 && end !== -1 && end >= start
      ? raw.slice(0, start) + block + raw.slice(end + HOOK_BLOCK_END.length)
      : `${raw}${raw.endsWith("\n") ? "" : "\n"}${block}\n`;
  // Existing file: content only — never touch its mode or add the marker.
  writeFileSync(hookPath, next);
  return { ok: true, path: hookPath, deleted: false };
}

export function uninstallPostCommitHook(opts: { rootPath: string }): HookResult {
  const hookPath = join(opts.rootPath, ".git", "hooks", "post-commit");
  if (!existsSync(hookPath)) return { ok: true, path: hookPath, deleted: false };
  const raw = readFileSync(hookPath, "utf8");
  const start = raw.indexOf(HOOK_BLOCK_START);
  const end = raw.indexOf(HOOK_BLOCK_END);
  if (start === -1 || end === -1 || end < start) {
    return { ok: true, path: hookPath, deleted: false };
  }
  let afterEnd = end + HOOK_BLOCK_END.length;
  if (raw[afterEnd] === "\n") afterEnd += 1;
  const remainder = raw.slice(0, start) + raw.slice(afterEnd);
  const createdByUs = raw.includes(HOOK_CREATED_MARKER);
  const strippedOfOurs = remainder
    .split("\n")
    .filter((line) => line !== "#!/bin/sh" && line !== HOOK_CREATED_MARKER)
    .join("\n");
  if (createdByUs && strippedOfOurs.trim().length === 0) {
    unlinkSync(hookPath);
    return { ok: true, path: hookPath, deleted: true };
  }
  writeFileSync(hookPath, remainder);
  return { ok: true, path: hookPath, deleted: false };
}
