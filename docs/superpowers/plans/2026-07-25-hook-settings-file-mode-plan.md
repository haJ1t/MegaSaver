# Plan — hook settings write must preserve the operator's file mode

Spec: [[docs/superpowers/specs/2026-07-25-hook-settings-file-mode-design]]
Risk: HIGH. Branch `fix/hook-settings-file-mode`, based on `origin/main`.
Package: `@megasaver/connector-claude-code`.

TDD is mandatory here: every behaviour task writes the test first and records
the **red output** before any source edit. A permission test that was never seen
failing proves nothing — the whole defect is a mode that silently differs.

## Steps

1. **Test file scaffold + platform guard.**
   Add `packages/connectors/claude-code/test/hook-settings-permissions.test.ts`
   with a `describeUnlessWindows = process.platform === "win32" ? describe.skip : describe`
   (precedent: `packages/stats/test/_platform.ts`, `proxy-route.test.ts:96`) and a
   `mkdtempSync` fixture that seeds a settings file containing
   `env.ANTHROPIC_API_KEY`.
   → verify: file runs, zero tests, exits 0 on this machine; and the guard is not
   vacuous — flip the condition to `!== "win32"` once and confirm the suite
   reports the tests as *skipped*, not passed. Flip it back.

2. **RED: install preserves an existing restrictive mode.**
   `chmod 0600` → `installClaudeCodeHook` → expect `statSync().mode & 0o777` to be
   `0o600`. Add the `0o640` and `0o400` rows from the spec matrix in the same
   test body or as a `it.each`.
   → verify: run it now, **record the failure verbatim** — expected `600`,
   received `644` (and `400` → `644`). Three rows must fail, not one.

3. **RED: uninstall preserves the mode too, and fresh create is `0600`.**
   `chmod 0600` → `uninstallClaudeCodeHook` on an installed file → still `0600`.
   Separate test: no file on disk → `installClaudeCodeHook` → `0600`.
   → verify: both red, recorded — `644` in each case. This pins that the fix
   covers the write path, not just the install entry point.

4. **RED: install refuses a symlinked settings path.**
   `symlinkSync(realFile, settingsPath)` → `expect(() => installClaudeCodeHook(…)).toThrow()`
   → and assert `lstatSync(settingsPath).isSymbolicLink()` is still true and the
   link target's bytes are unchanged.
   → verify: red at HEAD for the right reason — today it does **not** throw, the
   symlink is replaced by a regular file, and the dotfiles-repo target is
   orphaned. Record that observed clobber; it is the evidence for the R1 note in
   the changeset.

5. **Extract the writer — no behaviour change.**
   New `packages/connectors/claude-code/src/settings-write.ts` exporting
   `writeSettingsFile(path: string, settings: unknown): void`, the body moved
   verbatim from `proxy-route.ts` `writeSettings` (symlink refusal,
   `existingMode ?? 0o600`, `writeFileSync({mode})` + `chmodSync`, file fsync,
   rename, dir fsync on non-win32, `rmSync` on error). Delete the private copy in
   `proxy-route.ts` and import instead. Do **not** touch `hook-settings.ts` yet.
   → verify: `proxy-route.test.ts` green **unmodified** — in particular
   "preserves the existing file's mode across a route edit" and "creates a fresh
   settings file 0600". Steps 2–4 must still be RED at this point; if any turned
   green, the extraction changed more than it should have.

6. **GREEN: point `hook-settings.ts` at the shared writer.**
   Delete its private `writeSettings`; call `writeSettingsFile`. Drop the
   now-orphaned `node:fs` / `node:crypto` / `node:path` imports that only that
   function used, and nothing else.
   → verify: steps 2, 3, 4 all green; whole
   `pnpm --filter @megasaver/connector-claude-code test` green, including the
   pre-existing `hook-settings.test.ts:161` atomicity/no-residue test (R3) and the
   round-trip tests.

7. **Failure-path fence.**
   Test: make the write fail (e.g. settings dir made read-only on posix, inside
   the platform guard) → the original file's bytes **and** mode are unchanged and
   no `.tmp` file remains in the dir.
   → verify: red-proof by stubbing the guard off — confirm the assertion is
   actually reached and can fail, not skipped into a green.

8. **Mutation-verify the fix, not just the tests.**
   Temporarily drop the `chmodSync(tmp, mode)` line, then separately the
   `?? 0o600`, then the symlink `throw` — each mutation must turn a *specific*
   named test red. Revert all three.
   → verify: three mutations, three distinct failures recorded. A test that
   survives its own mutation is not fencing anything.

9. **Records.**
   Changeset (`patch`, `@megasaver/connector-claude-code`) naming the security fix
   **and** the R1 behaviour break: symlinked `~/.claude/settings.json` is now
   refused instead of silently replaced. Update
   `wiki/entities/connectors-claude-code.md` (one writer for the settings file;
   mode preserved, `0600` on create, symlink refused) and append a timestamped
   `wiki/log.md` entry.
   → verify: `pnpm conventions:check` green; wiki claims cite the spec.

10. **Verify + review.**
    `pnpm verify` from the repo root; report executed-vs-cached per turbo.
    → verify: lint + typecheck + all tests green; then `code-reviewer` and
    `critic` in separate fresh contexts (HIGH risk, `docs/conventions/risk-modes.md`),
    author never the reviewer.

## Out of scope

Directory mode of `~/.claude`; symlink refusal on the read path; any change to
the other four call sites (CLI install / uninstall / init, GUI route) — they
inherit the fix through the shared writer. See spec §5.
