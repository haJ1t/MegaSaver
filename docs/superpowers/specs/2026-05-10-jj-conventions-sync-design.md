---
title: JJ — pnpm conventions:sync automation
status: design
risk: medium
date: 2026-05-10
author: halit
---

# JJ — `pnpm conventions:sync` automation

## Mission

Automate drift detection and resolution across the convention files
documented in `docs/conventions/multi-agent-dogfood.md`. Until this
spec ships, `CLAUDE.md`, `AGENTS.md`, and `.cursor/rules/*.mdc` were
kept in sync by hand. Manual sync is error-prone — every previous
v0.1/v0.2 PR has had to remember to update each consumer.

`pnpm conventions:sync` makes this mechanical:

- **Check mode (default, CI-friendly):** exits non-zero if any
  consumer file diverges from the canonical content. Prints a
  unified diff so the operator sees exactly what is wrong.
- **Write mode (`--write` or `--fix`):** writes canonical content
  into every consumer block, restoring sync.

## Source of truth — decision

**Decision: `docs/conventions/*.md` remain canonical, consumers
mirror named sections via tagged blocks.**

Two approaches were considered:

1. **Single source file** (e.g., `docs/conventions.md` whole-file)
   → consumer files are derived in full.
2. **Tagged-block mirroring** — `docs/conventions/<file>.md`
   remain canonical (already the documented model in
   `multi-agent-dogfood.md`). Each consumer file declares **named
   blocks** that pull content from one or more convention files.
   Content outside the blocks is preserved.

Tagged-block wins:

- The repo already designates `docs/conventions/*.md` as the
  source. CLAUDE.md §7 and `multi-agent-dogfood.md` both name it.
  Whole-file derivation would force `AGENTS.md` (deliberately a
  *slim* Codex mirror) to be byte-identical to `CLAUDE.md`. That
  contradicts the existing slim-mirror contract.
- `.cursor/rules/*.mdc` files have YAML frontmatter and per-file
  preambles. Whole-file derivation would clobber them.
- Each consumer gets to compose its own subset of sections with
  its own preamble — the same model the connector pipeline already
  uses for memory blocks (`MEGA_SAVER_BLOCK_START` / `..._END`).

A sentinel namespace collision was avoided: connectors use
`MEGA_SAVER_BLOCK_*` for memory entries. Conventions sync uses
`<!-- conventions:start id="<name>" -->` / `..._end ...`. The two
systems do not share storage.

## Tagged-block format

A consumer file declares a managed block like this:

```
<!-- conventions:start id="<section-name>" source="<path>" -->
...managed content (regenerated)...
<!-- conventions:end id="<section-name>" -->
```

Rules:

- `id` is required and identifies the block within the file.
- `source` is required and points to the canonical
  `docs/conventions/<file>.md`. Optional `fragment` may target a
  specific heading within the source.
- Start and end sentinels must share the same `id`. Unmatched
  sentinels are a hard error.
- Content between sentinels is fully managed. Anything outside is
  preserved verbatim.

The implementation lives in `scripts/conventions-sync/` (script, not
package) and exposes:

- `scripts/conventions-sync/cli.ts` — Citty command. Entrypoint
  for `pnpm conventions:sync`.
- `scripts/conventions-sync/sync.ts` — pure functions
  (`renderBlock`, `parseFile`, `applyBlocks`, `computeDiff`).
- `scripts/conventions-sync/manifest.ts` — closed-enum list of
  consumer files and which blocks they own.

## Consumer manifest (v0.3)

Frozen launch set:

| Consumer file              | Blocks pulled                         |
|----------------------------|----------------------------------------|
| `CLAUDE.md`                | none (already canonical — see below)   |
| `AGENTS.md`                | `mission`, `stack`, `process`, `code`, `git`, `risk`, `dogfood`, `anti-patterns` |
| `.cursor/rules/mega-context.mdc`     | `mission`, `repo-layout`, `stack`, `dogfood`            |
| `.cursor/rules/mega-conventions.mdc` | `code`, `language`, `git`, `anti-patterns`              |
| `.cursor/rules/mega-discipline.mdc`  | `process`, `definition-of-done`, `risk`, `skill-routing` |

**Why `CLAUDE.md` has no managed blocks:** CLAUDE.md is treated as
*reference* — it inlines the prose from each `docs/conventions/<file>.md`
with its own §1–§13 prologue. The first version of this script ships
without rewriting CLAUDE.md; instead the sync script validates that
CLAUDE.md references each convention file (the existing "Source:"
footer pattern). A later PR may convert CLAUDE.md to managed blocks
once the script has been used in anger. (Conservative scope.)

**v0.3 ships only the consumers above.** New consumers added later
(e.g., `GEMINI.md`, `.github/copilot-instructions.md`) extend the
manifest enum. The closed-enum tuple ordering is pinned with
`.test-d.ts` per repo convention.

## Modes

- **Check** (default): for each consumer, regenerate the expected
  file content, compare to disk. On mismatch:
  - exit code 1
  - print a unified diff
  - print one summary line per mismatched consumer

- **Write** (`--write` or `--fix`): regenerate all consumer files,
  write to disk. Print one line per file touched. Exit 0 on
  success, non-zero on regen error (unmatched sentinels,
  missing source, etc.).

- **List** (`--list`): print the consumer manifest and exit 0. For
  operators wanting to see what would be touched.

## CLI surface (Citty)

```bash
pnpm conventions:sync            # check mode (default)
pnpm conventions:sync --check    # explicit check (CI uses this)
pnpm conventions:sync --write    # write all consumer blocks
pnpm conventions:sync --fix      # alias of --write
pnpm conventions:sync --list     # show manifest
```

Mode is a closed enum: `"check" | "write" | "list"`. Flag combos
that imply two modes are rejected.

## CI wiring

`pnpm conventions:check` (new root script) runs the script in
`--check` mode. Plumbed into `pnpm verify` as the last gate after
lint/typecheck/test. This is intentionally separate from `pnpm
verify` until shaken out, so existing PRs don't break.

Final shape (this PR):

- Add `conventions:sync` and `conventions:check` to root
  `package.json` scripts.
- Wire `conventions:check` into `pnpm verify` (best-case) or leave
  it standalone (fallback if verify gating proves disruptive).

## Tests

- **Unit (`sync.test.ts`):**
  - `renderBlock` round-trips canonical content into sentinels.
  - `parseFile` extracts blocks; rejects unmatched/duplicate ids.
  - `computeDiff` produces a unified diff format.
- **Integration (`integration.test.ts`):**
  - End-to-end: `--write` brings a fixture into sync; subsequent
    `--check` exits 0.
  - End-to-end: tamper with one consumer; `--check` exits 1 with a
    diff that names the consumer.
- **Type (`manifest.test-d.ts`):**
  - `Mode` is the exact union `"check" | "write" | "list"`.
  - `ConsumerId` is the exact closed union of manifest ids.

## Closed-enum discipline

Two enums introduced:

1. `Mode = "check" | "write" | "list"` — pinned with `Mode`
   `expectTypeOf` test.
2. `ConsumerId` — derived from `CONSUMERS` tuple ordering; pinned
   in `.test-d.ts`.

Tuple order is launch order (alphabetic by path inside `.cursor/rules`
to match existing `KNOWN_TARGETS` precedent). The order is
documented in `manifest.ts` with the standard "Do not reorder"
banner from `agent-id.ts`.

## Non-goals

- Not renaming `docs/conventions/*.md` paths.
- Not changing CLAUDE.md structure (CLAUDE has no managed blocks
  in v0.3).
- Not adding new consumer files (`GEMINI.md`, `.cursorrules`,
  `.github/copilot-instructions.md` — those land in a follow-up).
- Not bundling the script into `@megasaver/cli` (it is a dev tool
  for the repo itself, not for end users of `mega`).

## Risk: MEDIUM

Reasons: dev tooling, no user-facing surface, no data deletion,
no crypto. The first run rewrites `AGENTS.md` and three `.cursor/
rules/*.mdc` to introduce sentinel blocks. The rewrites are
mechanical, reviewable, and reversible. CLAUDE.md is not touched.

## Migration (this PR)

1. Add `scripts/conventions-sync/` with implementation + tests.
2. Wire `conventions:sync` + `conventions:check` into root
   `package.json`.
3. Run `pnpm conventions:sync --write` once to inject sentinel
   blocks into `AGENTS.md` and the three `.cursor/rules/*.mdc`
   files.
4. Commit migration changes alongside the script itself.
5. Append an entry to `wiki/log.md` under today's date.
6. Final PR title: `feat(scripts): pnpm conventions:sync automation (JJ)`.
