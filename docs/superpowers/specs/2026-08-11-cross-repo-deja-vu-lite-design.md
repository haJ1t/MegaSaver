---
feature: cross-repo-deja-vu-lite
date: 2026-08-11
risk: MEDIUM
status: draft-design
pending: [user-spec-review, architect-pass]
reviewers: [code-reviewer]
build-order: "5 of 9 (wave-3 batch)"
---

# Cross-Repo Déjà Vu Lite — Local Honest Teaser (P1-2)

## Problem

A developer fixes a flake in repo A, then hits the same shape in repo B and re-derives the fix from scratch. Mega Saver already stores the fix (failure + rule + approved memory) but only recalls within the same workspaceKey. Roadmap 2.5 (`wiki/syntheses/solo-developer-roadmap.md:29` "Déjà Vu — local, redacted cross-project pattern recall with an honest teaser") is the deferred answer. Wave-2 `brain-doctor` and `context-contracts` need a read-only recall to justify "this memory was useful elsewhere" without claiming causality. No recall may leak paths or secrets across repos.

## Goal

1. `mega deja-vu "<error-or-query>" [--limit 8] [--full <id>]` performs **local cross-workspace recall** over `~/.megasaver/store` (all workspaceKeys) using BM25 + path-overlap (`wiki/concepts/failed-run-learning.md` FORGE) and surfaces an **honest teaser**: title, bucket (flake/build/secret/policy), redacted snippet (≤ 200 chars), source workspace hash (not path), and `relevance` score — no raw file path, no secret, no full fix.
2. `--full <teaserId>` resolves **one** full record only after an explicit second command, re-redacts at open time, and shows the approved fix + provenance (`source, timestamp, confidence, expires` per `wiki/concepts/structured-memory-engine.md`). The teaser never contains the fix.
3. No network, no daemon, no embedding model in v1 (lexical only; embeddings are a follow-up that reuses `packages/embeddings`).

Success criteria: query "flaky auth test timeout" recalls a prior FORGE rule from another workspace as a teaser; `--full` shows the fix; teaser never contains the fix body or raw paths; `pnpm verify` green.

## Non-Goals (YAGNI)

- No automatic injection into context packs — teasers are CLI-only in v1 (pack injection is Déjà Vu Full, gates on Context Contracts).
- No cloud, no sync, no `.megabrain` traverse beyond local store (that is `packages/brain-sync`, separate).
- No embedding / vector recall in v1 — BM25 only (follow-up `packages/embeddings` harms determinism if not pinned).
- No mutation of memories/rules — read-only.
- No causality claim ("this memory saved you $X") — counters only, honest-metrics discipline `wiki/concepts/proxy-mode.md`.

## Locked Decisions

1. **Local BM25 over the joined local corpus.** Corpus = all `packages/content-store` chunk sets with `source.kind === "command"|"fetch"` whose label looks like a failure (non-zero `childExitCode` when available, or `failed`/`error` in label) + all `packages/long-memory` LM1 observations + all `wiki/concepts/failed-run-learning.md` FORGE rules + all approved `structured-memory-engine` memories (`packages/core/src/structured-memory`). Preprocessing mirrors `packages/retrieval/src/bm25.ts` (lowercase, split on non-alnum, no stemming) so the scorer is byte-identical. No embedding, so no model download or cache.
2. **Path-overlap is the tie-breaker, not the ranker.** BM25 is primary; `pathOverlap(a,b) = |segments(a) ∩ segments(b)| / max(|a|,|b|)` over repo-relative paths (mirrors FORGE `wiki/concepts/failed-run-learning.md` scoring). Used to break BM25 ties and to boost same-language buckets (js/py/go). Deterministic: score desc → pathOverlap desc → `teaserId` lex.
3. **Teaser is a derived view, never the raw record.** `Teaser = { teaserId: sha256(sourceWorkspaceKey+recordId)[0:8], title, bucket, snippet: redacted truncated 200, sourceWorkspaceHash: sha256(workspaceKey)[0:8], score, pathOverlap }`. `snippet` is `redact()` + 200-char hard cut, no fix body. `recordId` is internal; `teaserId` is the only user-visible handle. Mapping lives only in memory for the lifetime of the command; no persisted index of teasers.
4. **Full-open is a second, explicit command.** `mega deja-vu --full <teaserId>` re-scans the same corpus, recomputes the same BM25 ranking, finds the matching `teaserId`, and only then loads the full record. It re-runs `redact()` before printing. No `teaserId` → `error: unknown teaser` exit 1.
5. **Privacy: workspace path never leaves the teaser as cleartext.** `sourceWorkspaceHash` is 8-char hash; `sourceWorkspaceKey` itself is also a hash (`encodeWorkspaceKey`). No cwd, no home path, no absolute path in teaser. Approved memory content is shown only on `--full`, after re-redaction.
6. **Budget-bounded teaser list.** `--limit` default 5, max 20. Each teaser line is ≤ 120 chars; whole output ≤ 80×24 lines without `--json`. JSON mode emits `Teaser[]` with scores (machine-readable for warm-start or bundle).
7. **Ownership.** `apps/cli` owns the command + BM25 join + teaser derivation; `packages/retrieval` provides the BM25 helper (reuse, not fork); no new store schema; no GUI in v1.

## Architecture

```
mega deja-vu "flaky auth timeout"
  resolveStoreRoot + enumerate all workspaceKeys under store/stats/ + content/
  load corpus: chunk failure labels + LM1 observations + FORGE rules + approved memories (all local, Zod strict)
  retrieval.bm25(query, corpusTexts) -> scored[]
  tie-break by pathOverlap(queryPathHints, recordPaths)
  redact + truncate -> teasers[0:limit]
  stdout: human list (default) | --json array

mega deja-vu --full ab12cd34
  same corpus scan -> find teaserId -> load full record -> redact -> print provenance + fix
```

## Components

- **C1 `apps/cli/src/deja-vu/corpus.ts` (pure):** `loadDejaVuCorpus(storeRoot): CorpusEntry[]` — joins the four local sources, each wrapped fail-open.
- **C2 `apps/cli/src/deja-vu/search.ts` (pure):** `searchDejaVu(corpus, query): Teaser[]` — BM25 + pathOverlap + redact + truncate.
- **C3 `apps/cli/src/commands/deja-vu/index.ts`:** citty `mega deja-vu` command, io-injected `runDejaVu`; registered in `main.ts`.

## Error handling

- Empty store / no corpus → `warning: no prior failures/memories found` on stderr, exit 0 with empty list (not an error — new user).
- Malformed record (Zod fail) → skip with `omission` counted, continue (fail-open).
- Unknown `teaserId` on `--full` → `error: unknown teaser "<id>"` exit 1.
- `--full` without a query-teaser correlation → exit 1, hint `run mega deja-vu "<query>" first`.
- All corpus reads wrapped; no throw escapes the command (mirrors `runCapsuleHook` fail-open).

## Security & privacy

- Teaser is redacted twice: at corpus load (labels are already redacted at persist time, `packages/context-gate/src/record-output.ts:278`) and again at teaser build (`redact()`).
- No raw path in teaser: only `sourceWorkspaceHash` + `bucket`. Full path shown only on `--full`, after redaction.
- No network, no file read of `.env` or key files (unlike sweeper, this feature never enumerates repo files).
- Provenance fields (`source, timestamp, confidence, scope, expires`) are shown on `--full` so the user can judge staleness (anti `wiki/concepts/redos-case-memory-graph.md` stale-memory repetition).

## Testing

- **Unit (TDD):** BM25 ranking (exact match outranks partial), pathOverlap tie-break, teaser truncation (200-char hard cut), hash stability (same workspaceKey → same hash), redaction (secret in label → `[REDACTED]` in teaser), `--full` recompute finds same teaserId, JSON shape.
- **Integration:** tmp store with two workspaces (`wkA`, `wkB`), seed `wkB` with a failed chunk-set `command:"pnpm test auth --timeout"`. `runDejaVu("auth timeout")` → teaser from `wkB` (hash matches `wkB`), no fix body; `--full` → fix body appears + provenance.
- **Privacy regression:** corpus seeded with a secret-bearing label (`AWS_SECRET_ACCESS_KEY=...`) → teaser never contains the secret (exact search for secret value fails).

## Risk & process

**MEDIUM** (§12: read-only cross-workspace recall, privacy-sensitive but no workspace mutation and no network). Reviewer `code-reviewer` only; `security-reviewer` spot-check for hash-not-path guarantee. `pnpm verify` + privacy redaction probe required.

## Dependencies / build order

- Depends on shipped: `packages/retrieval` BM25, `packages/content-store` listing, LM1 observations, FORGE rule shape, structured memory schema.
- Independent of P0/P1 exact landing order, but bundle P1-1 may embed a teaser count as metadata.
- Build order **5 of 9 (wave-3 batch)** — after evidence-bundle, before heatmap (heatmap may plot déjà-vu hit rate).

## Open questions

1. Should `--full` also write the opened record into the current session's intent cache so the next pack sees it? (v1: no — explicit `mega memory recall` remains the intake.)
2. Max corpus size before BM25 latency hurts (< 100ms target) — if > 10k records, shard by workspaceKey prefix? (v1: full scan, streaming; no index yet.)
