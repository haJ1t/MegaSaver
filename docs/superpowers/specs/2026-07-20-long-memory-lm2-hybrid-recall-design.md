---
topic: long-memory-lm2-hybrid-recall
status: draft; implementation blocked pending user review
risk: HIGH
date: 2026-07-20
sources:
  - docs/superpowers/specs/2026-07-19-long-memory-runtime-design.md
  - docs/superpowers/specs/2026-07-20-long-memory-lm1-observations-design.md
  - wiki/sources/longmemeval-v2.md
  - wiki/syntheses/solo-developer-roadmap.md
  - https://github.com/xiaowu0162/LongMemEval-V2
---

# Long Memory LM2 — Evidence-Preserving Hybrid Recall

## Decision

LM2 adds one hybrid retrieval and selection engine to
`@megasaver/long-memory`. It combines deterministic lexical recall with an
explicitly configured semantic lane, fuses only existing LM1 records, and
preserves LM1's evidence eligibility, immutable correction history, and
fail-closed state semantics.

The default **Safe** profile remains offline and deterministic. The opt-in
**Adaptive** profile may call a caller-supplied embedding port. It never
generates, rewrites, summarizes, or approves a memory claim. A failed semantic
lane degrades to Safe and reports that degradation in the receipt.

This is the recommended path because it improves semantic recall for both the
developer product and LongMemEval-V2 without adopting a benchmark-only
controller/note generator. LongMemEval-V2 evaluates compact memory context by
accuracy and query latency across static state, dynamic state, workflow,
gotcha, and premise questions; it supports optional image context, but image
analysis and generated knowledge remain LM3 scope. (source:
https://github.com/xiaowu0162/LongMemEval-V2)

## Product scope

### Included

- a shared, agent-neutral hybrid candidate and selection engine;
- an LM2-owned bounded capture catalog for honest Adaptive coverage without
  scanning legacy LM1 directories;
- Safe and Adaptive profiles with explicit semantic-lane status;
- a structural `EmbeddingPort`, explicit bounded indexing operation,
  model-descriptor namespace, bounded vector sidecars, and deterministic
  Reciprocal Rank Fusion (RRF);
- exact evidence-preserving selection for LM1 snapshots and transitions;
- benchmark-facing public-data adapter code that reuses the engine through a
  public candidate port, not the private LM1 store;
- receipt telemetry sufficient to compare Safe and Adaptive behavior and to
  make a reproducible LongMemEval-V2 run honest.

### Excluded

- generated runbooks, gotchas, premises, or any LLM-written memory item;
- image embedding, OCR, screenshot retrieval, or use of `query_image` as
  semantic input;
- CLI, MCP, connector, Core Registry, or `MemoryEntry` changes;
- remote embedding defaults, model download, implicit network calls, or
  cross-workspace/cross-project recall;
- a claim of a LongMemEval-V2 score before an official reproducible run;
- index migration or compatibility shims for pre-LM2 stores.

LM3 owns approved knowledge, media, product injection surfaces, and Context
Contracts. LM2 must not pull those concerns forward merely to improve a
benchmark number.

## Options considered

1. **Embedding-only recall.** It may find paraphrases, but lacks lexical
   precision, turns a model dependency into a default product dependency, and
   does not preserve deterministic behavior when the port is unavailable.
2. **Two-stage lexical plus semantic fusion — selected.** BM25 gives an
   inspectable Safe baseline; an optional embedding lane improves paraphrase
   recall. RRF avoids comparing incompatible score scales and the existing
   evidence/correction selector remains the final authority.
3. **Benchmark-specific generated notes and controller planning.** This could
   target individual benchmark categories, but creates uncited claims and a
   separate product architecture. It is rejected.

## Architecture and ownership

```
LM1 records / public benchmark candidates
              │
              ▼
     CandidateStore (bounded projection)
        ├──────────────┐
        ▼              ▼
   lexical lane     semantic lane (Adaptive only)
     BM25            verified vector sidecars + query embedding
        └──────┬───────┘
               ▼
       deterministic RRF fusion
               ▼
    LM1 correction/evidence selector
               ▼
      RecallBundle + HybridReceipt
```

`Lm2HybridRecallEngine` owns only candidate ranking, fusion, and the portable
receipt. It accepts a structural `Lm2CandidateStore` projection rather than a
file path, benchmark type, agent type, or model SDK. It returns ranked
candidate ids; it does not know LM1's correction or evidence semantics.
Production composition adapts the private LM1 store, then sends the fused
order through LM1's existing correction/evidence selector. The dev-only
LongMemEval adapter adapts public trajectory candidates and uses the same
ranker, but it has no authority to claim LM1 selection semantics. Neither
adapter crosses into Core.

The existing `createLm1Runtime` remains byte-compatible. LM2 adds a separately
named public composition factory, `createLm2Runtime`, rather than silently
changing an LM1 caller's recall behavior. LM0's JSONL protocol and stdio
handler also remain byte-compatible; LongMemEval uses a separate benchmark
transport and memory backend.

### Public ranker, production runtime, and benchmark transport contracts

The shared engine accepts only this validated projection:

```ts
type Lm2Candidate = {
  id: string;
  workspaceKey: string;
  observedAt: string;
  kind: "state_snapshot" | "state_transition";
  text: string;
  sourceDigest: string;
};

type Lm2CandidateStore = {
  list(input: {
    workspaceKey: string;
    limit: number;
    maxCandidateTextCodeUnits: number;
    maxCorpusUtf8Bytes: number;
  }): Promise<{
    candidates: readonly Lm2Candidate[];
    omittedByCorpusLimit: number;
  }>;
};

type ModelDescriptor = {
  provider: string;
  modelId: string;
  revision: string;
  dimensions: number;
  embeddingInputVersion: "lm2-v1";
};

type Lm2RankRequest = {
  workspaceKey: string;
  task: string;
  profile: "safe" | "adaptive";
  model?: ModelDescriptor;
  timeoutMs?: number;
};

type Lm2RankResult = {
  orderedCandidateIds: readonly string[];
  hybrid: HybridReceipt;
};

type Lm2VectorStore = {
  read(input: {
    workspaceKey: string;
    model: ModelDescriptor;
    candidates: readonly Lm2Candidate[];
    maxDecodedBytes: number;
    signal: AbortSignal;
  }): Promise<readonly Lm2VerifiedVector[]>;
};

type Lm2VerifiedVector = {
  candidateId: string;
  vector: readonly number[];
  decodedBytes: number;
};

type Lm2IndexRequest = {
  workspaceKey: string;
  modelFingerprint: string;
  maxRecords: number;
  cursor?: string;
  timeoutMs?: number;
};

type Lm2IndexReceipt = {
  indexedCount: number;
  omitted: readonly { id: string; reason: string }[];
  nextCursor: string | null;
};

type Lm2CaptureService = {
  prepare(input: PrepareCaptureInput): PreparedCapture;
  capturePrepared(input: {
    prepared: PreparedCapture;
    authorization: string;
  }): Promise<{
    published: PublishedLm1Record;
    adaptiveCataloged: boolean;
  }>;
};

type RemoteEmbeddingApprovalPort = {
  assertCurrent(input: {
    workspaceKey: string;
    modelFingerprint: string;
    purpose: "document" | "query";
    approvalRef: string;
  }): Promise<"approved" | "denied" | "revoked" | "unreadable">;
};

type Lm2RuntimeConfig = {
  admittedModels: readonly ModelDescriptor[];
  embeddingEgress: "local" | "remote";
  remoteApprovals: readonly {
    workspaceKey: string;
    modelFingerprint: string;
    approvalRef: string;
  }[];
  queryTimeoutMs: number;
  indexBatchTimeoutMs: number;
};
```

`modelFingerprint` is the lowercase SHA-256 of the canonical JSON
`ModelDescriptor`; it is computed by LM2 and is the only model identity accepted
back from a port or used for a namespace. `provider`, `modelId`, and `revision`
are respectively trimmed strings of 1–128, 1–256, and 1–256 UTF-16 code units;
`dimensions` is an integer from 1 to 4,096.

`Lm2RuntimeConfig` is schema-validated at factory creation: it permits at most
two admitted descriptors, fixes the two timeout ranges stated below, has no
unknown keys, and contains no endpoint or credential. Each remote approval is
an opaque reference for an admitted descriptor, not a cached allow boolean.
The factory requires `config.embeddingEgress` to equal the supplied port's
declared egress class. `EmbeddingPort` implementations are trusted composition
adapters: LM2 can enforce declared policy and never ships an implicit network
adapter, but cannot inspect an arbitrary callback's socket behavior.
Production owns its durable
approval policy at
`<storeRoot>/long-memory/v1/<workspaceKey>/.lm2/remote-embedding-approvals.json`;
the private file-backed `RemoteEmbeddingApprovalPort` reads it with trusted-root
and static-symlink protections. Approval creation, change, and revocation are
explicit operator configuration actions outside capture/index/recall. A missing,
malformed, unreadable, mismatched, or revoked entry is denied.

All identifiers and strings are schema-validated at this port. `id` is unique
within the bounded response, every candidate has the requested workspace key,
and `sourceDigest` is lowercase SHA-256. Candidate text is non-empty and at
most 50,000 UTF-16 code units. The store must return candidates in descending
`observedAt`, then ascending id order, enforce the requested limit and a 64-MiB
UTF-8 aggregate-text ceiling before returning data, and report deterministic
tail omissions in `omittedByCorpusLimit`. The engine rejects any response that
violates this contract rather than mixing workspaces or accepting an unbounded
corpus. The public ranker never receives state keys, evidence ids, correction
pointers, filesystem paths, or credentials.

`createLm2Runtime({ storeRoot, redaction, evidenceBinding, evidenceEligibility,
clock, embedding, config, remoteApproval })` is the only production composition
factory. It accepts the exact LM1 composition inputs, first creates its private
LM1 capture/recall services, and uses that same private `FileLm1Store` for
catalog/direct-id/vector access. It fails before any port invocation or sidecar
operation if its configuration is invalid, or if a remote embedding port lacks
a valid approval port. It validates an `Lm2RecallRequest`, invokes the ranker,
and passes the ordered LM1 record ids to an LM1-only selector. Its result is
`{ items, receipt }`, where `receipt` is the unchanged LM1 receipt plus
`hybrid`. `createLm2Runtime` also exposes an explicit
`index(request: Lm2IndexRequest): Promise<Lm2IndexReceipt>` operation; recall
never creates vectors.
The runtime rejects an index fingerprint that is not in its trusted
configuration, so an API caller cannot create a descriptor namespace.

`createLm2Runtime` returns `Lm2CaptureService`, LM2 recall, and index rather
than silently changing `Lm1Runtime`. Its capture service delegates preparation
and publication to LM1, then updates the bounded LM2 candidate catalog. A
successfully published record with a failed catalog update returns
`adaptiveCataloged: false`; it remains an LM1 record and Safe recall remains
correct. This prevents a post-publication catalog failure from being mistaken
for an unpersisted record or from creating a retry-driven data mutation.

For the production Safe profile, `createLm2Runtime.recall` delegates to the
existing LM1 recall service and decorates its result with a `not_requested`
hybrid receipt. It does not reimplement lexical ranking or selection in the
Safe path. The shared ranker’s Safe behavior exists for public benchmark
projection only; this delegation makes product Safe-equivalence literal rather
than approximate.

The benchmark transport is a separate `lm2-benchmark` command with JSON input
and output schemas owned under `benchmarks/longmemeval-v2/`; it accepts public
trajectory projections, a model descriptor, and an output directory, and
returns the shared ranker's ids/context plus public per-query telemetry. It
does not add an LM2 operation to LM0 stdio, and production packages do not
import benchmark modules.

The production-only `Lm1FusedSelector` port takes the ordered candidate ids and
the original lexical/fused scores, then owns state expansion, closure checks,
evidence resolution, token budgeting, and raw-record output exactly as LM1
does. Its input is capped at 1,000 fused candidates. This makes the additional
LM1 pointer and closure reads explicit rather than smuggling them into the
ranker. The benchmark's `Lm2BenchmarkContextBuilder` instead accepts the
ordered public candidates and the harness token budget, returns only their raw
public text, and records its token decisions. It never calls or imitates
LM1 correction/evidence policy.

## Profiles and ports

```ts
type Lm2Profile = "safe" | "adaptive";

type EmbeddingEgress = "local" | "remote";

type EmbeddingPort = {
  egress: EmbeddingEgress;
  embed(input: {
    model: ModelDescriptor;
    purpose: "document" | "query";
    texts: readonly string[];
    signal: AbortSignal;
  }): Promise<{
    modelFingerprint: string;
    vectors: readonly (readonly number[])[];
  }>;
};

type Lm2RecallRequest = Lm1RecallRequest & {
  profile: Lm2Profile;
  timeoutMs?: number;
};
```

`safe` never invokes `EmbeddingPort`. `adaptive` selects one `ModelDescriptor`
from a trusted, schema-validated runtime configuration; the request cannot
supply a model id. `adaptive` requires both that configured descriptor and a
supplied port. A remote port is rejected at composition unless the same
configuration contains a persisted, workspace-scoped approval for that exact
descriptor fingerprint and remote-processing purpose. The approval covers the
query and the eligible, already-redacted document text sent to the port. A
local port needs no remote approval. LM2 itself never reads credentials,
chooses an endpoint, downloads a model, or retries invisibly.

Immediately before every remote document or query call, the runtime invokes
`remoteApproval.assertCurrent` with the workspace, descriptor fingerprint,
purpose, and configured approval reference. Only `approved` permits the port
call; `denied`, `revoked`, or `unreadable` make recall lexical-only with the
`remote_approval_denied` reason, and make indexing omit the batch without
egress. It rechecks on every call rather than trusting a startup decision.

`timeoutMs` is optional only because the runtime supplies the 1,500-ms default;
its effective value is an integer from 1 to 1,500 ms. The engine creates an
`AbortController`, passes its signal to every embedding call, and aborts it at
the effective deadline. It returns the lexical result on deadline. A port must
honor the signal; any late result is discarded and can neither update a receipt
nor publish a sidecar. The runtime never starts document embeddings during
recall, so a timed-out recall has no in-flight write to complete later.

An `EmbeddingPort` result is accepted only when its returned model fingerprint and
descriptor dimension are exact, the vector count matches the input count, each
vector has that exact dimension, and every component remains finite after
canonical `Float32` conversion. LM2 computes an overflow-safe, non-zero norm
over that canonical float32 vector before storage and recomputes it after
sidecar decode before use. Query and document vectors must have the same
descriptor dimension. A port error, schema failure, `Float32` overflow,
invalid query vector, dimension mismatch, zero norm, timeout, or lack of any
verified document vector degrades the semantic lane. The Safe lexical lane
continues; no semantic score is guessed.

## Bounded Adaptive candidate catalog

LM1's existing file store deliberately has no chronological cursor. LM2 does
not pretend it can page that store by observation time or directory order.
Instead, `createLm2Runtime.capture` maintains this LM2-owned, trusted-root
catalog only after an LM1 record has been published:

```text
<storeRoot>/long-memory/v1/<workspaceKey>/
  .lm2/candidate-catalog-v1.json
```

The catalog is canonical JSON with a schema version, a monotonically increasing
capture sequence, at most 10,000 entries, and a 4-MiB serialized-size cap. An
entry contains only record id, source digest, kind, observed-at value, and
capture sequence; it has no text, state key, evidence id, correction pointer,
or vector. It is atomically rewritten through an exclusive temporary file after
trusted-root/static-symlink validation, then directory-fsynced. An OS-backed
catalog lock serializes capture updates. If the lock or catalog is unreadable,
capture still returns the successfully published LM1 record with
`adaptiveCataloged: false`; it never guesses or rebuilds a catalog by scanning
the LM1 record directory. A duplicate published record id with the same
validated tuple does not allocate a second sequence; a conflicting tuple marks
the catalog corrupt and returns `adaptiveCataloged: false`.

The production Adaptive candidate adapter reads this catalog, validates at most
10,000 entries, and performs bounded direct record reads by id (at most 10,000
records and 64 MiB aggregate UTF-8 text) before ranker validation. It sorts the
bounded resolved projection by `observedAt` descending then id ascending. This
requires a private, trusted `FileLm1Store.readByIds` capability that verifies
the exact workspace/id/source-digest tuple; it never enumerates a record
directory. Safe continues to delegate to the existing LM1 listing/selection
path, unchanged.

The catalog represents the rolling LM2 capture window, not all historical LM1
data. It starts empty for existing workspaces, has no automatic legacy backfill,
and evicts the oldest capture-sequence entries when over capacity. This is an
intentional product truth: older or LM1-only records remain available to Safe,
while Adaptive exposes only its catalog-window coverage in the receipt. A
future explicit, separately approved migration may build a legacy catalog; it
is not implied by LM2.

## Durable vector sidecars

For each LM1 record and admitted model descriptor, LM2 writes an append-only
sidecar under the same trusted workspace root. The namespace is the SHA-256 of
the canonical JSON `ModelDescriptor`, not a caller-provided model id:

```text
<storeRoot>/long-memory/v1/<workspaceKey>/
  embeddings/<sha256(canonical-model-descriptor)>/<recordId>.json
```

Each sidecar contains the workspace key, record id, record kind, source digest,
canonical embedding-input digest, canonical model descriptor, vector dimension,
and a canonical base64 float32 vector. The embedding input is exactly a
versioned canonical projection of the already-redacted record `text` plus its
public `kind`; it contains no `stateKey`, action, evidence id, correction
pointer, source path, workspace key, or other metadata. The sidecar filename
and every stored identity field must match its validated raw record before its
vector can participate.

Sidecars are written with LM1's static-symlink defense, atomic no-clobber
publish, and full directory-chain fsync. A corrupt, dangling, model-mismatched,
or duplicate-conflicting sidecar is never used. It is counted as an invalid
entry and cannot cause an unsafe lexical or evidence fallback.

Existing LM1 data remains valid: it is recalled by Safe immediately. Adaptive
vector materialization happens only through explicit `index`, never in capture
or recall. `Lm2IndexRequest` has one configured model descriptor and a maximum
of 256 records (`maxRecords` is an integer from 1 to 256). Its effective
per-batch timeout defaults to 15,000 ms and is schema-validated from 1 to
15,000 ms; it uses the same abort/no-late-publish rule as query. `cursor` is
an opaque validated continuation token containing the catalog generation and
next capture sequence; the receipt returns `nextCursor` after the last examined
catalog entry. A generation mismatch may resume when its next sequence remains
inside the rolling window; otherwise it returns `cursor_expired` without
scanning raw records. One index call reads at most 1,024 catalog
entries, 1,024 direct raw-record reads, 1,024 sidecar metadata entries, and
16 MiB of raw record text. It may index at most 256 eligible records from that
capture-order page; it makes no chronological or whole-history coverage claim.
Iteration stops before the first eligible record beyond `maxRecords`; the next
cursor points to that unprocessed sequence, never past an eligible record that
was omitted only because of this call's capacity. Terminal outcomes (an already
valid sidecar, malformed/raw-missing record, ineligible evidence, or static
text/batch limit) are recorded in `omitted` and advance the cursor. Transient
outcomes (evidence-cap exhaustion, approval denial, lock busy/unavailable,
embedding failure, or timeout) leave `nextCursor` at the first affected eligible
sequence so a later explicit call retries it. A caller can therefore progress
deterministically without a background scan or permanently losing retained
eligible catalog entries. It
processes batches of at most 16 documents, where every embedding projection is
at most 8,192 UTF-16 code units and every batch is at most 65,536 UTF-16 code
units. A record exceeding either bound is skipped with an index receipt reason;
it is never truncated for embedding.

Before a document enters `EmbeddingPort.texts`, LM2's production adapter applies
the same bounded evidence admission rule as selection: a snapshot requires its
own available, in-workspace, non-high-risk evidence; a transition additionally
requires valid available evidence for both endpoint snapshots. The index has a
256-distinct-evidence cap; exhaustion stops at that record instead of sending
it, so a later explicit page can retry with a fresh bounded evidence budget.
The runtime rechecks this admission immediately before sidecar publish and
discards a vector if eligibility changed. A record that is already revoked,
cross-workspace, unresolved-high-risk, or structurally invalid at admission
never becomes embedding input or a sidecar. If it is revoked after remote
dispatch, LM2 cannot retract an already-sent document; the recheck guarantees
only that no sidecar survives. A stronger egress lease/pin requires an Evidence
Ledger capability outside LM2 scope. The benchmark adapter has no LM1 evidence
identifiers and uses its separately stated public-data admission rule.

There is no background scanner, implicit re-embedding, or migration. Trusted
configuration admits at most two model-descriptor namespaces per workspace. The
aggregate serialized sidecar quota is 128 MiB per workspace and the per-model
record cap is 10,000. The trusted vector store acquires a workspace-scoped,
OS-backed advisory index lock before capacity admission and holds it through
remote embedding and every sidecar publish. Under that lock it computes the
exact current namespace count, record count, and UTF-8 serialized byte total;
it reserves a 24-KiB worst-case allocation for every planned sidecar before
egress and then writes with no-clobber publish. A second process receives
`index_busy` and performs no scan, egress, or write. The operating system
releases the lock on process crash; the next holder recomputes quotas from
durable sidecars, so a partially written entry is ignored by static validation
and cannot reserve capacity forever. If a
platform cannot provide the advisory lock, indexing returns `index_lock_unavailable`
without egress or a process-local fallback.

The index rejects a new namespace or sidecar exceeding any quota before egress
when its size is knowable, never publishes it otherwise, and records the
`storage_limit` reason. This makes arbitrary model-id churn incapable of
creating namespaces or egress calls. LM2 never automatically deletes
user-derived sidecars.

## Retrieval, correction, and selection

Recall has distinct, enforced work budgets rather than a false single-record
cap: the shared ranker receives at most 10,000 initial candidate records; the
candidate store enforces a 64-MiB aggregate UTF-8 text ceiling and reports
deterministic tail omissions; the production selector preserves LM1's
independent 10,000-record state-pointer
expansion and 10,000-record closure lookup budgets; evidence selection remains
capped at 512 distinct ids; semantic vector reads are capped at 10,000 sidecars
and 64 MiB decoded vector data per query; and each lane emits at most 1,000
candidates. The engine ranks at most 1,000 fused candidates. A vector store
checks the semantic deadline between bounded reads and discards an incomplete
batch on abort. A deadline ends only the semantic lane; the lexical/LM1
selection path has its existing behavior and is never claimed to have a
1,500-ms total-latency guarantee.

Recall performs one query embedding at most and never document embedding. A
query whose text exceeds 8,192 UTF-16 code units skips the semantic lane with
the `input_limit` reason; it is not silently truncated. A sidecar is JSON
metadata plus a canonical base64 float32 vector, has a maximum serialized size
of 24 KiB, and is decoded only after validating its descriptor and identity.
Thus semantic input/output work and parsed sidecar bytes remain bounded even
at the 4,096-dimension limit.

Lexical ranking uses the current BM25 implementation over the bounded
projection. Semantic ranking uses overflow-safe cosine similarity over only
identity-verified, descriptor-dimension-matched vectors. Each lane first sorts
every valid hit by score descending, then `observedAt` descending, then record
id ascending; it then assigns one-based ranks and applies the 1,000-candidate
cap. BM25 non-positive scores and non-finite cosine scores are excluded before
this sort. Fusion is:

```text
RRF(record) = Σ 1 / (60 + rank_lane(record))
```

for the lexical and semantic lanes in which a record appears. The final fused
list again sorts by descending fused score, then descending observation time,
then ascending record id. The engine does not normalize or add incomparable raw
BM25/cosine scores.

Adaptive has deliberately explicit partial-index semantics. It can use the
verified vector subset selected within the sidecar-byte budget; missing,
corrupt, wrong-model, wrong-workspace, wrong-dimension, zero-norm, or
over-budget vectors are excluded individually. If at least one verified vector
and the query vector are valid, the lane is `used` or `used_partial_index` and
the receipt reports coverage counts. If none remains or query embedding fails,
the entire semantic lane degrades to lexical-only. Invalid vectors never alter
the lexical lane or LM1 selection.

Fused snapshot anchors enter the existing state-key expansion. A correction
still permanently closes its predecessor; if its expanded pointer/coverage or
closure set is incomplete, the whole state group is omitted. Fused transition
anchors still require their own and both endpoint records' eligible evidence.
The evidence cap remains 512 distinct ids and the token budget remains the
existing 1–100,000 contract. Selection emits raw stored record text only.

At most one current snapshot per state key is selected. Transitions remain
independent candidates. This is the sole diversity rule in LM2; semantic MMR,
query planning, and generated coverage claims are deferred because they would
make receipt explanations weaker without a demonstrated benchmark need.

## Receipt, failure behavior, and observability

LM2 adds a typed `hybrid` receipt section without removing LM1 receipt fields:

```ts
type HybridReceipt = {
  profile: "safe" | "adaptive";
  adaptiveCandidateScope:
    | "not_applicable"
    | "lm2_capture_window"
    | "benchmark_run_cache";
  adaptiveCatalogRecordCount: number;
  candidateInputOmittedCount: number;
  lexicalCandidateCount: number;
  semanticCandidateCount: number;
  fusedCandidateCount: number;
  semanticStatus:
    | "not_requested"
    | "used"
    | "used_partial_index"
    | "degraded";
  semanticReasons: readonly (
    | "missing_vectors"
    | "port_failure"
    | "invalid_vectors"
    | "timeout"
    | "input_limit"
    | "storage_limit"
    | "vector_read_limit"
    | "remote_approval_denied"
  )[];
  indexedVectorCount: number;
  missingVectorCount: number;
  invalidVectorCount: number;
  semanticVectorBytesRead: number;
  queryLatencyMs: number;
};
```

`not_requested` and full `used` have no reasons. `used_partial_index` and
`degraded` have one or more sorted, de-duplicated reasons. This permits the
receipt to distinguish no semantic result from a valid partial semantic result
without conflating missing, invalid, quota-limited, and timeout conditions.
`adaptiveCandidateScope` and `adaptiveCatalogRecordCount` make the product's
rolling-catalog coverage explicit; they must not be presented as all-history
coverage.

`queryLatencyMs` covers only the engine call and uses a monotonic clock passed
through a structural port. It is diagnostic evidence, not a performance claim.
The benchmark adapter writes per-query public-data metadata with profile,
semantic status, candidate counts, coverage counts, model descriptor fingerprint,
and latency. It must not write user paths, record text, credentials, or evidence
ids into benchmark artifacts.

## LongMemEval-V2 adapter and measurement contract

LM2 adds a new benchmark-only backend,
`megasaver_lm2_hybrid`, under `benchmarks/longmemeval-v2/`. It is a separate
Python memory module and configuration from the existing LM0
`megasaver_memory.py`; that existing backend remains unchanged. The new config
requires a public benchmark data root, `lm2-benchmark` command, profile, trusted
model descriptor, explicit public-data remote-egress acknowledgement when
applicable, harness token budget, and an empty output directory owned by the
run. It invokes the separate benchmark transport described above.

The benchmark transport has five schema-validated JSON operations:
`open`, `insert`, `index`, `query`, and `close`. `open` accepts the prepared
public-data root and creates two separate run-owned directories beneath the
declared output root: `cache/` for bounded public vector/index state and
`telemetry/` for append-only per-query metadata. `insert` accepts only a
validated public trajectory projection and stores candidate records in that
cache; `index` materializes public vectors using the same descriptor, batch,
float32-validation, and no-late-publish rules as the shared engine; `query`
reads the public cache and returns text context plus public receipt; `close`
flushes and closes file/process handles. Every cache write is trusted-root,
no-symlink, no-clobber, and bounded by the same namespace/count/byte quotas.
The cache has no path to production stores or user-derived sidecars.

`insert(trajectory)` validates that the public trajectory is beneath the
declared prepared data root, builds only public candidate projections, and runs
explicit bounded indexing before questions are evaluated. `query(query,
query_image=None)` passes the text query to the transport and returns only text
context. It records whether a query image was presented but neither opens it,
embeds it, nor returns it. `post_query_hook(...)` writes one public metadata
record per question containing question id/type, profile, model descriptor
fingerprint, rank/selection counts, semantic status, latency, and
`query_image_present`/`query_image_used: false`. This keeps the limitations of
LM2 observable rather than pretending image recall exists. The Python backend
opens one transport instance in `__init__`, reuses it for all insert/index/query
calls in that memory backend, and invokes `close` from `close`/finalization.
Index/process setup completes before the first evaluated question, so reported
per-query latency does not hide repeated process startup or index build time.

The benchmark gate follows the official harness: prepared and validated data,
the same tier in web and enterprise, complete per-question outputs, the two
domain `aggregated_metrics.json` files, their combined metric file, and the
official leaderboard package builder output including
`submission_overview.json`. The evidence bundle additionally records Mega Saver
commit and adapter/transport digest, benchmark revision and data-preparation
mode, exact reader/judge/embedding implementation and configuration, hardware,
run arguments, all five ability metrics, raw latency samples, and run-time
failures. A LAFS statement is permitted only when the official package's
`submission_overview.json` computes it against the fixed reference frontier;
aggregated metrics alone cannot support that claim. The official harness
requires a backend `insert(trajectory)` and `query(query, query_image=None)`
contract and evaluates both accuracy and query latency across five abilities.
(source: https://github.com/xiaowu0162/LongMemEval-V2)

## Security and privacy invariants

- A Safe query has no embedding-port call and no network side effect.
- A remote-classified Adaptive call is impossible through a trusted embedding
  adapter without the exact workspace/descriptor approval; an unapproved
  composition fails before any embedding call.
- All vector and record reads remain workspace-scoped beneath the LM1 trusted
  root; static symlinks, path mismatch, and malformed JSON fail closed.
- Vector sidecars contain derived vectors over already-redacted text, but are
  still treated as sensitive user-derived data and remain in the local store.
- State keys, evidence ids, correction pointers, paths, credentials, and raw
  query images never enter an embedding projection or a sidecar.
- LM2 sends a document remotely only while it is eligible at admission and
  approved at dispatch. If a post-dispatch revocation races the port, LM2 blocks
  persistence but cannot retract that remote input; an Evidence Ledger egress
  lease is required for that stronger guarantee.
- Semantic failure may remove only the semantic boost. It cannot reactivate a
  corrected state, admit ineligible evidence, exceed a cap, or change stored
  history.
- No profile emits a new textual assertion or includes a query screenshot.
- Benchmark adapters accept only public benchmark paths and must remain outside
  production packages.

## Test and measurement gates

TDD must prove all of the following before implementation is considered ready:

1. Safe never calls the embedding port and returns LM1-equivalent selection for
   the same input, including an out-of-window current-state fixture that needs
   LM1 pointer expansion. LM2 capture uses the same redaction/evidence-binding
   LM1 publication path; catalog failure returns its explicit false result and
   cannot bypass or alter that publication.
2. Adaptive performs deterministic one-based RRF: equal BM25 and equal cosine
   fixtures prove lane-local tie ordering precedes ranks, and a semantic
   paraphrase fixture proves a valid semantic boost can change rank.
3. Invalid, corrupt, dangling, cross-workspace, wrong-descriptor,
   wrong-dimension, zero-norm, huge-finite, or duplicate-conflicting sidecars
   cannot influence a result. Query/document or cross-batch dimension mismatch
   degrades or excludes exactly as the receipt says. A `1e39` component proves
   that Float32 conversion overflow is rejected before write and after decode.
4. The index admission fixture proves revoked, unresolved-high-risk,
   cross-workspace, invalid-transition, and evidence-cap-exhausted LM1 records
   that are ineligible at admission never enter `EmbeddingPort.texts` and never
   gain a sidecar; an eligibility change before publish discards the completed
   vector. A post-dispatch revocation-race fixture documents the permitted
   remote input and proves no sidecar survives.
5. A stalled port receives an abort signal at the effective deadline, recall
   returns lexical-only, no late result changes its receipt or persists a
   sidecar, and concurrent recalls cannot publish each other's result. Missing,
   unreadable, revoked, or mismatched remote approval denies each remote call
   before egress and returns the declared receipt/index reason.
6. Model-descriptor/config/egress-class validation, remote-approval denial, two-namespace cap,
   128-MiB workspace quota, 10,000-sidecar namespace cap, 256-index request
   cap, 16-document batch cap, 8,192-text cap, 65,536-batch-text cap, 24-KiB
   sidecar cap, 1,024-record/sidecar index-scan cap, 16-MiB index raw-text cap,
   64-MiB query-vector cap, 10,000-candidate cap, 50,000-candidate-text cap,
   and 64-MiB candidate-corpus cap are each enforced. A production fixture with
   more than 1,024 LM1 records captured through LM2 proves catalog cursors
   advance within the rolling window without record-directory enumeration; an
   expired cursor and an LM1-only legacy workspace report their limited
   Adaptive coverage honestly. A retained catalog with more than 256 eligible
   entries proves repeated calls eventually attempt every entry and never move a
   cursor past capacity-omitted or transiently failed eligible work. Model churn
   cannot cause an extra namespace, sidecar, or egress call.
7. Cross-process near-limit indexing proves the OS-backed lock serializes
   capacity admission, reserves worst-case bytes before remote egress, returns
   `index_busy` to the loser without a scan or call, and never exceeds the
   durable namespace/count/byte quotas after a crash or malformed partial file.
   An unavailable lock returns `index_lock_unavailable` with no fallback.
8. A semantically retrieved corrected predecessor never resurfaces; incomplete
   pointer/coverage/closure groups remain omitted. The 512-id selection cap,
   10,000 initial/expansion/closure limits, 1,000 per-lane/fused limit, and
   existing token budget are enforced independently.
9. A public-data fixture proves the benchmark adapter and private runtime use
   identical candidate validation, lane ordering, and fusion without importing
   benchmark code into production. It explicitly does not claim identical LM1
   selection; a `query_image` fixture records present-but-unused behavior. The
   benchmark transport's `open/insert/index/query/close` fixture proves its
   run-owned cache/telemetry separation and a single reused process.
10. Existing LM0 exports, JSONL protocol, `createLm1Runtime` behavior, and the
   original benchmark backend stay unchanged; only an explicit LM2 API and
   separate benchmark backend expose hybrid behavior.
11. `pnpm --filter @megasaver/long-memory test`, package build, the Python
    adapter suite, `pnpm verify`, `git diff --check`, fresh code review, and
    fresh adversarial review pass.
12. An official LongMemEval-V2 Small run uses documented data preparation,
    reader/judge/embedding configuration, exact memory config, source and
    adapter revisions, hardware, arguments, per-question telemetry, web and
    enterprise domain outputs, combined metrics, and the official leaderboard
    package builder. Only the resulting `submission_overview.json` can support
    a LAFS claim; a failed or unavailable external model/data environment is
    reported as such.

## Rollback

Disabling `createLm2Runtime` leaves LM1 capture, Safe recall, raw records, and
vector sidecars intact. A model namespace can be abandoned by no longer
selecting it; LM2 never deletes user-derived artifacts automatically. Removing
the benchmark adapter cannot affect the production runtime.

## Spec self-review

- No unspecified model provider, endpoint, credential source, or background
  process is implied.
- The hybrid engine has one responsibility; storage, evidence eligibility, and
  benchmark integration remain separate ports/adapters.
- Safe/Adaptive failure semantics and every cap are explicit.
- LM3 knowledge/media/product work stays explicitly excluded.
- The official-score condition is an external measurement gate, not an
  unverified product claim.
