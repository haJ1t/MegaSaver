---
title: LM2 Runtime, Benchmark, and Security Completion Amendment
date: 2026-07-20
status: approved by standing user authorization; implementation pending
risk: high
supersedes: no; extends 2026-07-20-long-memory-lm2-hybrid-recall-design.md and 2026-07-20-long-memory-lm2-quota-ledger-amendment-design.md
sources:
  - docs/superpowers/specs/2026-07-20-long-memory-lm2-hybrid-recall-design.md
  - docs/superpowers/specs/2026-07-20-long-memory-lm2-quota-ledger-amendment-design.md
  - final whole-branch architecture and adversarial reviews, 2026-07-20
  - https://github.com/xiaowu0162/LongMemEval-V2
---

# LM2 Runtime, Benchmark, and Security Completion Amendment

## Why this amendment exists

The quota-ledger rework is verified in isolation, but independent whole-branch
review found two blockers to the product goal: LM2 has no public production
composition (`createLm2Runtime`) and no LongMemEval-V2 backend. The same review
also found concrete filesystem, receipt, egress-binding, structural-port, and
cleanup defects. This amendment closes those gaps before LM2 can be considered
an end-to-end product or a benchmarkable memory backend.

## Precedence

This amendment replaces the benchmark transport and measurement clauses at
§327–332 and §660–709 of
`2026-07-20-long-memory-lm2-hybrid-recall-design.md`. In particular, the five
operation/reused-process/finalizer contract is retired: LM2 benchmark transport
is stateless `open`/`insert`/`query`, synchronously indexes inside `insert`, and
does not depend on `close`. The original production Safe/Adaptive, LM1 fused
selection, quota-ledger, and product-boundary clauses remain in force except
where this amendment states a more specific security or runtime rule.

LongMemEval-V2 evaluates memory backends through `insert(trajectory)` and
`query(query, query_image=None)`, and scores both answer accuracy and query
latency. Its public harness expects text/image context items, a registered
Python backend, and lifecycle-compatible persistence. Mega Saver will supply a
separate public-data-only backend; no official score is claimed until the
official data preparation, both domains, output artifacts, and leaderboard
package have actually completed. [LongMemEval-V2 README](https://github.com/xiaowu0162/LongMemEval-V2)

## Product composition

`createLm1Runtime` remains byte-compatible. LM2 adds a separately named,
publicly exported `createLm2Runtime` that receives the exact LM1 composition
inputs—including `clock: { now(): string }`—plus an embedding port, validated
LM2 configuration, `monotonicClock: { now(): number }`, and required
remote-approval port when remote egress is configured. It creates
one private `FileLm1Store`, LM1 capture/recall services, LM2 catalog, vector
store, ranker, and index service from that same root.

The runtime configuration includes one required `activeRecallModelFingerprint`.
It must exactly match one admitted descriptor and is the sole model selected by
Adaptive recall; an index request may still target any admitted fingerprint.
Configuration schema errors—including an absent/mismatched active model or an
invalid remote approval composition—fail factory creation before any runtime
port is read. The factory snapshots structural ports recursively through own
enumerable data-property descriptors under one catch boundary before Zod
validation: the result object, arrays, vector objects, Float32 components,
diagnostics, and nested objects admit neither accessors, symbols,
non-canonical keys, nor proxy/getter traps. A structurally unreadable
embedding/vector/approval port becomes an `adaptiveUnavailable` capability;
Safe never dereferences it and Adaptive reports its exact degraded reason.

The factory outcome matrix is fixed. A schema-invalid configuration, an absent
or non-admitted `activeRecallModelFingerprint`, a local configuration with an
approval port, or a remote configuration with no approval-port argument is a
factory `invalid_input` error before any structural port is read. With an
otherwise valid local configuration, an absent/unreadable embedding port or an
embedding `egress` other than `local` yields `adaptiveUnavailable` with,
respectively, `embedding_port_unreadable` or `embedding_egress_mismatch`.
With an otherwise valid remote configuration, an absent/unreadable embedding
port, unreadable approval port, or non-remote embedding egress yields the same
embedding reason, `approval_port_unreadable`, or
`embedding_egress_mismatch`. In every unavailable case Safe is callable with
zero catalog/vector/embedding/approval access; Adaptive returns its lexical
result with that exact reason. A readable remote capability still degrades
`remote_approval_denied` for a missing, denied, revoked, or stale workspace and
model approval. `index` is also present on an unavailable runtime but performs
zero catalog/vector/embedding/approval I/O and returns an LM2 `retry` receipt
with its request cursor, `quotaRecovery: "not_needed"`, and
`transientReason: "embedding_failure"` for either embedding reason or
`"remote_approval_denied"` for an unreadable approval port.

The runtime returns three explicit services:

- `capture.prepare` and `capture.capturePrepared`: delegate to LM1. After a
  successful LM1 publication, they append the bounded LM2 catalog and return
  `adaptiveCataloged: false` rather than invalidating the LM1 record when the
  catalog write fails.
- `recall`: accepts a profile. For `safe`, it calls the existing LM1 recall
  service exactly once and decorates the unchanged LM1 bundle with a
  `not_requested` hybrid receipt; it performs no catalog, vector, embedding,
  or semantic call. For `adaptive`, it ranks public LM2 candidates and passes
  the ordered ids through a private LM1 fused selector that owns the existing
  correction-chain, evidence, token-budget, and raw-record semantics.
- `index`: accepts only a configured model fingerprint and delegates to the
  one-operation LM2 index service. Recall never creates vectors.

The fused selector is factored from LM1 recall rather than reimplemented. It
accepts at most 1,000 ordered candidate ids and the original lexical/fused
scores, then applies LM1's existing structural snapshot expansion and evidence
eligibility rules. This preserves Safe behavior literally and keeps LM1-only
state keys, correction pointers, evidence ids, and raw records out of the
public ranker.

## LongMemEval-V2 transport and backend

`lm2-benchmark` is a separate benchmark-only TypeScript JSONL executable, not
an LM0 stdio extension and not an export of the production package root. It
imports only neutral public long-memory contracts. It exposes schema-validated
stateless `open`, `insert`, and `query` operations over durable run-owned
state; `close` may exist for local cleanup but official correctness never
depends on it. The official backend launches a bounded process for every
operation because the official `Memory` contract has no guaranteed
close/finalization or index-complete hook. Process startup is included in the
emitted query latency; no persistent child process or hidden startup cost is
claimed. A per-instance, per-haystack cache identity derives from the pinned
prepared-data revision, manifest digest, a cryptographically random 128-bit
instance token, the ordered haystack-chain digest, and an exclusive run
sentinel. At official commit `6f020ac2fc3275e46c706d3406e02c3ed79b7be2`, the
unmodified harness supplies only `question_id`, `question_type`, and
`question_item` through `set_query_context` for an unknown backend; it does not
inject `workspace_dir`. The backend therefore uses no harness path or hidden
scope parameter. It derives its cache root below a configured public benchmark
cache parent. The sentinel is atomically created and owns separate `cache/` and
`telemetry/` roots, so non-shared and concurrent harness instances neither
collide nor share state. The transport never opens a production workspace.

`build-lm2-manifest.mjs` is a required pinned-data preparation step. It writes
`megasaver-lm2-manifest-v1.json` and a SHA-256 digest supplied independently in
the backend config. The manifest schema is exactly
`{schemaVersion:"megasaver-lm2-manifest-v1",officialCommit,data:{repoId:"xiaowu0162/longmemeval-v2",revision:"f152293e235517d504809563c833d7190b8c713b",checksums},domain,tier,questions,trajectories}`.
`checksums` must equal the released SHA-256 values for `SCHEMA.md`
`0672cf47cf16c30365648770628b433076bb3f5b73edded673af7dd6d5f3246f`,
`questions.jsonl`
`0a3ae5ebea938c24d7800e1e0b0828e08ae1646f939a53853b2b8cdc08e292b7`,
`trajectories.jsonl`
`363cec9a8e87aa8d9101ce4e600aadbf7031d674056ebe4f969e8424abc5f3c6`,
and the selected tier haystack (`small`:
`9b5301defb23a088a5f06e45ff8d5f35e569d78305a66d492046a9fff9b46593`;
`medium`:
`4756d5126347f0d18f045bb6c47b08cb3b23e9db24386cc48a9b2879e7969b59`).
The builder resolves that exact Hugging Face revision, recomputes every listed
checksum, and runs the pinned official `data/validate_data.py` before writing.

Question rows are an allowlist—not a copy of official question objects—and may
contain only `questionId`, `domain`, `tier`, `questionType`, exact
`questionText`, `questionTextDigest`, `imagePresent`, ordered trajectory
`{id,fullObjectDigest}` rows, and `haystackChainDigest`. They never contain,
read, serialize, hash, or pass `question_item`, answer, eval function, judging
data, provenance, or any unlisted field. A canonical trajectory value is
JSON-compatible only; object keys are strings sorted by Unicode code point,
strings are NFC-normalized, arrays preserve order, and `JSON.stringify` emits
compact JSON with finite numbers only. The manifest contains, for every
trajectory id, the canonical full-object digest and ordered projections. The
builder rejects duplicate ids, unresolved haystack references, an out-of-root
input, an unlisted question field, or any revision/checksum/validation mismatch.
The required canonicalization test vector is input
`{"b":"e\\u0301","a":[true,1]}` → canonical bytes
`{"a":[true,1],"b":"é"}` → SHA-256
`58c663564b7cee5fa1477a1cc371a0426bc5f6fb98fc493cdf0d51ab8066ec52`.

Each projection is exactly one `state_snapshot`: if a trajectory contains a
`states` array, it emits only `states[i]` using the first non-empty string of
`accessibility_tree` then `text`; otherwise it emits `content[i]` using
`observation.text`. Other shapes are rejected rather than guessed. Its
lowercase id is UUIDv5 namespace
`7d20f05d-6a18-52b8-98e0-8f6c933b3484` with UTF-8 name framing
`trajectoryId + "\\0" + sourceKind + "\\0" + decimalSourceIndex`. Its text is deterministically
truncated at 50,000 UTF-16 code units without leaving an unpaired surrogate.
`observedAt` is the first canonical RFC3339-with-offset source timestamp; when
absent, the builder assigns `2000-01-01T00:00:00.000Z + globalProjectionOrdinal`
milliseconds and stores that value. The builder stores the resulting source and
embedding-input digests. Runtime transport never re-derives projections: it
matches a full-object digest and reads the exact stored public projection.

The constructor opens no run state, which makes official `load_memory()` safe:
the base creates the class before `_load_backend()`. `_save_backend` persists a
control record containing the manifest digest, public data revision, instance
token, sentinel token, ordered `{ id, fullObjectDigest }` insertion chain, and
the saving directory's canonical realpath plus `{device,inode}` identity.
Runtime config contains only static public values (manifest path/digest, data
revision, cache parent, profile/model, and acknowledgement policy), so the
official base's exact saved/requested-config reconciliation remains valid.
`_load_backend` restores only that record after validating every field and
requires the supplied save directory's realpath and `{device,inode}` to match;
the original directory load succeeds while a copied, moved, or hard-linked save
fails before transport or egress. Backend-owned cache state is looked up from
the persisted instance/sentinel tokens, never from a harness-injected path.
`insert` receives the official full trajectory object, never a trusted source
path. It admits its trajectory id only when the canonical full-object digest
matches the configured manifest. It appends exactly one next chain element and
synchronously drains bounded indexing before returning because the official
interface has no separate index-complete hook. Each call proves its prior chain
digest and atomically advances it under a durable per-sentinel mutex; the
logical cache identity is the manifest digest, instance token, sentinel token,
and current ordered haystack-chain digest.

Before every query—normal or loaded—the backend reads only scalar
`question_id` from official query context and discards every other context key,
including `question_item`. It requires an exact allowlisted manifest row: the
supplied query must equal its stored canonical query text, the configured data
revision and manifest digest must match, and the durable insertion-chain digest
must equal the row's ordered haystack digest. An unknown question, substituted
query, cross-domain/tier question, reordered haystack, copied-save replay,
or missing context returns an empty context with a durable rejected-query
telemetry record and launches neither transport nor embedding. Extra poisoned
answer/eval data inside `question_item` is ignored identically to any other
discarded context value and cannot affect transport input, output, or telemetry.
`query` otherwise may return an empty list, but every returned text item is
non-empty; it returns no image item. It records whether `query_image` was
supplied but never opens, embeds, or returns that image.

The benchmark backend accepts only `embeddingEgress: "local"`; a remote model,
remote acknowledgement, or destination configuration is an `invalid_input`
factory error. Product LM2 remote approval remains separately governed by its
runtime port, but it is not an official benchmark execution mode in this
increment. Query admission therefore occurs before the transport process
launches and a private query or substituted manifest has zero remote embedding
by construction.

`benchmarks/longmemeval-v2/megasaver_lm2_hybrid.py` defines
`megasaver_lm2_hybrid` as an official `Memory` subclass. A pinned-revision
installer verifies official commit `6f020ac2fc3275e46c706d3406e02c3ed79b7be2`,
copies the backend into the checkout, and adds an idempotent explicit import to
`memory_modules/memory.py`; configuration alone cannot register external
classes. The backend implements `insert`, `query`, `post_query_hook`,
`_save_backend`, and `_load_backend`.
Save/load contains only durable public run identity and never substitutes for
per-operation state persistence. It returns only non-empty text items and
rejects any remote-evaluation configuration. Contract tests use the real pinned
`Memory` base and cover shared/non-shared, save/load, concurrent query
serialization, and no child-process leak.

The benchmark transport creates backend-owned run, cache, and telemetry
directories as new same-EUID `0700` directories and files as `0600`; all
backend manifest, control, and telemetry paths are anchored no-follow traversals,
reject symlinks, FIFOs, devices, non-regular files, unsafe modes, foreign
ownership, and pre-created children. A new sentinel uses exclusive creation and
a random token. Only a load operation that presents the persisted matching
sentinel token may adopt that root; every other pre-existing backend state fails
closed, including under an elevated process. The unmodified official `Memory`
base reads/writes its own `memory_config.json` before backend hooks, so these
filesystem guarantees deliberately do not cover that upstream file or its
parent before control enters Mega Saver.

The installer accepts only two checkout states at the pinned commit: a pristine
baseline, or its exact prior installation. It verifies an
`official-contract-6f020ac2.json` baseline before modification: SHA-256
`512d48d93ff78208127c85ffd90ea4c63f1f9ccea3427f0a7b6928a39bdc6a59` for
`memory_modules/memory.py`,
`4a508fde65e382c45669fe7243348944628054c9ce6416d78c0a395ce1c3abcd` for
`evaluation/harness.py`,
`8c197c28231a14b303ec8a11a5cd5ddbbe70a5e9072f1f97c28f30f484d8f078` for
leaderboard step 1, and
`ae727018666e7131d6f1415515405f51ab91365ac9929ad0990d083a8bcf4907` for
leaderboard step 2. It permits exactly one idempotent backend import plus the
new backend file under `memory_modules`; the harness and builders remain
byte-identical. An already-installed checkout is accepted only when `git status
--porcelain` names those two paths, removing the exact marked import restores
the baseline `memory.py` digest, and the existing backend digest equals the
artifact to install. Evidence records both pre-install baseline or exact
installed-state hashes and post-install allowlisted diff digests.

Benchmark telemetry contains only profile, semantic status, model fingerprint,
candidate/selection counts, latency, question id/type, and image-present/image-
used flags. It excludes user paths, raw record text, credentials, evidence ids,
and production sidecars. An official-score statement requires the pinned,
prepared, and validated official data; web and enterprise runs for one tier;
complete per-question outputs; both `aggregated_metrics.json` files; the
combined metric; and a successful pinned official step-1/step-2 leaderboard
builder with `per_question.jsonl`, `run_args.json`, `runtime_inputs`,
`metric_overview.json`, operating-point metadata, system description, code
artifact, `submission_overview.json`, and final package tarball digests. The
artifact gate also records official commit
`6f020ac2fc3275e46c706d3406e02c3ed79b7be2`, exact data revision and mode,
reader/judge/embedding configuration, hardware, complete run arguments, all
five official dashboard values—`overall_full_set`, `gotchas_accuracy`,
`static_accuracy`, `dynamic_accuracy`, and `procedure_accuracy`—raw latency
samples, failures, and adapter/transport digests; hand-authored aggregate files
do not satisfy it.

## Security and correctness hardening

### Runtime boundaries

Every structural embedding/vector port object is read through own data-property
descriptors under a catch boundary before Zod validation. Throwing getters,
proxies, symbols, non-enumerable fields, malformed dimensions, non-finite
values, duplicate ids, and mismatched descriptors degrade Adaptive to its
lexical result with an honest reason; they never reject Safe recall.

An index receipt exposes `quotaRecovery: "blocked_pending"` on the same call
that discovers a durable conflict. Any cleanup outcome that cannot prove every
temporary link, unlink, descriptor close, ledger-anchor close, and lock close
completed overrides every lower-level denial, timeout, or write result with
`outcome: "retry"`, `transientReason: "quota_state_invalid"`,
`quotaRecovery: "blocked_pending"`, and the first affected retry cursor.
Independent cleanup always attempts OS-flock release even if directory-anchor
closure fails; cleanup failures are combined only after that release attempt.

The index operation owns a non-transferable sequence of one-shot batch-plan
capabilities. Before egress, its held lock creates batch 0 from the next at-most
16 records, then only after consuming it may mint batch 1; at most one token is
outstanding. Every token freezes the operation id, monotonic batch number,
ledger generation, workspace key, model fingerprint, deadline, immutable
candidate source/input digests, exact ordered canonical existing/missing
projections, and the digest of every earlier planned/egressed identity. The
private publisher—not a public port consumer—consumes its opaque token exactly
once, before its expiry, and invokes egress internally with exactly that frozen
missing projection. It rejects a subset, reorder, duplicate, cross-operation
token, post-plan mutation, expired token, reminted batch, or reuse with zero
extra egress. A 17-record operation must consume two distinct sequential
batches; replaying batch 0 or trying to remint it cannot send the first 16
records again. Publication revalidates the capability under the same lock and
preserves exact progress for retry receipts without a second write or metadata
probe.

### Sidecar provenance and trusted-root limit

Read admission verifies every V2 sidecar against the requested candidate's id,
source digest, canonical embedding-input digest, model fingerprint, ledger
epoch, allocation sequence, dimensions, and canonical Float32 representation.
This rejects stale/mismatched sidecars and accidental mixed writers before
scoring. Any actor able to mutate the trusted root can rewrite sidecars,
ledger, and lock state into matching content; Node filesystem primitives cannot
make that state authoritative. Sidecar digests are consistency checks, not
authenticity. This is an explicit trusted-root tampering limitation, not merely
an out-of-operation ledger-rollback limitation. Exact quota and recovery
guarantees apply to compliant ledger-aware writers; all detected malformed,
stale, symlinked, or identity-mismatched state fails closed.

Ledger replacement is descriptor-anchored and post-rename verified against the
exact serialized generation, epoch, permanent lock identity/token, and expected
content digest before that inode is adopted. Each durable mutation repeats the
guard. A failed guard returns `lock_integrity_lost` and never adopts a
replacement inode. Any residual ABA interval belongs to the trusted-root
tampering limitation.

The catalog is split into V2 schema/cursor, anchored storage, and fixed-inode
lock modules. The V2 control record persists an immutable catalog-lock
`{ device, inode, token }`; acquisition, every mutation, and release validate
that binding. Existing `candidate-catalog-v1.json` is explicitly invalidated,
never silently reinterpreted. Catalog reads and writes reject symlinks. A
replacement lock path therefore cannot grant writer B authority while writer A
owns the old inode, or while idle state names a prior lock. Cleanup uses
independent release paths.

V2 uses exactly `.lm2/candidate-catalog-v2.json`,
`.lm2/candidate-catalog-v2.control.json`, and
`.lm2/candidate-catalog-v2.lock`. A workspace containing either V1 path returns
`catalog_schema_unsupported` and is never read, migrated, or overwritten. For
an absent V2 set, bootstrap opens the regular `0600` lock with `wx` or opens
the pre-existing regular lock, then acquires its OS flock **before writing a
token, control, or catalog**. If two creators race after `wx`, exactly one gets
that flock; the loser writes nothing and returns busy. The holder writes and
fsyncs the random token, records that same device/inode/token plus the
canonical empty-catalog digest in the `0600` control record, fsyncs that
record, then writes and fsyncs the exact empty catalog. If a process crashes
after the lock exists but before control/catalog, a later holder of that same
inode may truncate and replace only its unbound token before restarting
bootstrap; it never unlinks or adopts another inode. If the control record
exists but its catalog is absent, only the holder of the control-bound lock may
restore the exact empty catalog named by that control. Every other partial,
mismatched, symlinked, or active-lock state fails closed. This defines normal
crash recovery without accepting a second writer.

Temporary sidecar cleanup retains a pending ledger name until every link/unlink
and close outcome is durably known. A failed temporary unlink stays
`blocked_pending`; it is never dropped from the ledger as a recovered prefix.

## Verification matrix

- Runtime Safe recall is byte-equivalent in items/LM1 receipt to LM1 and makes
  zero catalog/vector/embedding calls.
- Adaptive runtime uses the fused LM1 selector, rejects invalid configuration
  before ports, and exposes the explicit index operation.
- A never-settling approval; top-level and nested throwing getter/proxy;
  blocked pending conflict; temporary close/unlink; ledger-anchor close; lock
  close; multiple cleanup failure; and post-rename replacement each preserve
  safety and liveness with the normative honest retry receipt.
- A stale candidate sidecar cannot score; a detected trusted-root mutation
  fails closed. Documentation states the remaining any-root-mutator limitation
  precisely.
- Catalog symlink and old-inode/new-inode real-process tests show no second
  writer or lost entry; V1 is invalidated and catalog modules remain below 300
  LOC.
- Benchmark transport rejects production paths/private fields, derives only
  manifest-matched public trajectory projections, authenticates each query and
  loaded insertion chain against the same manifest before process/egress,
  serializes concurrent calls, rejects unsafe filesystem state, ignores query
  images, may return an empty list but never empty text, and its Python module
  satisfies the real official `Memory` contract.
- The benchmark evidence gate runs the pinned official step-1/step-2 builders
  and verifies their complete package artifacts before any accuracy, latency,
  or LAFS claim.
