---
feature: brain-adopt
date: 2026-08-06
risk: HIGH
status: draft-design
pending: [user-spec-review, architect-pass]
reviewers: [code-reviewer, critic]
build-order: "20 of 20 (wave-2 batch)"
---

# Brain Adopt (`mega adopt`)

## Problem

The flagship differentiator — "what one agent knows, every agent
inherits" — currently starts from an empty brain. Every real repo
already carries months of hand-written agent knowledge (`CLAUDE.md`,
`AGENTS.md`, `.cursor/rules/*.mdc`, `CONVENTIONS.md`, `.aider.conf.yml`
read-pointers), but none of it is in the memory engine, so nothing
flows through the approval gate or out via `mega connector sync` —
the user's best content is stranded in per-agent silos.

## Goal

`mega adopt <project>` scans the project root for existing agent files,
parses their rule/convention content deterministically into typed
`MemoryEntry` records — source citation (`file:line`), `source:
"manual"`, `scope: "project"`, §13 metadata, confidence per rubric —
and queues them as `approval: "suggested"` behind the EXISTING gate.
The human reviews via the existing `mega memory review` /
`mega memory approve|reject` (verified: `runMemoryReview` in
`apps/cli/src/commands/memory/review.ts`; `memoryApproveCommand` /
`memoryRejectCommand` in `apps/cli/src/commands/memory/approve.ts`;
test `apps/cli/test/memory-review.test.ts`). On approval, the normal
`mega connector sync` machinery (§7) emits them into every OTHER
detected agent's sentinel block. Adopt itself writes NO agent files.

## Non-Goals (YAGNI)

- No LLM calls in v1 (see Open Questions for the flagged `--llm` mode).
- No writes to any agent file; propagation is `connector sync`'s job.
- No auto-approval; every adopted entry crosses the human gate.
- No wiki (`wiki/`) scanning; agent-config dialects only.
- No new package and no core changes: dialect parsing is agent-file
  logic and stays out of `@megasaver/core` (§13 anti-pattern).
- No semantic/embedding dedup at suggest time; approve-time machinery
  (`handleApproveMemory` near-dup surfacing, duplicate auto-reject)
  already owns that (`packages/mcp-bridge/src/tools/approve-memory.ts`).
- Write-side verification of agent-sourced writes is owned by the
  wave-2 `memory-write-verify` feature
  (`docs/superpowers/specs/2026-08-06-memory-write-verify-design.md`,
  build-order 9 of 20 in the wave-2 batch, plan alongside it). Adopt's
  entries are `source: "manual"` (user-authored text) and flow through
  the suggested gate regardless, so adopt does not block on it.

## Locked Decisions

1. **Scanner lives in `apps/cli/src/adopt/`** (pure modules) +
   `apps/cli/src/commands/adopt.ts`. CLI is the composition layer and
   already depends on `@megasaver/core`, `@megasaver/connectors-shared`
   and `@megasaver/policy` (verified `apps/cli/package.json`).
2. **Deterministic, structure-based parsing.** Headings, bullets, and
   anchored imperative-line heuristics per dialect. All patterns are
   literal-anchored alternations — linear time, no nested quantifiers
   ([[concepts/unbounded-run-redos]] discipline).
3. **Dialects v1:** `CLAUDE.md`, `AGENTS.md`, `CONVENTIONS.md`
   (markdown headings + bullets + paragraphs); `.cursor/rules/*.mdc`
   (YAML frontmatter skipped, markdown body parsed); `.aider.conf.yml`
   parsed ONLY for `read:` pointers (scalar or list) to extra markdown
   files, minimal line-based extraction — no YAML dependency added.
   Pointer targets must resolve inside the project root (escape guard).
4. **Managed-block exclusion.** All four sentinel pairs from
   `@megasaver/connectors-shared` (`MEGA_SAVER_BLOCK_*`, `_CG_`,
   `_WS_`, `_HANDOFF_`; `packages/connectors/shared/src/constants.ts:1-8`,
   re-exported by `packages/connectors/claude-code/src/constants.ts`)
   are stripped before parsing. Belt-and-braces: any candidate where
   `containsSentinel(text)` is true is skipped and counted — never
   adopt what conventions-sync/connector-sync generated;
   `ConnectorContextSchema` would reject such content at sync anyway
   (`packages/connectors/shared/src/context.ts:64`).
5. **Chunking granularity:** one memory per rule-ish unit — a bullet
   item (with its indented continuation lines) or a blank-line-delimited
   paragraph. Heading trail (h1–h3) is tracked for title/keywords.
   Bounds: `ADOPT_MIN_CANDIDATE_CHARS = 24`,
   `ADOPT_MAX_CANDIDATE_CHARS = 800` (post-trim); out-of-bounds units
   are skipped and counted.
6. **Confidence rubric:** unit whose (marker-stripped) first line
   matches the anchored imperative pattern (always/never/don't/do
   not/must/use/prefer/avoid/no/only/keep/run) → `"high"`; prose
   observation → `"medium"`. `type: "project_rule"` for all v1 entries.
7. **Redact-then-hash.** `redact()` from `@megasaver/policy`
   (`packages/policy/src/redact.ts:44`) runs on every candidate BEFORE
   hashing and persist, mirroring `importBrain`'s "dedupe on the
   REDACTED content" rule (`packages/core/src/brain-import.ts:46-55`).
8. **Idempotent re-adopt via content-hash dedup.**
   `normalizedAdoptHash = sha256(lowercase(collapse-whitespace(
   redactedContent)))`, compared against the same normalization of the
   `content` of ALL existing project-scoped entries — suggested,
   approved, AND rejected (`listMemoryEntries` returns all approval
   states; precedent `brain-import.ts:32-37`). Rejected rows are kept
   for audit and never deleted by the gate, so a rejected adoption is
   never re-suggested unless the source text changed (changed text ⇒
   new hash). Intra-run dedup uses the same set. No sidecar ledger.
9. **House create pattern.** Entries are built with
   `memoryEntrySchema.parse({...})` and written via
   `registry.createMemoryEntry` (`packages/core/src/registry.ts:83`),
   mirroring the `importBrain` suggested-gate call site
   (`brain-import.ts:57-69`): explicit `approval: "suggested"` (the
   schema defaults to `"approved"`, `memory-entry.ts:89`),
   `sessionId: null` with `scope: "project"` (superRefine invariant),
   `keywords: stripReservedKeywords(...)` (exported from
   `@megasaver/core`), `evidence: ["adopt:<relPath>:<line>"]`,
   `relatedFiles: [relPath]`, caller-minted id + timestamps. NOT
   `saveMemoryWithLineage`: a suggested row must not auto-close
   approved rows; conflict/supersession/dup handling runs at approve
   time (`handleApproveMemory`, spec-§8 duplicate auto-reject).
   `source: "manual"` keeps the approve gate's human-authored path
   (no resolvable-evidence requirement, `approve-memory.ts:102`).
10. **Batch cap:** default 100 suggestions per run, `--cap <n>`
    override. Candidates are ordered deterministically (fixed file
    order, then line order); the remainder is reported as `capped` and
    drained by re-running (dedup makes re-runs cheap and safe).
11. **Adopt is read-only outside the store.** It writes MemoryEntry
    rows only. Approved entries reach other agents through the
    existing sync path, which emits only recallable rows
    (`isRecallable` filter, `apps/cli/src/commands/connector/shared.ts:49`).

## Architecture

```
mega adopt <project> [--dry-run] [--cap N] [--json] [--store DIR]
  discover (project.rootPath)          apps/cli/src/adopt/discover.ts
    CLAUDE.md | AGENTS.md | CONVENTIONS.md | .cursor/rules/*.mdc
    .aider.conf.yml read: pointers (in-root only)
  -> stripManagedBlocks + stripFrontmatter    adopt/scan.ts
  -> splitCandidates (bullets/paragraphs + heading trail + line no)
  -> classify (imperative -> high | prose -> medium)   adopt/candidates.ts
  -> bounds filter -> redact() -> normalizedAdoptHash
  -> dedup vs listMemoryEntries (all approvals) + intra-run
  -> cap -> memoryEntrySchema.parse -> registry.createMemoryEntry
  -> summary table / --json report
(later, human) mega memory review -> approve  -> mega connector sync
                                  -> reject   -> hash blocks re-suggest
```

## Components

1. `apps/cli/src/adopt/scan.ts` — `stripManagedBlocks`,
   `stripFrontmatter`, `splitCandidates`. Pure, no I/O.
2. `apps/cli/src/adopt/candidates.ts` — `IMPERATIVE_LINE` pattern,
   `classifyConfidence`, `normalizedAdoptHash`, `deriveTitle` (strips
   control chars/U+2028/U+2029 so `titleSchema` accepts; ≤72 chars),
   `deriveKeywords` (heading-trail tokens, then
   `stripReservedKeywords`). Pure.
3. `apps/cli/src/adopt/discover.ts` — deterministic file discovery +
   aider pointer extraction + in-root path guard. Injected fs for tests.
4. `apps/cli/src/commands/adopt.ts` — `runAdopt(input): Promise<0|1>`
   per the Citty house shape ([[workflows/cli-test-pattern]]):
   env-slice input, `resolveStorePath` → `ensureStoreReady` → project
   lookup → pipeline → report. `newId`/`now` injectable. Registered as
   `adopt` in `apps/cli/src/main.ts` `subCommands`.

## Error handling

- Store/project errors: existing `mapErrorToCliMessage` /
  `projectNotFoundMessage` house pattern (as in `review.ts`).
- Per-file isolation: an unreadable/missing file warns on stderr and
  scanning continues; zero files found exits 0 with an empty report.
- Malformed `.aider.conf.yml` or out-of-root pointer: skip, warn,
  continue. Candidates failing `memoryEntrySchema` (defense-in-depth):
  skip, count, continue — never abort the batch mid-write. Writes are
  per-call and non-transactional; dedup makes a partial run
  self-healing on re-run (precedent: `brain-import.ts:44`).

## Security & privacy

- `redact()` on every candidate before hash/persist — adopted text is
  re-emitted by sync into multiple agent files, so secrets must never
  enter the store (policy package is the single redaction authority).
- Sentinel-injection guard: `containsSentinel` skip + upstream
  `ConnectorContextSchema` rejection keep generated blocks unforgeable.
- Path traversal: aider `read:` targets resolved and prefix-checked
  under `project.rootPath`; anything else skipped.
- No network, no LLM, no exec; input is files the user already owns.

## Testing

Per [[workflows/cli-test-pattern]]: temp repos (`mkdtemp`) with
realistic fixture `CLAUDE.md` / `.cursor/rules/*.mdc` / `AGENTS.md`;
`runAdopt` exercised directly with injected `newId`/`now` (multi-entry
runs need a counter, not the env-var single-id injection). No
timing-tight assertions.

| Area | Test |
|---|---|
| scan | sentinel blocks (all 4 pairs) stripped; `.mdc` frontmatter skipped; bullets+continuations and paragraphs chunk with correct `file:line` |
| candidates | rubric high/medium; bounds skip; hash stable under case/whitespace changes; title passes `titleSchema` |
| ReDoS | growth-ratio guard for `IMPERATIVE_LINE` + whitespace-collapse: minimise-per-size, 4x step, generous CI-safe bound ([[concepts/redos-growth-ratio-measurement]]) |
| discover | fixed order; aider pointers in-root only; missing files tolerated |
| e2e | temp repo → suggested entries with citation/metadata; re-run → 0 new (idempotent); reject one → re-run → still 0; edit source line → 1 new |
| gate | adopted entries appear in `runMemoryReview` output; cap + `--dry-run` write nothing beyond report |
| sync | approved adopted entry lands inside sentinel block via `runConnectorSync`; suggested/rejected never emitted |

## Risk & process

HIGH (§12: memory write path at scale, feeds connector core path):
worktree (no `main` edits), `architect` design pass (pending),
`code-reviewer` AND `critic` as separate independent passes, evidence
per §9.5 — CLI smoke run captured on this repo itself (it carries all
three dialects on disk). Escalation trigger: any need to mutate agent
files from adopt, or to change `memoryEntrySchema`, stops work and
returns to spec review.

## Dependencies / build order

- Build-order 20 of 20 in the wave-2 batch; independent of the other
  19 except the named delineation with `memory-write-verify` (spec not
  on disk yet — see Non-Goals).
- No schema changes, no new packages, no migrations. Changeset for
  `@megasaver/cli` (new public command, DoD #9).

## Open questions

1. **`--llm` assisted mode (flagged, v2).** Optional re-chunking/
   summarizing of prose via the Anthropic API. §5's `claude-api` gate
   applies: direct API use must be spec-flagged with cost notes
   (batchable, prompt caching on, haiku-class default) and privacy
   notes (repo text leaves the machine — explicit opt-in flag, redact
   before send). Not in v1; requires its own spec amendment + review.
2. Per-dialect `type` mapping (e.g. `.mdc` glob-scoped rules →
   `code_pattern`) vs the locked all-`project_rule` default.
3. An `adopt` MCP tool for agent-initiated adoption — would make the
   entries agent-sourced and pull `memory-write-verify` into scope;
   deliberately excluded from v1.
