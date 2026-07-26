---
"@megasaver/connector-claude-code": patch
"@megasaver/cli": patch
---

fix: hook install/uninstall no longer widens `~/.claude/settings.json` permissions

`mega hooks install`, `mega hooks uninstall`, `mega init` and the GUI "Connect
Saver hook" toggle all rewrote the operator's global Claude Code settings file
through a temp file created with no mode, so `rename()` swapped in a fresh
inode at `0644` under the default umask. A deliberate `chmod 600` (or `400`) on
a file holding `env.ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` was silently
discarded on every hook write, leaving a live API key world-readable.

All settings writes now go through one hardened writer
(`src/settings-write.ts`, extracted from the existing proxy-route writer):
the existing mode is preserved exactly, a file created fresh is `0600`, the
write is fsynced and atomic, and a read-only preserved mode (`0400`) no longer
fails the write.

**Already-widened files are not healed** — the writer preserves the mode it
finds, so a file a previous install left at `0644` stays there. `mega doctor`
now reports the mode as `claude-code-settings-perms` and warns with
`chmod 600 ~/.claude/settings.json` when the file is group- or world-accessible.
It is a read-only warning: nothing chmods the operator's agent config for them,
and the doctor's exit code is unaffected.

**Behaviour change:** a symlinked `~/.claude/settings.json` (dotfiles-repo
setups) is now **refused with an error** instead of being silently replaced.
Previously the rename destroyed the symlink and orphaned the dotfiles-repo
target, so the operator's tracked file quietly stopped receiving changes.
`mega proxy` already refused symlinks; hook writes now match. Point
`--settings` at the real file, or replace the symlink with a copy.
