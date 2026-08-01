# Task Kickoff Retention — Native Safe Filesystem Design

> **Date:** 2026-08-01
> **Status:** SUPERSEDED — automatic task-pack deletion is deferred on 2026-08-01.
> **Risk:** CRITICAL — retention removes local context state; one-emission must remain durable.
> **Scope authorization:** User: “hepsini senin önerdiğin sıra ile yap bitir” and explicit native-helper approval.

## Supersession

Independent design reviews showed that safely deleting a pack after 30 days is
not an isolated filesystem operation. Claude can resume a session after
`SessionEnd`, while a safe deferred deletion needs a durable closure queue,
cross-process writer protocol, fair retry scheduling, and release artifacts on
every supported platform. That is a separate durable-retention product, not a
safe extension of the cache-write-reduction work.

This proposal is therefore not to be implemented. The shipped policy is
simpler and preserves the one-emission invariant: the `*.json.claim` is a
permanent, compact tombstone and overlay GC never scans or deletes task-kickoff
packs or claims. A future retention feature must begin with a new approved
specification and its own lifecycle contract.

The sections below are retained as rejected design history only.

## 1. Decision and threat boundary

The task-kickoff claim is a durable, compact tombstone. It is never retained by
age and a resumed Claude session therefore cannot receive a second kickoff pack.
Retention removes only the large rendered pack after a confirmed SessionEnd;
the claim and the session-to-workspace manifest remain. This deliberately trades
one tiny metadata record per observed session for the at-most-once invariant.

All destructive retention work runs in a platform-native executable under an
opened owner-only store object. POSIX uses `openat` plus `O_NOFOLLOW` and
descriptor-relative `unlinkat`; Windows uses handle-relative NT operations and
rejects reparse points. The boundary is descriptor/handle lineage at open, not
the later absolute pathname. A same-UID process which can replace objects
inside the owner-only store is out of scope because it already has unrestricted
access to all Mega Saver local state. POSIX may remove a final-name replacement
made by such a process; the product makes no stronger exact-object claim.

The executable automatically operates only on POSIX owner-only local APFS,
ext4, and XFS stores and Windows owner-only local NTFS stores. POSIX requires
every opened ancestor to have the effective UID and mode `0700`; Windows
requires the current owner SID and a DACL granting write access only to that
SID, LocalSystem, and Administrators. Reparse points, remote volumes, unknown
filesystems, and failed ownership/DACL checks return `unsafe-tree` without
removing anything.

## 2. Closure queue and tombstones

On first successful emission, the hook atomically adds the resolved workspace
key to `stats/task-pack-sessions/<safe-session>.json`. The strict manifest is:

```ts
{ version: 1, sessionId: string, workspaceKeys: string[] }
```

The claim remains at `stats/<workspace>/task-pack/<session>.json.claim` even
after its corresponding pack is removed. `readTaskKickoffPack` and the kickoff
orchestrator treat either a valid claim or a valid manifest membership as a
consumed tombstone and return empty context.

The installed Claude `SessionEnd` hook captures local `endedAtMs`, reads the
safe-session manifest (not `SessionEnd.cwd`), and appends one fixed-schema
closure record for every listed workspace to a due-date queue. Its path is:

```text
stats/task-pack-retention-queue/<UTC-due-day>/<bucket>.jsonl
```

`UTC-due-day` is the local UTC day of `endedAtMs + 30 days`; `bucket` is the
first byte of SHA-256(`workspaceKey + "\\0" + sessionId`) in lowercase hex.
Each ASCII JSONL record contains `{version,workspaceKey,sessionId,endedAtMs}`.
Duplicate SessionEnd records are harmless because pack deletion is idempotent.
If the manifest is missing or malformed, SessionEnd records nothing: the claim
remains and no pack is deleted.

## 3. Native executable and state protocol

`@megasaver/safe-fs` is a public loader package with platform packages
`@megasaver/safe-fs-{target}`. Each platform package contains a prebuilt
`megasaver-safe-fs` executable and no install script/source-build fallback.
Foreground diagnostics/tests invoke:

```text
megasaver-safe-fs task-pack-retention \
  --store-root <absolute-path> --now-ms <finite-integer> \
  --max-records 512 --max-bytes 65536 --max-runtime-ms 50 --json
```

The executable owns and opens relative to the store object:

```ts
const LOCK = "stats/.task-pack-retention.v1.lock";
const STATE = "stats/.task-pack-retention.v1.json";
type RetentionState = {
  version: 1;
  dueDay: string | null;
  bucket: number;
  byteOffset: number;
  retryNotBeforeMs: number | null;
};
type RetentionReason =
  | "contended" | "unsafe-tree" | "budget" | "invalid-input"
  | "os-error" | "future-clock" | "not-due";
type SubtreeOutcome = {
  dueDay: string;
  bucket: string;
  status: "swept" | "skipped" | "partial" | "failed";
  reason: RetentionReason | null;
  removed: number;
};
type TaskPackRetentionResult = {
  status: "completed" | "partial" | "throttled" | "contended" | "failed";
  removed: number;
  skipped: number;
  outcomes: SubtreeOutcome[]; // max 64, ordinal by dueDay then bucket
  outcomesTruncated: boolean;
  reason: RetentionReason | null;
};
```

It acquires `LOCK` non-blockingly via `flock`/`LockFileEx`, revalidates `STATE`
under that lock, and flushes every state update before releasing it. Queue files
are processed by due-day then fixed bucket 00–ff, never by arbitrary directory
or filename ordering. `byteOffset` advances only after a complete JSONL record;
malformed records consume their bounded line and count as skipped. A permanent
per-record OS error produces a failed outcome, advances to the following record,
and leaves the pack for a later duplicate closure record or operator diagnosis.

At each record, the executable opens only the exact safe workspace/session pack
path under the verified store descriptor. It deletes the pack if it exists,
validates the claim/tombstone, and never deletes the claim or manifest. A crash
after pack deletion is already complete for that record; repeated records see a
missing pack and succeed without changing the tombstone.

`maxRecords`, `maxBytes`, and the 50 ms monotonic work budget apply to every
queue byte, record, and filesystem operation. On a cap, the next exact byte
offset is persisted and `partial` returns. Each later invocation resumes there;
thus an early malformed/large bucket cannot starve later due buckets. A process
may wait one minute after a partial state (`retryNotBeforeMs`); a normal complete
state has no daily marker because eligibility is encoded by immutable due days.

`nowMs` is valid only when finite and within five minutes of the native wall
clock. Future-dated queue records are skipped until their due day is reached;
they are never used to advance a global clock marker. The operator wall clock is
the sole time authority—changing it is equivalent to controlling the owner-only
store—and no external time source is introduced.

## 4. Hook and launch behavior

Task-pack retention runs only from `SessionEnd`, never from PostToolUse. The
hook appends closure records first and then starts the native executable with
ignored stdio, an attached `error` listener, and `unref`. A per-session
owner-only `retention-launch` claim prevents duplicate launch for 60 seconds;
failure to create it skips launching rather than retrying in a loop. Process
creation is measured in SessionEnd tests; its p99 must remain below 25 ms on
supported CI machines. Native execution can outlive the hook, so a blocked
filesystem call cannot delay Claude prompt output or alter hook exit `0`.

## 5. Releases and supported targets

The executable is source-built by release CI. Supported prebuilds are
`darwin-arm64` and `darwin-x64` (macOS 12+), `linux-x64-gnu` and
`linux-arm64-gnu` (glibc >= 2.28), and `win32-x64` (Windows 10 1809+ local
NTFS). Linux musl and Windows arm64 are `not-ready`; no consumer compilation
occurs. Node remains `>=22.0.0` because loading selects an executable, not a
Node ABI.

The loader's exact-version optional dependencies name all five platform
packages. It selects an executable by `process.platform`, `process.arch`, and
Linux libc. `@megasaver/cli` retains the loader in published
`optionalDependencies`; unbundled and standalone tsup configs externalize it
and use guarded dynamic `createRequire` loading.

Bare `mega.mjs` stays runnable without `node_modules` and reports not-ready for
retention. GitHub Releases additionally publish a verified platform archive for
each supported target containing `mega.mjs`, the loader/platform package layout,
and SHA-256/provenance manifest. NPM publishes source-attested platform
packages, then the matching loader, then the matching CLI. Release CI builds,
checksums, and clean-installs each archive and packed-NPM path on Node 22.0.0.
Windows resolves the executable with its `.exe` suffix.

## 6. Evidence and non-goals

Required evidence includes real two-process SessionEnd/retainer/resume tests;
queue duplicate, malformed, cap, offset, failure, and fairness tests; native
link/reparse, ownership, ACL, filesystem-class, lock, and clock-cut tests;
parallel launch p95/p99 tests; all supported platform clean-install smokes;
full cross-platform `pnpm verify`; real Claude UserPromptSubmit/SessionEnd
smoke; paired task-parity benchmark; and fresh security, tracer, verifier, and
independent reviewer artifacts under `docs/superpowers/reviews/`.

The helper is not a general filesystem abstraction. It does not delete claims,
manifests, legacy intent/seen/content data, or other user files, and it does not
claim retention for a SessionEnd event that Claude never delivered.
