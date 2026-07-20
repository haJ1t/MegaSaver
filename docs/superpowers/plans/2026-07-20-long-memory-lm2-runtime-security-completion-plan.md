# LM2 Runtime, Benchmark, and Security Completion Implementation Plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` and
> `superpowers:test-driven-development`. This is HIGH risk: every task gets a
> fresh implementation context and independent reviewer. Do not merge or push
> until the whole-branch verification and architecture/adversarial reviews pass.

**Goal:** Turn the reviewed LM2 primitives into an end-to-end, secure production
runtime and LongMemEval-V2 backend while resolving every Critical/Important
whole-branch review finding.

**Architecture:** A separate `createLm2Runtime` composes private LM1/LM2
services. A separate `lm2-benchmark` JSONL transport and Python memory module
use public benchmark data only. Filesystem operations remain bounded and
descriptor-guarded; runtime ports become strict/degrading rather than throwing.

**Tech Stack:** Node 22, TypeScript strict/ESM, Zod, Vitest, `fs-ext`, Python
3, and the pinned LongMemEval-V2 checkout.

## Global constraints

- Preserve `createLm1Runtime`, LM0 RPC/stdio, Core, connectors, and benchmark
  isolation. No LM2 operation is added to LM0 stdio.
- The public runtime and benchmark may not deep-import unexported package files.
- The benchmark transport is a benchmark-only executable entry. It is never
  re-exported from `@megasaver/long-memory`'s production root or LM0 stdio.
- Every source file is <=300 LOC; split responsibility rather than compressing
  safety logic.
- No official LongMemEval score, LAFS, or leaderboard claim without the actual
  official artifact set described in the completion amendment.
- The only documented filesystem limitation is tampering by any actor able to
  mutate the trusted root (including matching ledger/lock/sidecar content and
  ABA windows); detected malformed or identity-mismatched state fails closed.
- Benchmark filesystem guarantees begin only after the unmodified official
  `Memory` base dispatches to Mega Saver; upstream `memory_config.json` and its
  parent are outside that backend-owned guarantee.

### Task 1: Harden port, receipt, cleanup, and exact egress-plan boundaries

**Files:**

- Create: `packages/long-memory/src/lm2-port-safety.ts`
- Create: `packages/long-memory/src/lm2-index-plan.ts`
- Modify: `packages/long-memory/src/lm2-semantic-lane.ts`
- Modify: `packages/long-memory/src/lm2-index-operation.ts`
- Modify: `packages/long-memory/src/lm2-lock.ts`
- Modify: `packages/long-memory/src/lm2-secure-publish.ts`
- Modify: `packages/long-memory/src/lm2-index-batches.ts`
- Modify: `packages/long-memory/test/lm2-ranker.test.ts`
- Modify: `packages/long-memory/test/lm2-index-operation.test.ts`
- Modify: `packages/long-memory/test/lm2-index.test.ts`

- [ ] Write RED tests for top-level and nested throwing getters/proxies; a blocked
   pending conflict on the same receipt; temporary close/unlink, ledger-anchor
   close, lock-close, and multiple cleanup failures; and a batch-plan attempt
   at subset, reorder, duplicate, cross-operation, post-mutation, expiry, and
   reused consumption with zero extra egress; include 17 eligible records to
   prove batch 1 consumes after batch 0 while batch-0 remint/replay sends none.
- [ ] Add recursive descriptor-safe port snapshots that degrade only Adaptive to
   lexical output; expose a held-operation sequence with at most one
   outstanding one-shot batch token binding operation id, batch number,
   generation, workspace/model, deadline, previous identity digest, and
   immutable candidate digests; make the publisher consume it internally for
   exact egress; and make cleanup release locks independently before returning
   the normative blocked receipt.
- [ ] Verify focused rank/index/operation RED->GREEN, typecheck, Biome, and a
   fresh independent review.

### Task 2: Bind sidecars to candidates and guard ledger durable replacement

**Files:**

- Modify: `packages/long-memory/src/lm2-vector-format.ts`
- Modify: `packages/long-memory/src/lm2-vector-sidecars.ts`
- Modify: `packages/long-memory/src/lm2-secure-publish.ts`
- Modify: `packages/long-memory/src/lm2-index-operation.ts`
- Modify: `packages/long-memory/src/lm2-secure-fs.ts`
- Modify: `packages/long-memory/test/lm2-vector-store-read.test.ts`
- Modify: `packages/long-memory/test/lm2-index-operation.test.ts`
- Modify: `packages/long-memory/test/lm2-vector-store-validation.test.ts`

- [ ] Write RED tests for a stale/mismatched candidate sidecar, post-rename ledger
   content replacement, and temporary unlink failure that must remain blocked.
- [ ] Verify candidate id/source/input/model/epoch/sequence/dimensions/canonical
   Float32 provenance before semantic scoring; read the exact renamed ledger
   through its anchored directory and compare expected serialized
   generation/epoch/lock-token/content digest before accepting its identity;
   retain failed cleanup in named pending state.
- [ ] Verify focused storage/index tests, bounded metadata calls, typecheck,
   Biome, and independent review.

### Task 3: Split and harden the LM2 candidate catalog

**Files:**

- Create: `packages/long-memory/src/lm2-catalog-schema.ts`
- Create: `packages/long-memory/src/lm2-catalog-lock.ts`
- Create: `packages/long-memory/src/lm2-catalog-storage.ts`
- Modify: `packages/long-memory/src/lm2-catalog.ts`
- Modify: `packages/long-memory/test/lm2-catalog.test.ts`

- [ ] Write RED real-process tests for old-inode writer A/new-inode writer B,
   lock-path replacement while idle/held, catalog symlink reads/writes,
   anchor-close failure, V1 invalidation, crash after orphan lock, crash after
   V2 control before empty catalog, and two appenders that otherwise lose an
   entry.
- [ ] Move V2 cursor/schema, anchored durable storage, and fixed-inode/token lock
   responsibilities into separate modules. Persist immutable catalog-lock
   `{device,inode,token}` in the V2 control record, validate it before every
   acquisition/mutation/release, use the fixed V2 catalog/control/lock paths,
   explicitly invalidate V1 without migration or overwrite, recover only the
   named orphan/control states, and release locks independently on all cleanup
   failures.
- [ ] Verify catalog and full long-memory tests, typecheck, Biome, and independent
   review.

### Task 4: Compose and export the production LM2 runtime

**Files:**

- Create: `packages/long-memory/src/lm1-fused-selector.ts`
- Create: `packages/long-memory/src/lm2-runtime.ts`
- Create: `packages/long-memory/test/lm2-runtime.test.ts`
- Modify: `packages/long-memory/src/lm1-recall.ts`
- Modify: `packages/long-memory/src/lm2-model.ts`
- Modify: `packages/long-memory/src/index.ts`
- Modify: `packages/long-memory/test/index.test-d.ts`
- Modify: `packages/long-memory/test/lm1-runtime.test.ts`

- [ ] Write RED runtime tests for literal Safe delegation/no semantic I/O even
   with throwing structural ports; Adaptive fused LM1 selection using the sole
   `activeRecallModelFingerprint`; catalog update after LM1 capture; invalid
   factory schema and active model before ports; each local/remote ×
   embedding/approval matrix outcome and exact degraded reason; separate string
   `clock` and numeric `monotonicClock`; trusted-model index rejection; and
   public export.
- [ ] Factor LM1's selector without changing its existing recall result; implement
   `createLm2Runtime` with private shared store/catalog/vector/index services;
   expose capture, recall, and index; validate `activeRecallModelFingerprint`;
   preserve separate clock types and LM1 failure semantics.
- [ ] Verify LM1+LM2 runtime suites, typecheck, API declarations, Biome, and an
   independent product/architecture review.

### Task 5: Build the separate LongMemEval-V2 backend and transport

**Files:**

- Create: `packages/long-memory/src/lm2-benchmark.ts`
- Create: `packages/long-memory/test/lm2-benchmark.test.ts`
- Create: `benchmarks/longmemeval-v2/megasaver_lm2_hybrid.py`
- Create: `benchmarks/longmemeval-v2/megasaver_lm2_hybrid.json`
- Create: `benchmarks/longmemeval-v2/build-lm2-manifest.mjs`
- Create: `benchmarks/longmemeval-v2/install-lm2-backend.mjs`
- Create: `benchmarks/longmemeval-v2/official-contract-6f020ac2.json`
- Create: `benchmarks/longmemeval-v2/test_megasaver_lm2_hybrid.py`
- Modify: `benchmarks/longmemeval-v2/README.md`
- Modify: `packages/long-memory/package.json`
- Modify: `packages/long-memory/tsup.config.ts`

- [ ] Write RED tests for stateless `open/insert/query` process calls; the V1
   manifest schema/digest, fixed Hugging Face revision/checksum verification,
   pinned official data-validator invocation, and same TypeScript canonical JSON
   path plus the required canonical test vector for builder and transport; exact
   `states`/`content` projection, UUIDv5
   name framing, text bound, timestamp fallback, source/input digest rows, and
   question allowlist; full-object mismatch;
   synchronous insert-time indexing; durable insertion-chain advance; exclusive
   per-instance/haystack sentinel; concurrent JSONL serialization; no-follow
   path/mode/owner/FIFO/device/pre-created-child rejection; query-image ignore;
   telemetry redaction; no child leak; and empty-list versus non-empty-text
   outputs. Add Python tests against the real pinned official `Memory` base for
   shared/non-shared/save-load where static configs pass the official exact
   reconciliation and original realpath/device/inode succeeds while moved,
   copied, and linked state fails before transport; unknown,
   substituted/private query rejection; cross-domain/tier replay; remote
   benchmark configuration rejection; poisoned answer/eval context; and zero
   transport/egress on rejected queries.
- [ ] Implement the manifest builder and benchmark-only public-data transport/cache
   with lazy constructor, chain-bound control record, question-context admission,
   and strict local-only benchmark model validation. The Python `Memory` backend
   reads only `question_id` from official query context, never guesses a
   haystack or reads `question_item`, verifies the fixed data revision/checksums
   plus official data validator, and returns `[]` before launching transport for
   an unmatched query or chain. Install it idempotently into a
   verified official checkout at
   `6f020ac2fc3275e46c706d3406e02c3ed79b7be2`: verify all recorded baseline
   hashes, allow only the explicit `memory.py` import plus backend file, and
   leave harness/builders byte-identical. It serializes durable state per
   operation, returns only non-empty text items when it returns items, has no
   production workspace access, and exposes a separate executable bin without a
   production-root transport export. Preserve and extend the LM0 README.
- [ ] Verify Node tests, Python compilation/tests, build, typecheck, and independent
   benchmark-contract review.

### Task 6: Official-evidence gates, durable docs, and final review

**Files:**

- Create: `benchmarks/longmemeval-v2/evidence-schema.json`
- Create: `benchmarks/longmemeval-v2/verify-official-artifacts.mjs`
- Create: `packages/long-memory/test/lm2-completion-integration.test.ts`
- Modify: `wiki/concepts/long-memory-runtime.md`
- Modify: `wiki/log.md`
- Modify: `wiki/agent-channel.md`

- [ ] Add RED integration/evidence tests requiring the pinned official/data
   revision (`6f020ac2fc3275e46c706d3406e02c3ed79b7be2`) and mode, public telemetry,
   Hugging Face revision/checksums and official data-validator result,
   reader/judge/embedding configuration,
   hardware, the five official dashboard values (`overall_full_set`, gotchas,
   static, dynamic, procedure), raw latency samples, failures, complete run
   arguments, adapter/transport digests, pre-install baseline and post-install
   allowlisted diffs, both-domain aggregates, combined metrics, and the complete
   successful official builder package/tarball before any official-score
   assertion.
- [ ] Add the evidence verifier that executes/validates the pinned official
   step-1/step-2 builders, update the trusted-root limitation in durable docs,
   and run the entire monorepo gate.
- [ ] Run `pnpm verify`, benchmark/build/Python verification, fresh whole-branch
   architecture review, fresh adversarial review, and update project memory.
