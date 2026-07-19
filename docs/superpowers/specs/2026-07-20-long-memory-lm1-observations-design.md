---
topic: long-memory-lm1-observations
status: approved by user direction; architecture and critic review passed
risk: HIGH
date: 2026-07-20
sources:
  - docs/superpowers/specs/2026-07-19-long-memory-runtime-design.md
  - packages/long-memory/src/model.ts
  - packages/evidence-ledger/src/schema.ts
  - packages/evidence-ledger/src/store.ts
  - packages/evidence-ledger/src/atomic-write.ts
  - packages/shared/src/file-lock.ts
---

# Long Memory LM1 — Durable Evidence-Backed Observations

## Decision

LM1 adds a product-ready, append-only observation store to
`@megasaver/long-memory`. It records cited state snapshots and state
transitions, but it does not change `MemoryEntry`, Core Registry, existing
connectors, CLI, MCP, or the LM0 LongMemEval-V2 adapter. LM0's `Observation`,
its in-memory store, and its JSONL protocol remain benchmark-only; LM1 has
separate durable contracts.

LM1 uses structural `EvidenceEligibilityPort`, `EvidenceBindingPort`, and
`RedactionPort` contracts, never a direct Evidence Ledger dependency. Before
preparing an observation, a trusted coordinator deterministically derives every
evidence ID from its evidence intent. LM1's `prepareCapture` is then the single
canonical normalization/redaction point: it returns a sealed-by-digest
`PreparedCapture` but persists nothing. The coordinator uses that exact prepared
text to append or load-verify the prederived evidence IDs, then creates a
binding authorization for the prepared digest. It calls `capturePrepared` only
after this step. The current saver output hook is intentionally best-effort and
is not this API. Production composes the ports with Evidence Ledger; public-data
evaluation can provide equivalent ports without opening a user store. This keeps
Core agent-agnostic.

## Scope

LM1 delivers:

- immutable `state_snapshot` and `state_transition` records;
- canonical source-digest idempotency, workspace isolation, and crash recovery;
- fail-closed evidence binding and eligibility at capture and normal-read time;
- receipt-bearing deterministic state recall over eligible observations;
- trusted-root, atomic no-clobber filesystem persistence; and
- a public TypeScript API with focused integration tests.

LM1 does not deliver semantic retrieval, query planning, reranking, generated
claims, runbooks, gotchas, premises, images, product commands, a generic
cross-store transaction, a generic evidence-retention link, or a migration of
existing engineering memories. Those remain LM2 and LM3 work.

## Architecture and ownership

```text
trusted coordinator / public-data adapter
            │ calls prepareCapture once; uses its exact output
            ▼
  PreparedCapture + opaque binding authorization
            │
            ▼
  LongMemoryCaptureService.capturePrepared
     ├── EvidenceBindingPort
     ├── EvidenceEligibilityPort ──► Evidence Ledger / public-data adapter
     ├── RedactionPort
     └── FileObservationStore ──► immutable content-addressed records
            │
            ▼
  eligible deterministic recall ──► RecallBundle + RecallReceipt
```

LM1 owns `lm1-model.ts`, `lm1-ports.ts`, `lm1-errors.ts`, `lm1-paths.ts`,
`lm1-store.ts`, `lm1-capture.ts`, and `lm1-recall.ts`. The package root retains
every pre-existing LM0 export in `index.ts` unchanged and adds only explicit LM1
exports. LM1 modules must not import LM0 `model.ts`, `rpc.ts`, or `stdio.ts`.
The JSONL host continues to import only the unchanged LM0 protocol. A
fixture-level Python adapter regression and a TypeScript public-surface test
prove both published boundaries.

The evidence-facing contracts are structural and asynchronous:

```ts
type EvidenceEligibilityPort = {
  resolve(input: {
    workspaceKey: WorkspaceKey;
    evidenceIds: readonly LowercaseUuid[];
  }): Promise<readonly {
    evidenceId: LowercaseUuid;
    workspaceKey: WorkspaceKey;
    status: "available" | "retained_metadata_only" | "revoked";
    unresolvedHighRisk: boolean;
  }[]>;
};

type EvidenceBindingPort = {
  verify(input: {
    workspaceKey: WorkspaceKey;
    canonicalCaptureDigest: Sha256;
    evidenceIds: readonly LowercaseUuid[];
    authorization: string;
  }): Promise<{ evidenceDigests: readonly Sha256[] } | null>;
};

type RedactionPort = {
  version: string;
  redact(input: {
    text: string;
    action: string | null;
  }): {
    text: string;
    action: string | null;
    unresolvedHighRisk: boolean;
  };
};
```

`EvidenceBindingPort` is the claim-to-evidence boundary. The trusted
coordinator uses the exact `PreparedCapture` output, including its canonical
capture digest and redaction version, and only issues an opaque authorization
after it has verified that observation against cited post-redaction evidence.
The production adapter binds the authorization to workspace, sorted evidence
ids, their persisted returned-content digests, and canonical capture digest
using a coordinator-held authentication key. LM1 validates it through the port
and persists only the returned evidence-digest commitment, never a secret. An
available same-workspace evidence id therefore cannot be attached to an
unrelated observation through the production composition. The public-data
adapter applies the same contract using fixture-owned authorization material.

`capturePrepared` revalidates `PreparedCapture` and recomputes its canonical
digest before any port call; a mismatch is `evidence_binding_invalid`. It never
calls `RedactionPort` again. It awaits binding verification and evidence
eligibility, validates endpoint records, then atomically publishes the immutable
record. No await occurs inside the per-record publish operation. A changed or
non-idempotent redactor therefore produces a different prepared digest and its
old authorization cannot be replayed. Recall awaits eligibility on its bounded
candidate set every time it reads observations. Any binding or adapter failure
maps deterministically to `evidence_binding_invalid`, `not_found`,
`workspace_mismatch`, `evidence_unavailable`, or `store_corrupt`; an unknown
adapter failure is never treated as eligible.

## Data model and canonical identity

`PreparedCapture` is strict and contains schema version `1`, shared
16-lowercase-hex `workspaceKey`, `kind`, offset-aware ISO-8601 `observedAt`,
bounded redacted `text`, sorted/deduplicated non-empty `evidenceIds`, all
kind-specific fields, a non-empty `redactionVersion`, and its SHA-256
`canonicalCaptureDigest`. It has no `id`, `recordedAt`, authorization, binding
digest, or untyped fields. A durable record preserves those capture fields and
adds a deterministic lowercase UUID `id`, SHA-256 `sourceDigest`, SHA-256
`evidenceBindingDigest`, `recordedAt`, same-length ordered `evidenceDigests`,
and immutable transaction status `recorded`. `text` is at most 50,000 UTF-16
code units; there are at most 64 lowercase UUID evidence ids.

A `state_snapshot` additionally contains a 1–512 UTF-16-code-unit `stateKey`,
one of `value | absence | config | code` as its representation, and an optional
`supersedesSnapshotId`. A correction must reference an already-persisted
snapshot in the same workspace and `stateKey`, have a strictly later
`observedAt`, and cannot reference itself. Since a new immutable record only
points to an older record, correction cycles are impossible. A correction never
edits the old snapshot.

A `state_transition` contains `preSnapshotId`, `postSnapshotId`, at most 5,000
UTF-16-code-unit redacted `action`, and `applied | failed | contradicted` as its
outcome. Both snapshots must already exist in the same workspace and share a
`stateKey`. Their timestamps satisfy pre-snapshot ≤ transition ≤ post-snapshot;
a transition cannot self-reference.

The source digest is SHA-256 over UTF-8 bytes of a schema-and-kind-domain-
separated canonical JSON representation of the full post-redaction capture
payload. All text is Unicode NFC then trimmed; dates are parsed as offset-aware
ISO-8601 and rendered as UTC `toISOString()` values; all object keys are sorted;
and cited evidence ids are lowercased, sorted, and de-duplicated. Optional
fields are explicit `null`, never omitted. `redactionVersion` is included;
`recordedAt` and the opaque
authorization are excluded so retries do not change identity. Equal canonical
content is the same observation. The ID is exactly the first 16 SHA-256 bytes
of `megasaver.long-memory.lm1.id.v1\0` + workspace key + kind + source digest,
rendered as a lowercase RFC-4122 UUID with version 5 and RFC variant bits set.
Golden input/digest/UUID vectors define this format. The binding port returns
one evidence digest for every sorted evidence id, in the same order. LM1 rejects
a duplicate, missing, extra, out-of-order, foreign-workspace, non-available, or
unresolved-high-risk eligibility result. It derives `evidenceBindingDigest` as
SHA-256 of UTF-8 canonical JSON under the exact domain string
`megasaver.long-memory.lm1.binding.v1`, containing workspace key, canonical
capture digest, ordered evidence ids, and ordered evidence digests. This is the
exact value persisted with the record.

Transition citations are required; endpoint citations are not silently
inherited. A record's effective state is derived from immutable snapshots and
their supersession links at read time. Any structurally valid persisted
`supersedesSnapshotId` closes its predecessor permanently for normal state
recall, regardless of the successor's later evidence eligibility. Among
remaining eligible structural leaves for one `stateKey`, the winner is greatest
`observedAt`, then greatest `recordedAt`, then ascending lowercase UUID; this
resolves branches and timestamp ties deterministically. If a correction chain
has no eligible leaf, normal state recall returns no state and records
`omitted_correction_chain_unavailable`; it never falls back to a superseded
predecessor. LM1 persists no mutable current-state index; a rebuildable index is
later scope.

## Evidence-first coordinator protocol

Before calling `prepareCapture`, the coordinator uses bounded, post-redaction
evidence intents to deterministically derive each lowercase evidence UUID from
the first 16 SHA-256 bytes of
`megasaver.long-memory.lm1.evidence.v1\0` + workspace key + source kind +
canonical source reference + raw-content digest + returned-content digest +
policy version + pipeline version, with RFC UUID version/variant bits set. This
is an ID derivation, not a best-effort reservation: the same evidence intent
always yields the same ID before the LM1 observation identity is prepared.

After `prepareCapture` returns, the coordinator first loads each prederived
ledger record before it materializes any chunk. If it exists, the coordinator
validates its immutable intent projection—ID, workspace, session reference,
source kind/reference, classification, redaction report, raw and returned
digests, deterministic `createdAt`/`expiresAt`, policy version, and pipeline
version—against the precomputed evidence intent. It then uses the record's
stored raw chunk-set ID and returned chunk references through a coordinator-owned
payload verifier, re-expands the stored redacted content, and recomputes both
ledger digests. The stored references are adopted only when those recomputed
values exactly equal the evidence intent; missing, unreadable, or
digest-mismatched stored content is `store_corrupt`, not an invitation to
overwrite/rematerialize it.

Only when loading reports `not_found` may the coordinator materialize new chunks
and call the ledger append operation with their references. If that append races
and returns `already_exists`, it discards its unreferenced materialization from
the transaction and performs the same load-and-verify adoption flow. The ledger
record must always be schema-valid, `available`, in the expected workspace, and
free of unresolved high-risk findings. Any mismatch, metadata-only/revoked
status, malformed record, or partial identity set fails closed before
authorization or LM1 persistence.

The deterministic `createdAt` is the canonical observation time and expiration
is a pure policy-versioned function of it; retry never substitutes wall-clock
time. After every evidence record is durable and load-verified, the coordinator
verifies/creates the binding authorization and invokes `capturePrepared`. Crash
cuts are explicit: before an evidence append, retry derives and appends the same
ID; after a subset of appends, retry load-verifies those then appends only
missing deterministic IDs; after all evidence is durable but before
authorization or LM1 publish, retry loads evidence before materializing
anything, verifies its stored references and digests, reconstructs the same
prepared digest, reissues authorization, and publishes; after publish, retry
adopts the original LM1 record. Orphan evidence is safe; an LM1 record pointing
to missing or mismatched evidence is forbidden.

## Persistence, concurrency, and recovery

Observation data lives under a validated shared workspace-key directory:

```text
<storeRoot>/long-memory/v1/<workspaceKey>/
  snapshots/<sourceDigest>.json
  transitions/<sourceDigest>.json
```

LM1 deliberately uses no lease lock: the available shared lock can be stolen
from a paused live owner, so it cannot safely protect a durable write. Immutable
content-addressed paths make a lock unnecessary. Different records have
different paths; identical records use atomic no-clobber temp-file publish
(link/create semantics, followed by directory fsync). An existing target is
parsed and compared with the canonical identity, payload, and binding fields
before returning idempotent success. `recordedAt` is deliberately excluded from
that duplicate comparison: the first persisted record wins and is returned
unchanged on retry. A digest/path mismatch or parse error is `store_corrupt` and
is never overwritten. Concurrent equal capture therefore converges without
writer-lock stealing.

`storeRoot` is a trusted, non-adversarial local directory selected by Mega
Saver, with filesystem access controls excluding hostile concurrent writers.
LM1 refuses a pre-existing symlink at the configured root or any record parent,
and never accepts a symlink as a record file. It does not claim to defend a
same-privilege attacker that races a symlink swap after checks; portable Node
does not provide an `openat`-style root capability. The package documents this
trust boundary and tests static root, intermediate-parent, record, and temp-path
symlinks. This prevents accidental path traversal without a false hostile-root
security claim.

Capture order is: the coordinator prederives evidence IDs from evidence intents;
LM1 `prepareCapture` runs the only observation redaction pass and returns
`PreparedCapture`; the coordinator load-verifies each prederived evidence before
materializing any missing payload, then append/load-verifies it by the protocol
above and issues binding authorization; `capturePrepared` revalidates its digest,
awaits binding verification and evidence eligibility, validates endpoint records,
then atomically no-clobber publishes the deterministic record. A crash before
publish leaves no valid record; a crash after publish leaves the complete
immutable record that a retry adopts.

LM1 never calls Evidence Ledger's `pinEvidence`: that API is deliberately tied
to `MemoryEntryId`. Evidence retention and explicit revocation remain owned by
Evidence Ledger; disabling LM1 stops capture/recall and leaves history inert.

## Retrieval and receipts

LM1 uses deterministic lexical ranking and the LM0 1–100,000 hard token-budget
contract, but its durable records and contracts remain separate from LM0. It
loads at most 10,000 valid immutable records per recall, enumerated by ascending
kind then ascending source digest. It ranks at most 1,000 lexical candidates by
descending score, then descending `observedAt`, then ascending UUID, and
resolves at most 512 distinct evidence ids. A candidate that would exceed the
evidence-lookup cap is omitted as `omitted_evidence_limit`.

A record participates only when all cited evidence is eligible. The public
receipt is exactly `{ selected: { id, score, tokenCount }[], omitted:
{ id, reason }[], scannedRecordCount, candidateCount, evidenceLookupCount }`,
where reason is `omitted_evidence_unavailable`, `omitted_evidence_limit`,
`omitted_budget`, or `omitted_correction_chain_unavailable`; arrays use the same
ranking order. This makes a revoked fact explainably absent rather than falsely
forgotten. Transition text is recalled as a normal item, but its endpoint ids
remain expandable provenance. A transition itself is only eligible when its
citations and both endpoint snapshots remain eligible; an independent snapshot
can still be recalled.

Errors are closed, typed, and deterministic: `invalid_input`,
`evidence_binding_invalid`, `evidence_unavailable`, `workspace_mismatch`,
`not_found`, `invalid_transition`, `store_corrupt`, and `write_failed`.

## Test and acceptance strategy

The implementation must prove:

1. `prepareCapture` applies a redactor exactly once; a modified prepared payload,
   redaction version, or non-idempotent/version-mismatched redactor cannot use
   an old authorization. Snapshots and transitions then round-trip without touching `MemoryEntry`, LM0
   contracts, the JSONL RPC, or the Python benchmark adapter;
2. canonical duplicate capture is idempotent within a workspace but isolated
   across workspaces; golden vectors prove canonical digest and UUID identity;
3. a mismatched, missing, duplicate, extra, out-of-order, foreign-workspace,
   metadata-only, revoked, or
   unresolved-high-risk evidence binding rejects capture; later revocation
   suppresses recall with an auditable receipt reason and never mutates history;
4. transition endpoint, state-key, temporal-order, self-reference, and
   workspace rules fail closed; correction history remains append-only and
   resolves branches and ties deterministically; revoking a correcting snapshot
   never reactivates its superseded predecessor;
5. exact-digest retries, concurrent duplicate capture, restart durability, and
   simulated pre-publish failure converge without a parseable partial record;
   corrupt digest/path records and static symlink paths fail closed;
6. an evidence-durable / authorization-and-LM-absent crash retry loads the
   original evidence before materializing chunks, re-verifies its stored refs
   against raw/returned digests, and adopts one original LM1 record;
7. bounded recall has exact scan, candidate, evidence-lookup, score, tie-break,
   budget, and receipt behavior and only returns eligible facts;
8. a public-data evidence/binding port exercises the identical capture API
   without opening a Mega Saver user store; and
9. package dependencies prove LM1 has no Core, connector, benchmark, or LM0
   protocol import; a public-surface type fixture proves every prior LM0 root
   export remains available unchanged.

The LM1 completion gate is `pnpm verify`, package integration evidence, an
independent architecture/critic pass, and a public-data adapter contract test.
No “world-best” performance claim is permitted until LM2/LM3 and a reproducible
official LongMemEval-V2 accuracy-latency result exist.

## Spec self-review

- No migration, CLI, MCP, semantic, media, or generated-knowledge work is
  implied by this slice.
- Evidence binding, eligibility, and unresolved-secret status are checked before
  persistence; eligibility is checked again on normal recall. History remains
  append-only.
- The retry-stable evidence-first rule permits safe retries without pretending
  two independent stores form a distributed transaction.
- Immutable no-clobber publishing avoids the stale-stealable lease lock. The
  trusted-root boundary is explicit rather than overclaiming a portable
  symlink-race defense.
- The canonical format, bounded retrieval, current-state graph, error outcomes,
  and crash recovery rule are explicit enough to test without timing tricks.
