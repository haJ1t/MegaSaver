# Batch-Read Adviser Hardening Amendment

> **Date:** 2026-08-02
> **Status:** APPROVED — the user authorized continuous implementation on 2026-08-01.
> **Risk:** HIGH — this corrects concurrent hook state, private filesystem boundaries, Windows behavior, and the published CLI artifact.
> **Amends:** `2026-08-01-cache-write-reduction-design.md` §5 and `2026-08-01-batch-read-adviser-plan.md`.

## 1. Trigger

Final Phase 2 review proved that atomic rename alone does not serialize the
read/decide/write transition: concurrent PreToolUse processes can each emit the
same once-per-directory advice. The original state path also follows stable
symlinks and special files, has no byte or retention cap, and was not exercised
through the published `mega.mjs` entry point. These are implementation defects,
not a change to the advisory-only product scope. (sources:
`apps/cli/src/hooks/cache-advice-run.ts`,
`docs/superpowers/specs/2026-08-01-cache-write-reduction-design.md`)

## 2. Decisions

### 2.1 POSIX-only, serialized private state

Cache advice is available only on POSIX local filesystems. Windows installs no
cache-advice hook and an existing legacy command returns empty stdout with no
state. Windows ACL support is a separate reviewed feature; POSIX chmod is not
misrepresented as Windows privacy.

On POSIX, state lives at
`stats/<workspace>/cache-advice/<safe-session>.json`. The existing Task Kickoff
component-by-component owner-only root preflight prepares the directory. Every
state transaction first creates `<safe-session>.lock` with owner-only exclusive
creation; contention, a pre-existing crash lock, or any unsafe node produces a
safe empty result without waiting or stealing a lock. While it owns that lock,
the hook reads a bounded regular state descriptor with no-follow/nonblocking
flags, makes one pure decision, durable-writes a version-2 snapshot through a
unique temporary file and rename, then unlinks the lock. Advice is emitted only
after the snapshot commits.

This makes the invariant **at most one advice per canonical directory key per
session within retained state**. Contention or a crash may suppress optional
advice, and concurrent first calls may postpone the second-call hint; neither
case may duplicate an advice, mutate the current native call, or escape the
private store. Active same-effective-user replacement, hostile ACL semantics,
and NFS locking semantics remain outside the supported local POSIX boundary.

### 2.2 Canonical, bounded metadata

Before any state I/O, the hook accepts at most 65,536 stdin bytes; each cwd,
tool input path, and canonical directory is at most 4,096 UTF-8 bytes. `Read`
requires an existing regular file and records its canonical parent. `Grep` and
`Glob` canonicalize their path; a regular file maps to its parent and a
directory maps to itself. Nonexistent and special targets are ineligible.

The persisted version-2 state contains only a domain-separated SHA-256
directory key, tool kind, and timestamp—not an absolute directory string. It
retains the existing 60,000 ms inclusive window, at most 64 offered keys, and
at most 128 recent calls. State reads and serialized writes are limited to
32,768 bytes. Oversized, malformed, unsafe, or legacy version-1 state is
terminally suppressed until retention expiry; it is never reset or translated.

### 2.3 Retention and observability

Cache-advice state and abandoned lock files use the existing 30-day retention
window. A dedicated, throttled cache-advice sweep runs independently of Saver
compression, uses `lstat`, and deletes only old regular `.json` or `.lock`
entries beneath validated cache-advice directories. It never follows links or
touches permanent Task Kickoff claims/packs. A session may receive advice again
after its retained state expires.

Hook status exposes `cacheAdviceInstalled` separately from the core `connected`
calculation. This makes an explicit opt-out observable without treating an
optional advisor as a broken connector.

### 2.4 Published distribution evidence

The built `dist-bundle/mega.mjs` is the public `mega` bin. CI must rebuild it
and exercise two real cache-advice calls through that artifact: the first is
empty; the second returns only the PreToolUse additional context and has no
`permissionDecision`; state is version 2 and byte-bounded. A copied raw bundle
must fail open when state setup cannot proceed. Release evidence additionally
packs and installs the actual tarball before invoking its exported `mega` bin.

## 3. Acceptance evidence

- seeded first state plus eight parallel same-directory calls yields at most one
  advice; lock contention returns promptly and a terminated lock holder leaves
  only safe suppression;
- symlinked cache-advice directories, symlink/FIFO/device/directory/hard-link
  state targets, oversized input/path/state, and malformed/legacy state return
  empty without unsafe writes;
- Read and Grep/Glob file forms share a canonical parent; symlink aliases do
  not receive duplicate advice; nonexistent/special targets remain ineligible;
- Windows installs no advice hook and produces no advice state;
- 29-day state remains, older regular state/lock files are pruned, nonregular
  nodes are skipped, and Task Kickoff permanent state is unchanged;
- fresh bundle and packed-bin smoke execute the feature surface; full Node 22
  `pnpm verify`, bundle selector, and independent code-review plus critic pass.

The controlled behavioral A/B remains a separate no-claim gate. It still
requires a fixed end-to-end transcript, clean per-arm stores, credentials, task
parity, turn count, raw token classes, and normalized total cost.
