# Spec — hook settings write must preserve the operator's file mode

- **Date:** 2026-07-25
- **Status:** proposed
- **Risk:** **HIGH** — the code writes a user file outside our own store
  (`~/.claude/settings.json`), that file holds `env.ANTHROPIC_API_KEY` /
  `ANTHROPIC_AUTH_TOKEN`, and the defect is a silent permission widening.
  Per `docs/conventions/risk-modes.md` HIGH: full chain, worktree (no `main`
  edits), reviewer = `code-reviewer` **and** `critic` in separate passes.
- **Branch:** `fix/hook-settings-file-mode`, based on `origin/main`.
- **Finding:** `hook-settings-write-drops-file-mode` (sec3 sweep, severity high,
  category file-permissions).
- **LOCKED tables:** none involved. This change amends no locked table and no
  locked list; it touches one function in one connector package.

---

## 1. Problem

`packages/connectors/claude-code/src/hook-settings.ts:350` `writeSettings()`
rewrites the operator's global Claude Code settings file through a temp file
created with **no `mode`** and with **no post-rename `chmod`**:

```ts
function writeSettings(settingsPath: string, settings: SettingsObject): void {
  const dir = dirname(settingsPath);
  mkdirSync(dir, { recursive: true });
  const tempPath = join(dir, `.${randomUUID()}.tmp`);
  try {
    writeFileSync(tempPath, `${JSON.stringify(settings, null, 2)}\n`);   // no mode
    renameSync(tempPath, settingsPath);                                  // no chmod
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}
```

`rename()` swaps in the **new inode**. The new inode was created
`0o666 & ~umask` = `0644` under the default `umask 022`. Whatever mode the
operator set on the old inode is discarded — including a deliberate `0600` or
`0400` hardening of a file that contains a live API key.

### 1.1 Reproduction (independently verified against `origin/main`)

Seeded `settings.json` containing `env.ANTHROPIC_API_KEY` +
`ANTHROPIC_AUTH_TOKEN`, `chmod 0600`, `umask 022`, real CLI entry point:

```
$ umask
022
before install : 600
$ node apps/cli/dist/cli.js hooks install claude-code --settings …/settings.json --json
{"target":"claude-code","settingsPath":"…","changed":true}
after  install : 644
secret still in file: sk-ant-REAL-SECRET-DO-NOT-LEAK
$ chmod 600 …
re-hardened    : 600
$ node …/cli.js hooks uninstall claude-code --settings … --json
{"target":"claude-code","settingsPath":"…","changed":true}
after uninstall: 644
```

Starting-mode matrix (calling `installClaudeCodeHook` directly):

| start mode | after |
|---|---|
| `600` | `644` |
| `640` | `644` |
| `400` | `644` |
| absent (fresh create) | `644` |

`0400` is the worst case: a deliberately read-only credential file comes back
both writable and world-readable. Fresh create lands at `0644` where the sibling
writer in the same package would have made it `0600`.

### 1.2 The contract is already pinned inside the same package

Same file, same adapter object, one call after the other:

```
exists before      : absent
after apply()      : 600   <- proxy-route.ts writeSettings (existingMode ?? 0o600 + chmodSync + fsync + symlink refusal)
after ensureHooks(): 644   <- hook-settings.ts writeSettings (none of the above)
```

`docs/superpowers/specs/2026-07-02-persistent-proxy-routing-design.md:907` states
settings mutation uses "atomic rename, mode preservation, and file/directory
fsync"; :691 "The mutator preserves unrelated keys and env entries, file mode".
So this is not a new invariant being invented — it is an invariant one of the two
writers in this package already implements and the other reverts.

Adjacent hardening makes it starker: the `07a4e3dc` store-owner-only-permissions
work put `0700` dirs / `0600` files on every store Mega Saver owns
(`packages/stats/src/atomic-write.ts`, content-store, evidence-ledger, with
permission tests). The one file we write that is **not** ours — the operator's
global agent config holding the API key — is now the sole writer that drops mode.

### 1.3 Blast radius — every reaching call site

All of these funnel through the one `writeSettings`:

| # | call site | trigger |
|---|---|---|
| 1 | `apps/cli/src/commands/hooks/install.ts:57` | `mega hooks install claude-code` |
| 2 | `apps/cli/src/commands/hooks/uninstall.ts:24` | `mega hooks uninstall claude-code` |
| 3 | `apps/cli/src/commands/init.ts:171` | `mega init` — **first-run onboarding** |
| 4 | `apps/gui/bridge/routes/claude-hooks.ts:25` / `:35` | GUI "Connect Saver hook", both directions |
| 5 | `packages/connectors/claude-code/src/proxy-route.ts:168` | `createClaudeRouteAdapter().ensureHooks()` |

Default target for 1–4 is `resolveClaudeCodeSettingsPath()` → `~/.claude/settings.json`.

Two corrections to the original finding, both verified:

- **`mega init` was missing from the report.** It is the worst path: the very
  first command a new operator runs widens the file.
- **The report's claim that `mega proxy` calls `ensureHooks()` on every healthy
  tick is FALSE at `origin/main`.** `git grep -n ensureHooks` shows no production
  call site — only the interface declaration
  (`apps/cli/src/commands/proxy/control.ts:24`), the implementation, a test stub,
  and specs. `wiki/log.md:1965` records why: proxy hardening item "(R10) status is
  read-only (no ensureHooks side-effect)" removed that call deliberately. The
  trigger is operator-initiated, not a repeating background tick. Severity is
  unchanged: one `mega hooks install` is enough and it is unconditional. Site 5
  stays in the blast radius as a re-arming hazard.

Exposure: local-user read of a live API key on a shared or multi-process machine,
plus loss of an explicit write-protection.

---

## 2. Approach

**Extract the one already-correct writer and have both writers use it.**

New internal module `packages/connectors/claude-code/src/settings-write.ts`
exporting a single function — the body of the current `proxy-route.ts`
`writeSettings`, unchanged in behaviour:

```ts
export function writeSettingsFile(path: string, settings: unknown): void
```

- refuses to replace a symlink (`lstatSync` + `isSymbolicLink()` → throw);
- `mode = existingMode ?? 0o600` — **preserve** what the operator chose,
  restrictive default **only when creating**;
- `writeFileSync(tmp, …, { mode })` **and** `chmodSync(tmp, mode)` (the
  `writeFileSync` mode argument is itself subject to umask; the explicit
  `chmodSync` is what actually pins it);
- `fsync` the temp file, `rename`, then `fsync` the directory on non-win32;
- on error, `rmSync(tmp, { force: true })` and rethrow.

Then `proxy-route.ts` and `hook-settings.ts` both call it and their private
copies are deleted. Net: one writer for this file instead of two, and the
divergence cannot re-open.

**Why preserve rather than force `0600`:** if the operator chose `0644` that is
their call. A tool that silently *narrows* permissions is its own surprise, and
`~/.claude/settings.json` is not our file. Force a restrictive mode only on
first creation, where there is no operator choice to respect.

**Direction of the extraction.** `proxy-route.ts` already imports
`installClaudeCodeHook` from `hook-settings.ts`, so importing the writer the
other way would be a circular import (banned by
`docs/conventions/code-conventions.md`). A third, dependency-free module is the
only direction that works, and it also keeps `hook-settings.ts` (~430 LOC,
already over the 300-LOC guidance) from growing.

No caller changes. Nothing in `index.ts` changes — `writeSettingsFile` is
package-internal, not public surface.

---

## 3. Alternatives rejected

1. **Add `chmodSync` to `hook-settings.ts`'s own `writeSettings`.**
   Smallest possible diff and the obvious move. Rejected: it leaves a *third*
   hand-rolled writer for the same file, still missing the symlink refusal and
   the fsync pair that the sibling has — three near-copies drifting against one
   spec invariant is how this defect happened in the first place. Fixing the
   symptom named in the ticket while leaving the sibling gaps open is not
   cheaper, it is the same bug deferred.

2. **Force `0600` unconditionally on every write.**
   Rejected: it silently overrides a deliberate operator choice (some operators
   intentionally run `0644` because another local tool of theirs reads the file),
   and a security fix that changes a user's setting without telling them
   generates its own incident. Preservation is both safer and less code
   (`existingMode ?? 0o600` is one expression).

3. **Re-`chmod` the target after the rename instead of the temp file.**
   Rejected: there is a window between `rename` and `chmod` in which the file is
   live at `0644` — a race, on the exact file that holds the key. Setting the
   mode on the temp inode *before* it becomes visible has no window.

4. **Read the old mode and `chmod` the target only if it differs.**
   Rejected: strictly more code and more branches for the same outcome, plus the
   same post-rename window as (3).

5. **Move the writer into `@megasaver/shared` for all packages.**
   Rejected as speculative (YAGNI): only two call sites exist and both are in
   this package. Every other store already has its own hardened atomic write.
   Promote it if a third package ever needs it.

6. **Do nothing; document that operators should re-`chmod` after install.**
   Rejected: a documented footgun on a credential file is not a mitigation, and
   `mega init` fires it before the operator has read anything.

---

## 4. What this could regress, and the test that catches it

| # | Regression | Catching test |
|---|---|---|
| R1 | **Symlinked settings file now throws.** Dotfile users who symlink `~/.claude/settings.json` into a dotfiles repo get an error from `mega hooks install` / `mega init` where it previously "worked". This is deliberate: today the `rename` **destroys the symlink** and orphans the dotfiles-repo file, so the user silently diverges. Failing loudly beats silently clobbering, and `mega proxy` already refuses. Must be called out in the changeset. | new: install on a symlinked settings path throws and leaves the link intact and the link target unmodified |
| R2 | **Mode assertions fail on the `windows-latest` CI matrix.** POSIX modes do not exist there; `statSync().mode & 0o777` is meaningless and `chmodSync` only toggles the read-only bit. | mode-asserting tests are platform-guarded (`process.platform === "win32"` skip), matching the existing precedent in `proxy-route.test.ts:96` and `packages/stats/test/_platform.ts`. The behaviour assertions (content, atomicity, no temp residue) stay cross-platform. |
| R3 | **Atomicity / no-temp-residue lost during the extraction.** | existing `hook-settings.test.ts:161` "writes atomically, leaving no temp-file residue" must stay green; plus a write-failure test asserting the target is untouched and no `.tmp` remains |
| R4 | **`proxy-route` behaviour changes while its writer is deleted.** | existing `proxy-route.test.ts` "preserves the existing file's mode across a route edit" (`0640`) and "creates a fresh settings file 0600" must stay green untouched — they are the fence for the extraction |
| R5 | **Fresh-create mode change is user-visible**: `mega init` on a machine with no `~/.claude/settings.json` now produces `0600` instead of `0644`. If a *different* local user account legitimately read that file, they lose access. Accepted: the file holds an API key; `0600` is the correct default and matches every other file this repo creates. | new: fresh create is `0600` (posix-guarded) |
| R6 | **fsync on the directory throws on an exotic filesystem** and turns a working install into a hard failure. Unchanged risk — `proxy-route` has shipped this exact code against this exact path. | covered by R4's existing tests; no new guard added (no fallback for a case that has not happened — `docs/conventions/anti-patterns.md`) |
| R7 | **The already-widened population is not healed.** Every operator who ran `mega hooks install` / `mega init` before this fix is sitting at `0644` on a file holding `ANTHROPIC_API_KEY`, and preserve-what-you-find (§3 alternative 2) means the fix keeps them there forever. Healing is still rejected — silently narrowing someone else's agent config is the mirror of the bug. But leaving it *undetectable* was the real gap: nothing in the product ever looked at the mode. | new: `mega doctor` reports `claude-code-settings-perms` and warns with `chmod 600 <path>` when `mode & 0o077` is non-zero — read-only, WARN not FAIL (`apps/cli/test/doctor.test.ts` `checkSettingsPermissions`) |

---

## 5. Out of scope

- The mode of the **directory** `~/.claude` (`mkdirSync` without `mode`). It is
  Claude Code's directory, not ours; creating it is a courtesy and narrowing it
  is a different decision needing its own spec.
- Symlink refusal on the **read** path of `hook-settings.ts` (`readSettings`).
  Reading through a symlink is not destructive; the rename is. Keep the fix at
  the one place that mutates.
- The other four call sites (CLI install/uninstall/init, GUI route). They need no
  change — that is the point of fixing the shared writer.
- Any change to what `settings.json` *contains*.

## 6. Definition of done

`pnpm verify` green; the new posix-guarded permission tests red before the fix
and green after (each with its recorded red output); `proxy-route.test.ts`
untouched and green; changeset added (behaviour change ships to CLI users, and
R1 is a user-visible break); `wiki/entities/connectors-claude-code.md` and
`wiki/log.md` updated; `code-reviewer` **and** `critic` passes in a context that
did not author this.
