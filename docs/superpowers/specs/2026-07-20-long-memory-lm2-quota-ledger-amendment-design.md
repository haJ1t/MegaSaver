---
topic: long-memory-lm2-quota-ledger-amendment
status: approved by standing product authorization; independent design reviews incorporated
risk: HIGH
date: 2026-07-20
sources:
  - docs/superpowers/specs/2026-07-20-long-memory-lm2-hybrid-recall-design.md
  - commit 0ae93e7d (Task 4 review trigger)
---

# LM2 Quota Ledger and Operation Lock Amendment

## Decision

LM2 adds one canonical quota ledger per workspace at
`<workspace>/.lm2/vector-quota-ledger-v1.json`. It replaces directory-wide
quota recomputation with a bounded allocation record so one index call can
honor both the 1,024 sidecar-metadata-read cap and exact quotas. This amendment
supersedes the original design's durable-sidecar scan recovery wording.

The alternatives were: retain repeated whole-directory scans, which violates
the index work cap; weaken a quota or work cap, which makes a product guarantee
false; or use a bounded ledger with an operation-scoped OS lock. The ledger is
selected.

## Ledger state

The ledger is canonical JSON, static-symlink defended, atomically replaced,
fsynced with its file and parent directory, and capped at 64 KiB. It contains:

- schema version, workspace key, immutable ledger epoch, and monotonically
  increasing generation;
- fingerprint-sorted namespace summaries, at most two, each with exact
  allocated `sidecarCount` and `serializedBytes` counters;
- one workspace-wide `committedThroughAllocation` sequence and the next
  allocation sequence;
- one immutable fixed-lock identity (`device`, `inode`) and random lock token
  persisted in the ledger from initialization onward;
- zero or one pending transaction with a non-transferable operation id, expected
  ledger generation, allocation sequence range, and at most 16 entries;
- one active-operation fence with operation id, expected generation, and the
  fixed advisory lock inode identity (`device`, `inode`);
- for every pending entry: descriptor fingerprint, record id, record identity
  digest, 24-KiB reservation, and after embedding its expected sidecar digest
  and exact serialized byte count.

Every generation, count, byte total, and allocation sequence is a nonnegative
safe integer; overflow or a noncanonical number is `quota_state_invalid`. Empty
namespace summaries are omitted. With no pending transaction,
`nextAllocationSequence` is exactly `committedThroughAllocation + 1`. With a
pending transaction, its range starts at that next sequence, is consecutive,
and no other allocation may be issued. `recordIdentityDigest` is the
domain-separated SHA-256 of canonical `{ workspaceKey, id, kind, sourceDigest,
embeddingInputDigest, modelFingerprint }`.

Every new sidecar uses the fenced `embeddings-v2` root and carries immutable
`ledgerEpoch` plus `allocationSequence` metadata. A vector is recall-eligible
only when its epoch matches the ledger and its sequence is at most the ledger's
contiguous `committedThroughAllocation`; pending, orphaned, old-root, and mixed
writer sidecars are excluded without a namespace scan. Counters are exact
allocated counters for ledger-aware writers serialized by the same workspace
lock. An externally removed or corrupt committed sidecar remains allocated;
this can over-reserve but never undercounts capacity.

LM2 writers create the fixed advisory lock inode during ledger initialization
and never replace or delete it. The immutable lock identity and token are
persisted independently of an active operation, so every later acquisition
rejects a replacement pathname even after a clean finalization. The ledger's
active operation fence is written before any catalog work, is tied to the
expected generation and operation id, and makes compliant writers reject
re-entry before scans. The static-symlink model treats out-of-band replacement
of a trusted-root lock or ledger as tampering: descriptor/path guard failure
returns `lock_integrity_lost`, never a second mutation authority. LM2 is
pre-1.0: mixed old/new writers and unledgered non-empty embeddings are invalid
state, not compatibility cases.

The active-operation fence repeats the persisted fixed lock inode identity
(`device`, `inode`) and immutable random token that also lives in the lock
file. The next writer may perform fence-only crash recovery only after it
flocks that same inode and validates the same token and generation; a recreated
pathname fails before scans. Node cannot detect a well-formed ledger rollback
installed wholly outside an open operation without a native anti-rollback
anchor. That trusted-root tampering is outside LM2's static-symlink threat
model; exact allocation guarantees apply to compliant ledger-aware writers,
while in-operation path changes fail closed.

Pending entries publish strictly in ascending allocation sequence. A normal
cancellation or a proven-absent suffix resets `nextAllocationSequence` to that
first absent sequence in the same fsynced reconciliation rewrite; a committed
prefix advances the watermark only through its final contiguous sequence. No
higher allocation is issued until that transaction reconciles. If absence or
unlink cannot be proven, LM2 retains `blocked_pending`. Thus no watermark can
cross a canceled sequence and no canceled allocation can become recall-visible.

## Operation contract

`Lm2VectorStore.beginIndexOperation` is the concrete operation-scoped
capability. It takes only `{ workspaceKey, model, deadline }` and generates its
own cryptographically random operation id,
acquires the workspace advisory lock, validates/reconciles the ledger, and
returns either `{ status: "busy" | "unavailable" | "invalid" }` before any
catalog work or one non-transferable operation capability. The capability owns
the descriptor-bound lock guard, expected ledger generation, sidecar-metadata
budget, allocation sequence range, and `publishBatch` method; it cannot be
reused after finalization, timeout, or a failed guard. The indexer calls it
before `catalog.page`. A loser returns `index_busy` with the request cursor
unchanged and performs no catalog, raw-record, evidence, approval, sidecar, or
embedding work. The winner retains its capability through catalog scanning,
admission, remote approval, embedding, no-clobber publication, and final ledger
commit.

The vector store's batch publish capability is callable only through this
operation; it neither reacquires nor releases the lock. It validates that the
port call uses the configured descriptor, `document` purpose, and exactly the
canonical public `kind` plus already-redacted `text` projections admitted for
that batch. It checks the lock guard after egress and immediately before every
durable mutation.

One operation reads one bounded ledger and at most 1,024 named sidecar metadata
records in total. Pending recovery, existing-sidecar checks, collision checks,
publication verification, and normal index work charge the same budget. The
catalog is read once into one snapshot and yields at most 1,024 entries; it is
not re-opened per entry. A missing-ledger emptiness check is one `opendir` plus
at most one entry read, never `readdir` or a namespace descent. The operation
never descends through an embeddings namespace to compute quota. The existing
caps on catalog/direct records, raw text, eligible records, batch records, and
batch text remain unchanged.

## Transaction and recovery

While holding the operation lock, LM2 validates the ledger and reconciles any
pending transaction before catalog work. A missing ledger may initialize only
when the `embeddings-v2` root is absent or a bounded first-entry probe proves it
empty. Any existing v2 embedding entry with a missing ledger, malformed ledger,
counter overflow, unknown namespace, duplicate pending identity, or unreadable
state returns `quota_state_invalid` before egress. The historical `embeddings/`
root is never read by Adaptive recall; a bounded first-entry probe sees a
non-empty old root as mixed unledgered state and blocks indexing with
`quota_state_invalid`. It is never adopted, scanned, or ignored for quota
admission.

For a batch, LM2 writes a pending worst-case reservation before approval or
egress. After approval, embedding, and vector validation, it records each
expected digest and exact byte length. It then processes entries strictly by
allocation sequence: immediately before each no-clobber publish it rechecks
that entry's evidence, publishes it, and fsyncs a ledger rewrite that advances
the contiguous watermark and replaces that entry's reservation with actual
bytes. No await occurs between this per-entry evidence check and its durable
visibility transition. A later revoked or failed entry cannot block previously
committed entries or advance its own cursor. The quota invariant is
`committed + pending <= limit` for count and bytes, and namespace admission
includes both committed and pending fingerprints. Actual bytes replace each
entry's 24-KiB reservation before that entry's ledger commit.

`indexedCount` and cursor advancement occur only after the relevant ledger
commit. On normal timeout, denial, port failure, or evidence change before
publication, absent pending entries are cancelled in one fsynced ledger rewrite
before lock release only when no higher allocation artifact exists; then the
next sequence rewinds to the first proven-absent suffix. On a mid-batch write
failure or crash, synchronous recovery commits the exact contiguous published
prefix, cancels only a proven-absent suffix, and retains a conflicting,
unreadable, or exact artifact after a gap as `blocked_pending`; it never
reuses a canceled sequence while any higher named artifact exists. It never
creates an unledgered sidecar or clears a conflicting transaction. The returned
published IDs and indexed count are reconciled from the post-recovery committed
watermark, so a sidecar made visible just before a durability failure is
reported exactly once after recovery. Temporary
files, expected final paths, operation id, and phase are named in pending state
so recovery covers temporary-file creation/fsync/link/unlink and partial batch
publication without a directory scan. A temporary filename is exactly
`.lm2-<operationId>-<allocationSequence>.pending`; recovery rejects every other
name before an unlink and therefore cannot target a committed final sidecar.

Crash recovery reads only the at-most-16 pending target paths and charges those
reads to the operation budget. An absent target cancels its reservation; an
exact target commits only its contiguous allocation prefix; a malformed,
conflicting, or unreadable target leaves the transaction pending and returns
`quota_state_invalid` with `quotaRecovery: "blocked_pending"`. Recovery never
scans a namespace. Every post-egress continuation verifies its active operation
id, expected ledger generation, abort state, and lock fence; a late embedding
result is incapable of publishing after timeout or finalization.

Adaptive recall reads the ledger and sidecars read-only from a consistent
descriptor-validated snapshot. It accepts only ledger-committed v2 sidecars;
pending entries are excluded. A missing/corrupt ledger with a non-empty
`embeddings-v2` root degrades semantic recall without mutation and reports
`quota_ledger_invalid` or `quota_recovery_pending` separately from missing,
invalid, storage-limited, and timeout vectors.

Historical admitted namespaces remain allocated even when no longer selected by
the current model configuration. A requested third namespace is
`storage_limit`; a syntactically invalid ledger containing three namespaces is
`quota_state_invalid`. Automatic repair/reset/rebuild is forbidden. An explicit
operator repair procedure, with a separate user-confirmed administrative
workflow, may quarantine the entire `.lm2` root and start a new ledger epoch;
it is outside LM2 index/recall APIs.

## Cursor, receipts, and deadlines

`Lm2IndexReceipt` always records `outcome`, `nextCursor`, `retryCursor`,
`transientReason`, and `quotaRecovery`. `outcome: "complete"` requires both
cursors and the transient reason to be null. `outcome: "continue"` requires a
non-null `nextCursor` and a null retry cursor/reason. `outcome: "retry"`
requires `nextCursor: null`, a non-null transient reason, and carries the first
affected eligible sequence in `retryCursor`; `retryCursor: null` explicitly
means retry the page origin. A lock/ledger failure is `retry` at the original
cursor. A later transient returns the first affected eligible cursor; already
ledger-committed earlier batches remain counted. `cursor_expired` is a terminal
`outcome: "expired"` with both cursors and the transient reason null; it is
neither complete traversal nor a record-level omission. Therefore a null retry
origin is never confused with completed traversal.

Ranker vector reads must enforce a monotonic deadline during bounded work and
return parsed, bounded diagnostics. They validate returned candidate ids,
dimensions, duplicate identity, exact decoded bytes, and aggregate limits
before scoring. Hybrid receipt reasons remain sorted and de-duplicated and
distinguish missing, invalid, quota-ledger, recovery-pending, read-limit, port
failure, approval, input-limit, and timeout outcomes.

## Required verification

- A 20,000-sidecar allocation represented by two ledger summaries proves one
  bounded ledger read, no committed per-sidecar array, no namespace enumeration,
  and at most 1,024 total named sidecar metadata reads including recovery.
- Missing/corrupt/oversize ledger, old non-empty unledgered embeddings,
  counter overflow, duplicate pending entries, and a third namespace fail
  before catalog scan or egress.
- Crash cuts after reservation, temporary-file creation/fsync, expected-digest
  update, each link/unlink, sidecar fsync, and ledger commit recover only named
  pending entries with one idempotent ledger rewrite.
- A real multi-process, multi-batch index proves the loser performs zero
  catalog/direct/evidence/approval/embedding/sidecar work and the winner holds
  one lock until final ledger commit.
- A committed first batch followed by denial, timeout, write failure, or
  evidence exhaustion preserves the exact retry cursor and receipt reason.
- Adaptive recall excludes pending entries and reports an invalid ledger without
  mutating durable state.
- A port resolving after timeout and a lock-path replacement prove a stale
  operation capability cannot publish or commit after a later operation starts.
