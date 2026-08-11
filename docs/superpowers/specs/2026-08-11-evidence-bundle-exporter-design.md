---
feature: evidence-bundle-exporter
date: 2026-08-11
risk: MEDIUM
status: draft-design
pending: [user-spec-review, architect-pass]
reviewers: [code-reviewer]
build-order: "4 of 9 (wave-3 batch)"
---

# Evidence Bundle Exporter — `mega pr bundle` (P1-1)

## Problem

Review packs (wave-1 C2 `docs/superpowers/plans/2026-08-06-review-packs.md`) and claim-verification-gate (wave-1 C3) both produce evidence — digests, receipts, `childExitCode` — but the author still hand-writes the PR description and the reviewer still has no single verifiable artifact to check. The gap between `wiki/syntheses/vibe-coding-pains-2026.md:83` P4 "teams generate faster than they can verify" and the store is a **bundle** that joins preflight snapshots (P0-1), sweep manifests (P0-2), chunk-set pointers, and exit-code receipts into one markdown + JSON the author can paste and the reviewer can re-verify.

## Goal

1. `mega pr bundle [--base <ref>] [--head <ref>] [--preflight <id>] [--quarantine <id>] [--why <query>]` assembles an **evidence bundle**: `bundle.md` (human, paste-ready PR body) + `bundle.json` (machine, Zod strict, hash-chained) from store pointers — diff manifest, test receipts, coverage hint, drop-inspector summary, and lineage hashes.
2. `mega pr verify <bundle.json>` re-verifies the bundle against the current store + git (hashes, exit codes, fence checks) and reports `pass | fail | stale` per section — no LLM, deterministic.
3. Bundles are **write-once, content-addressed**: `bundleId = sha256(canonicalJson)[:12]`, stored at `store/bundles/<bundleId>.json` and rendered to `bundle-<id>.md` beside it.

Success criteria: bundle for a dirty worktree contains diff + quarantine + test receipts with hashes; `verify` catches a stale `childExitCode` (receipt says 0, rerun says 1) and a missing chunk-set; `pnpm verify` green.

## Non-Goals (YAGNI)

- No GitHub API, no `gh pr create` — bundle is a file the user pastes or `gh pr create --body-file` consumes.
- No LLM PR summary — section headers are fixed, content is counters + hashes + pointers.
- No new CI — local `verify` only; CI consumption is follow-up.
- No merge/branch mutation — read-only over git and store.

## Locked Decisions

1. **Bundle schema (Zod strict) is the contract.** `EvidenceBundle = { version:1, bundleId:string, createdAt:string, git:{base,head,baseOid,headOid,diffStat:{files,insertions,deletions}}, preflight:{snapshotIds:[string,string]|null, diffHash:string|null}, sweep:{quarantineId:string|null, manifestHash:string|null}, tests:{receipts:{kind,command,chunkSetId,exitCode,hash}[], verified:boolean}, context:{whyQuery:string|null, scorerConfigHash:string|null, keptIds:string[], droppedIds:string[]}, lineage:{bundleHash, storeRootHash, contentStoreListHash}, redacted:boolean }`. Every path redacted via `redact()` once at bundle build; content hashes are sha256 of chunk-set bytes, not of redacted text.
2. **Content-addressed identity.** `bundleId = hex(sha256(canonicalJson(bundle without bundleId)))[0:12]` where canonical = sorted keys, no whitespace, `JSON.stringify`. `bundleHash = sha256(bundle.json)` stored inside for self-check. `storeRootHash = sha256(listChunkSetIds sorted)` at build time so `verify` can detect store GC drift.
3. **Git diff is stat, not patch.** `git diff --numstat <base>..<head>` + `git rev-parse <ref>` via `execFile` 2s timeout (same as P0-1) give `diffStat`; patch bodies stay in chunk-sets. Base defaults to `origin/main` if it exists else `HEAD~1`; head defaults to `HEAD`. Both overridable.
4. **Test receipts come from the store, not re-execution.** Bundle joins `TokenSaverEvent` / `claim-verification-gate` receipts (`childExitCode` owned by that pair, `docs/superpowers/specs/2026-08-06-claim-verification-gate-design.md` LD1) on `chunkSetId` — exactly how `review-packs` will digest them. If the gate is not yet landed, bundle falls back to `content-store` listings of `command` chunks and labels `tests.verified = false` with `reason:"gate not available"` (feature-flagged, not a second ledger).
5. **Context section is optional and derived from P0-3.** When `--why <q>` is given, bundle embeds the drop-inspector's `scorerConfigHash` + `keptIds`/`droppedIds` (no scores — just ids + counts). Without `--why`, section is `null`.
6. **Verify is hash-join, not re-run.** `mega pr verify` re-hashes the chunk-sets by `chunkSetId`, re-`git rev-parse`s base/head, and re-checks `isFencedPath` on the diff file list. It reports per section `{status:pass|fail|stale, expected, actual, message}`. It never executes tests.
7. **Ownership.** `apps/cli` owns bundle assembly + verify; `@megasaver/content-store` provides `listChunkSets`/`readChunkSet` read-only; `@megasaver/policy` provides `redact` + fence check; no new package.

## Architecture

```
mega pr bundle [--base A] [--head B] [--preflight <id>] [--quarantine <id>] [--why "fix auth"]
  resolveStore + findProjectByCwd + captureGitState
  load preflight snapshots (P0-1) if given -> diffHash
  load quarantine manifest (P0-2) if given -> manifestHash
  listChunkSets + join receipts on chunkSetId -> tests.verified
  if --why: call inspectPack (P0-3) pure -> context ids + scorer hash
  buildEvidenceBundle -> canonicalJson -> bundleId -> atomicWrite store/bundles/<id>.json + <id>.md
  stdout: bundle path + md path

mega pr verify <bundle.json>
  parse bundle (Zod strict) -> re-derive storeRootHash + git oids + chunk hashes
  -> per-section pass/fail/stale -> overall 0|1 + JSON (--json)
```

## Components

- **C1 `apps/cli/src/bundle/schema.ts`:** `evidenceBundleSchema`, `canonicalJson`, `bundleIdOf`, `hashBytes`.
- **C2 `apps/cli/src/bundle/build.ts` (pure):** `buildEvidenceBundle(input): EvidenceBundle` + `renderBundleMd(bundle): string` (fixed section order, no LLM).
- **C3 `apps/cli/src/bundle/verify.ts`:** `verifyBundle(bundle, ctx): VerifyReport` (pure) + `runBundleVerify` (io, git re-hash).
- **C4 `apps/cli/src/commands/pr/bundle.ts` + `verify.ts` + `index.ts`:** citty `mega pr bundle|verify`; registered in `main.ts`.

## Error handling

- No git / no project match → `error: no git repo / no registered project` exit 1 (bundle needs both).
- Unknown preflight/quarantine id → `error: snapshot/quarantine "<id>" not found` exit 1 before any bundle write.
- Malformed bundle.json on verify → `error: invalid bundle (schema)` exit 1, fail-closed.
- Store GC drift (`storeRootHash` mismatch) → section `stale`, not `fail`; message `"store changed since bundle (GC or new chunks)"`.
- All `execFile` git calls time out 2s → `{available:false}` and that section becomes `stale` rather than failing the whole bundle.

## Security & privacy

- Every user-facing path in bundle.md is redacted once (`redact()`); hashes are over raw bytes so redaction does not weaken integrity.
- Bundle file 0600, md sidecar 0644 (user may paste); both under `store/bundles/` (0700 dir).
- No secrets in bundle.json: chunk-set texts are never embedded, only `chunkSetId` + `sha256`.

## Testing

- **Unit (TDD):** schema strictness (extra key rejects), canonicalJson stability (key order irrelevant → same bundleId), hash drift detection (flip one byte → verify fails), verify stale vs fail (GC hash vs chunk hash), md renderer section order, fence check on diff file list.
- **Integration:** tmp store + tmp git repo (`git init`, commit A, branch + file, `mega preflight snapshot`, `mega sweep quarantine` a.tmp) → `mega pr bundle --why "fix"` writes bundle + md containing `bundleId`, `preflight` hash, `quarantineId`; `mega pr verify` on that bundle → `pass`; delete a chunk-set file → `fail`; add a new chunk-set → `stale`; `--json` parses.
- **Regression:** existing `listChunkSets` still green with bundles present (bundles live under `store/bundles/`, not `content/`).

## Risk & process

**MEDIUM** (§12: read-only joins over shipped surfaces, writes one new dir `store/bundles/`). Reviewer `code-reviewer` only; architect pass recommended due to bundle-as-contract ambition. `pnpm verify` + bundle round-trip smoke required.

## Dependencies / build order

- Consumes **P0-1 preflight** (`listPreflightSnapshots`) and **P0-2 sweep** (`quarantine manifest`) as optional inputs; consumes **P0-3 drop-inspector** pure when `--why` is used. Soft dependency on **claim-verification-gate** (wave-1) for `tests.verified = true` (graceful fallback otherwise).
- Build order **4 of 9 (wave-3 batch)** — after P0 trio, before cross-repo recall (which may later embed a bundle id as provenance).

## Open questions

1. Should `bundle.md` include the full `git diff --stat` listing (up to N files) or only `diffStat` counters? (v1: counters + first 50 paths, remainder "+N more".)
2. Bundle retention = content-store prune horizon (7 days) or 30 days for PR longevity? (v1: 30 days, prune job is follow-up.)
