import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

// The single writer for Claude Code's `~/.claude/settings.json`. It is not our
// file and it holds the operator's ANTHROPIC_API_KEY, so every mutation path
// (proxy route edits and hook install/uninstall alike) goes through here — two
// hand-rolled writers is how the mode-preservation invariant got dropped on one
// of them.
export function writeSettingsFile(path: string, settings: unknown): void {
  // Refuse to replace a symlink — never follow it out of the settings dir. Also
  // capture the existing file's mode so a surgical edit preserves the
  // operator's chosen permissions instead of silently reverting to a default.
  let existingMode: number | undefined;
  try {
    const st = lstatSync(path);
    if (st.isSymbolicLink()) throw new Error("refusing symlinked settings");
    existingMode = st.mode & 0o777;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("refusing")) throw e;
    // ENOENT is fine — creating a fresh file (conservative 0600 below).
  }
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${randomUUID()}.tmp`);
  const mode = existingMode ?? 0o600;
  try {
    // fsync the tmp file AND the directory before/after the rename so a crash
    // mid-write can never leave ~/.claude/settings.json truncated or the rename
    // un-journaled — this is the operator's live agent config.
    // Write through one fd rather than writeFileSync-then-reopen: a preserved
    // mode of 0400 makes the reopen fail EACCES. The open mode is subject to
    // umask, so the explicit chmodSync is what actually pins it; it runs on the
    // tmp inode before the rename makes it visible, so there is no window at a
    // wider mode.
    const fd = openSync(tmp, "wx", mode);
    try {
      writeFileSync(fd, `${JSON.stringify(settings, null, 2)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    chmodSync(tmp, mode);
    renameSync(tmp, path);
    if (process.platform !== "win32") {
      const dfd = openSync(dir, "r");
      try {
        fsyncSync(dfd);
      } finally {
        closeSync(dfd);
      }
    }
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}
