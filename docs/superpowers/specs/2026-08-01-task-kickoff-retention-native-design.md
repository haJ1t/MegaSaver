# Task Kickoff Retention — Native Safe Filesystem Design

> **Date:** 2026-08-01
> **Status:** APPROVED — user approved the cross-platform native-helper direction on 2026-08-01.
> **Risk:** CRITICAL — retention deletes per-session state; it must not modify a path outside the selected Mega Saver store.
> **Scope authorization:** User: “hepsini senin önerdiğin sıra ile yap bitir” and explicit approval of the native helper.

## 1. Problem

Task-kickoff packs and their one-emission claims must be retained for 30 days.
Path-based Node cleanup cannot make an unlink operation remain inside an already
validated directory when that directory hierarchy is replaced concurrently.
Repeated `lstat`, identity, temporary-file, and rename checks still leave a
check/use interval. Such an implementation cannot meet the product rule that a
cleanup must never modify a file outside the selected store.

## 2. Decision

Add the internal native package `@megasaver/safe-fs`. It exposes one narrow,
synchronous N-API operation to the CLI:

```ts
export type TaskPackRetentionResult =
  | { status: "swept"; removed: number }
  | { status: "not-ready"; removed: 0 }
  | { status: "rejected"; removed: 0 };

export function pruneTaskKickoffRetention(input: {
  storeRoot: string;
  olderThanMs: number;
}): TaskPackRetentionResult;
```

It only inspects `stats/<workspace>/task-pack` and only removes ordinary
`*.json` and `*.json.claim` files with an mtime strictly older than the supplied
cutoff. It does not clean intent, saver-seen, evidence, content, or any other
store surface. A rejected, missing, reparse-point, symlink, or changed path
returns without deleting anything.

The package maintains its own daily owner-only marker relative to the opened
store root. The marker is an implementation detail of the helper; the CLI never
writes a GC marker through a path string.

## 3. Platform contract

On POSIX, the addon anchors the opened store directory and descends with
`openat` + `O_NOFOLLOW`; enumeration uses directory descriptors and deletion
uses `unlinkat` relative to the verified task-pack directory descriptor.

On Windows, the addon uses handle-relative NT file operations rooted at the
opened store handle. It rejects reparse points at every segment, enumerates via
the opened directory handle, and marks a candidate for deletion through its
opened handle rather than a later path lookup. The installer ships prebuilt
native artifacts for supported Node 22 targets; it must not require an end-user
C++ toolchain.

Native loading failure is explicit `not-ready`: the hook continues fail-open
and performs no task-pack cleanup. It never falls back to path-based deletion.

## 4. Integration

`apps/cli/src/hooks/gc.ts` keeps the established daily cadence for content
cleanup. It delegates only task-pack retention to `@megasaver/safe-fs`; the
existing JS `pruneTaskKickoffFiles` and all JS marker-writing added for this
feature are removed. Task-kickoff claims remain immutable session guards until
the native retention helper safely removes them after 30 days.

The CLI bundle externalizes the addon and release packaging includes the
matching prebuilt artifact. A bundle smoke test asserts that the native loader
is external rather than inlined and that an unpacked release resolves it.

## 5. Invariants and evidence

- A traversal containing a link/reparse point or a changed directory identity
  removes **zero** files from that traversal.
- A regular old pack or claim below a verified task-pack directory is removed;
  a fresh or unrelated file remains.
- No caller can observe a task-pack cleanup that follows a replacement path.
- POSIX and Windows helper tests exercise a mocked/native fixture hierarchy;
  Windows release CI executes the Windows implementation.
- The hook’s 500 ms assembly deadline remains independent of daily cleanup.
- Full `pnpm verify`, a native package build, release-bundle smoke, real Claude
  hook smoke, and fresh-store paired benchmark remain release gates.

## 6. Non-goals

This package is not a general filesystem abstraction. It does not retrofit
legacy intent/seen/content cleanup, attempt stale-claim stealing, expose a
public CLI command, or relax the one-emission invariant.
