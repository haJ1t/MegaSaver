---
title: GG — Real Windows durability for atomicWriteFile (plan)
risk: HIGH
status: draft
created: 2026-05-10
updated: 2026-05-10
spec: docs/superpowers/specs/2026-05-10-gg-windows-port-design.md
---

# GG — Real Windows durability for `atomicWriteFile` (plan)

## §0 Scope

Implement the platform-branch design from
`2026-05-10-gg-windows-port-design.md`. Three artefacts:

1. `packages/core/src/json-directory-store.ts` — replace
   try/catch with `IS_WIN32` branch.
2. `packages/core/test/json-directory-store.test.ts` — add
   win32-path test using `Object.defineProperty(process,
   "platform")` + `vi.resetModules()` + dynamic import.
3. `docs/superpowers/specs/2026-05-10-windows-port-deferral.md` —
   update §1 to point at GG; mark fsync sub-item as implemented;
   other items remain deferred to v0.3.

## §1 TDD step sequence

### Step 1 — Write the failing win32 test

In `packages/core/test/json-directory-store.test.ts`, add a new
`describe("atomicWriteFile — Windows path (GG)", ...)` block.
The test must:

- Save the original `process.platform`.
- `Object.defineProperty(process, "platform", { value: "win32" })`.
- `vi.resetModules()` so the next import re-runs the
  module-level `IS_WIN32` initialiser.
- Dynamic-import `writeSessions` from `../src/json-directory-store.js`.
- Spy on `openSync` and `fsyncSync` (already mocked at the
  `vi.mock("node:fs")` level).
- Call `writeSessions(paths, [VALID_SESSION])`.
- Assert: `openSync` calls include exactly one `.tmp` open
  AND zero `parentDir` (post-rename) opens.
- Assert: `fsyncSync` called exactly once, for the temp file.
- Restore `process.platform` in `afterEach`.

The test will **fail** initially because the current code
unconditionally opens the parent dir.

### Step 2 — Implement the platform branch

In `packages/core/src/json-directory-store.ts`:

1. Add `const IS_WIN32 = process.platform === "win32";` at
   module level (above `atomicWriteFile`).
2. Replace the existing dir-fsync try/catch block with:

```ts
if (!IS_WIN32) {
  const dirFd = openSync(parentDir, "r");
  try {
    fsyncSync(dirFd);
  } finally {
    closeSync(dirFd);
  }
}
```

3. Update the inline comment to explain the NTFS-journal
   rationale (mirror spec §3b verbatim).

### Step 3 — Verify

Run:

```bash
pnpm --filter @megasaver/core test
pnpm exec biome check packages/core/src/json-directory-store.ts \
  packages/core/test/json-directory-store.test.ts
pnpm --filter @megasaver/core typecheck
```

All three must pass. The pre-existing POSIX-ordering test
(`"fsyncs the temp file before rename and the parent dir after
rename"`) must remain green — that's the POSIX-regression
guard.

### Step 4 — Full verify

```bash
pnpm exec vitest run --no-coverage
pnpm exec biome check
```

Per task brief: vitest direct (not turbo) from worktree root.
All 587 v0.2 tests + the new GG test = 588 expected.

### Step 5 — Update deferral spec

`docs/superpowers/specs/2026-05-10-windows-port-deferral.md`:

- Frontmatter: add `superseded_by: docs/superpowers/specs/2026-05-10-gg-windows-port-design.md (§1 only)`.
- §1 header: prepend `[SUPERSEDED by GG — see 2026-05-10-gg-windows-port-design.md]`.
- §1 body: keep historical content; add a final paragraph
  explaining the v0.3 implementation (platform branch, not
  error swallow).
- §4 milestone: strike fsync from the v0.3 work-items list; the
  remaining four items (case-insensitive, CRLF, locks, CI gate)
  remain.

### Step 6 — Wiki append

Append to `wiki/log.md`:

```
## [2026-05-10] schema | GG real Windows durability — atomicWriteFile fsync platform branch

Replaced reactive EISDIR/EPERM/ENOTSUP try/catch in
`packages/core/src/json-directory-store.ts` with proactive
`process.platform === "win32"` branch. Win32 skips directory
fsync (NTFS journals metadata; `FlushFileBuffers` on a dir
handle is a no-op per SQLite/Microsoft docs). POSIX unchanged.
Sandbox/AV `EPERM` now propagates instead of being silently
swallowed. +1 test pinning the win32 branch via
`Object.defineProperty(process, "platform")` + `vi.resetModules`
+ dynamic import. Supersedes FF deferral spec §1 only; case-
insensitive paths, CRLF, lock semantics, Windows CI gate remain
v0.3 deferred. Spec: `2026-05-10-gg-windows-port-design.md`.
Plan: `2026-05-10-gg-windows-port.md`.
```

### Step 7 — Commit + PR

Single atomic commit:

```
feat(core): real Windows durability for atomicWriteFile (GG)

Replace reactive EISDIR/EPERM/ENOTSUP swallow in atomicWriteFile
with a proactive `process.platform === "win32"` branch. POSIX
keeps the directory fsync; Windows skips it because NTFS
journals the rename metadata and FlushFileBuffers on a directory
handle is a documented no-op. Net result: any real EPERM from a
sandbox or AV now surfaces as `store_write_failed` instead of
being silently swallowed.

+1 core test pinning the win32 branch via vi.resetModules +
dynamic import. POSIX-ordering regression test unchanged.

Supersedes FF Windows port deferral spec §1 (fsync) only; case-
insensitive paths, CRLF normalization, lock semantics audit, and
Windows CI gate remain v0.3 deferred.

Risk HIGH (core durability semantics).
```

Push, open PR titled
`feat(core): real Windows durability for atomicWriteFile (GG)`.

## §2 Out of scope

Identical to spec §7. No public API change; no changeset; no
dependencies bumped.

## §3 Rollback plan

If a critic / verifier finding requires reverting:

```bash
git revert <commit-sha>
```

Single-commit change; revert is clean. POSIX behaviour identical
either way; Windows behaviour reverts to error-swallow (still
functional per v0.2 ship gate).
