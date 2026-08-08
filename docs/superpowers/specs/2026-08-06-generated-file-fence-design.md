---
feature: generated-file-fence
date: 2026-08-06
risk: HIGH
status: draft-design
pending: [user-spec-review, architect-pass]
reviewers: [code-reviewer, critic]
build-order: "18 of 20 (wave-2 batch)"
---

# Generated-File Fence (wave-2 #18)

## Problem

Agents hand-edit files that are build products, not sources: lockfiles
(`pnpm-lock.yaml`, `Cargo.lock`), `dist/` outputs, files carrying
`@generated` / `DO NOT EDIT` headers, `.gitattributes linguist-generated`
paths, vendored trees. The edit is wasted (regenerated over), sometimes
corrupting (lockfile drift breaks installs), and always token-expensive.
Nothing in the pipeline knows the fenced set; the Mistake Firewall only
warns after a *repeated* failure, so the first hand-edit always lands.

## Goal

`mega fence init` derives a per-repo `fence.yaml` deterministically from
repo signals, each entry carrying its derivation reason — reviewable and
committed by the user. The fence then compiles into each connected
agent's native enforcement dialect: Claude Code gets a PreToolUse
warn (default) / deny (per-entry opt-in) via the existing guard hook;
Cursor / Codex / other flat-file agents get a sentinel fence block via
the existing connector machinery; generic CLI wrappers get
`mega fence check <path>` as an exit-code gate. A blocked/warned write
explains the correct alternative ("lockfile: run `pnpm install`
instead") and names the one-liner override `mega fence allow <path>`.
Every warn/deny appends to the firewall ledger.

## Non-Goals

- Bash-mediated writes (`sed -i`, shell redirects). v1 fences the edit
  tools only (`Edit|Write|MultiEdit|NotebookEdit`); Bash is a named gap.
- Automatic re-derivation (watchers, hooks). Derivation runs only on
  `mega fence init`.
- Fencing Mega Saver's own managed sentinel blocks inside hand-kept
  files (`CLAUDE.md`, `AGENTS.md`) — block-level, not file-level; out.
- gitattributes bracket/negation patterns — reported as unsupported,
  never silently (mis)fenced.
- A second ledger, a GUI surface, or any stats-package coupling
  (`apps/cli` never imports `@megasaver/stats` directly).

## Locked Decisions

1. **New leaf package `@megasaver/fence`.** Deps: `@megasaver/shared`,
   `@megasaver/policy`, `yaml`, `zod` only — no core edge (mirrors
   `decisions/content-store-no-core-edge`; `yaml@^2.6.1` matches
   `packages/context-gate/package.json:33`; no pnpm catalog exists, so
   the version is declared literally).
2. **`fence.yaml` lives at the repo root, committed by the user.**
   `version: 1`; entries sorted by `path`; every entry carries
   `class` + `reason` (+ optional `mode`, `alternative`). Hand-editable.
3. **Warn-first.** `mode` defaults to `warn`; `deny` is opt-in per
   entry. Every warn/deny text names `mega fence allow <path>`.
4. **Claude Code dialect = guard-run piggyback.** No new hook process,
   no settings.json change: `GUARD_HOOK_MATCHER`
   (`packages/connectors/claude-code/src/hook-settings.ts:23`) already
   covers `Bash|Edit|Write|MultiEdit|NotebookEdit`. In-handler ordering
   is documented and fixed: **fence → firewall → mesh** (within the
   firewall position, mistake-firewall text before package-firewall
   text). This feature OWNS the single composition seam
   (`composeGuardOutputs`); package-hallucination-firewall and
   session-mesh (its plan Task 9 piggybacks the same handler) adopt
   that seam. Each stage computed independently, one stage's failure
   never suppresses another. Fence runs before the store/project
   lookup because it is repo-scoped (works with no registered project).
5. **Deny wire format is VERIFIED, not assumed.** The repo already
   ships a PreToolUse deny: `hookSpecificOutput: { hookEventName:
   "PreToolUse", permissionDecision: "deny", permissionDecisionReason }`
   (`apps/cli/src/hooks/guard-run.ts:212-219`, Mistake Firewall strict
   mode). Fence deny reuses it verbatim. Never emit `"allow"` (would
   bypass the user's permission system — guard-run.ts:221).
6. **Glob dialect = `compileGlob` from `@megasaver/policy`**
   (`packages/policy/src/secret-paths.ts:63`, `PathMatcher {test}` at
   `glob-matcher.ts:10` — NFA, no regex, no ReDoS). Caps mirror
   `parse-project-permissions.ts`: glob ≤ 256 chars, ≤ 512 entries,
   ≤ 256 allow globs; brackets rejected (fail-visible, not reinterpret).
7. **Ledger = `appendFirewallEvent`**
   (`packages/context-gate/src/firewall-ledger.ts:25`) — reuse, no
   second ledger. Two new kinds `"fence-warn"`, `"fence-deny"`
   **appended to the end** of the `kind` enum (AA3 enum-order
   contract). Value-free posture (F-FW-1) preserved: `detector:
   "fence:<class>"`, `count: 1`, `sourcePath: <relpath>`, no content.
   Readers (`apps/cli/src/commands/firewall.ts:78`, `alerts.ts:81`)
   safeParse rows against the schema, so the enum extension is
   load-bearing; the alerts firewall spike axis must not silently
   change meaning (checked in tests).
8. **Re-derivation is additive-suggest.** With an existing
   `fence.yaml`, `mega fence init` prints suggested additions only;
   `--write` appends new entries and never removes, re-modes, or
   touches `allow`. Edits (`allow`, `--write`) go through the `yaml`
   Document API so user comments/formatting survive.
9. **Connector compilation rides the existing sentinel machinery**
   (§7): new independent pair `<!-- MEGA SAVER:FENCE BEGIN/END -->` in
   `connectors-shared/src/constants.ts`, rendered by a new
   `renderFenceBlockText`, applied via a new optional
   `fenceBlock?: string` param on `upsertBlock`
   (`packages/connectors/shared/src/upsert.ts:31`; warm-start-block
   precedent: `undefined` = untouched, `""` = remove). Cursor
   frontmatter-preservation contract untouched (header seeded once,
   only sentinel interior rewritten). Claude Code gets **no** block —
   its dialect is the hook (avoids double delivery).
10. **Override audit = git.** `mega fence allow` mutates a committed
    file; its diff is the audit trail. No ledger row for overrides.

## Architecture

```
mega fence init ──5 signals──> fence.yaml (committed, reviewable)
                                   │
            ┌──────────────────────┼─────────────────────────┐
   guard-run piggyback      mega connector sync        mega fence check
   (Claude Code: warn ctx    (FENCE sentinel block →    (exit-code gate
    or deny wire)             cursor/codex/generic)      for wrappers)
            │
   appendFirewallEvent("fence-warn" | "fence-deny")
```

## Components

1. **`fence-file.ts`** — Zod schemas (`.strict()`), `FENCE_CLASSES =
   ["lockfile","build-output","codegen-header","linguist-generated",
   "vendored"]` (declaration order is the contract; append-only), pure
   `parseFenceFile(raw: unknown)`, stable `serializeFenceFile`,
   `loadFenceFile(dir)` (fs + `yaml` at the boundary — mirrors the
   pure-parse/loader split of `parseProjectPermissions`), and
   `locateFenceRoot(cwd)`: upward walk to the nearest dir containing
   `fence.yaml`, stopping at the first `.git`-bearing dir (inclusive)
   or filesystem root.
2. **`derive.ts`** — `deriveFence(input)` with injected seams
   (`listTrackedFiles`, `readFileHead`, `dirExists`) so unit tests need
   no git. Signals: (a) lockfile basenames (fixed list:
   pnpm-lock.yaml, package-lock.json, npm-shrinkwrap.json, yarn.lock,
   bun.lock, Cargo.lock, poetry.lock, uv.lock, Pipfile.lock,
   Gemfile.lock, composer.lock, go.sum, gradle.lockfile, flake.lock);
   (b) build-output dirs present on disk (dist, build, out, .next,
   .nuxt, coverage, dist-bundle → `<dir>/**`); (c) codegen headers:
   first 2 KiB of each tracked file, files > 1 MiB skipped (size cap),
   literal search for `@generated` / `DO NOT EDIT` /
   `AUTO-GENERATED FILE` (literals, no regex); (d) `.gitattributes`
   `linguist-generated` paths via `gitattributes.ts`; (e) vendored dirs
   (vendor, third_party → `<dir>/**`). Default `listTrackedFiles` runs
   `git ls-files -z` (sorted output ⇒ deterministic); no git → signals
   (a),(b),(e) from fs only, (c),(d) skipped and reported.
3. **`gitattributes.ts`** — parses lines into (pattern, attrs); keeps
   `linguist-generated` / `linguist-generated=true`, drops
   `-linguist-generated`; translates to the `compileGlob` dialect
   (strip leading `/` → anchored; bare dir pattern → `<p>/**`;
   patterns with `[`, `]`, or leading `!` → `skipped[]` with reason).
4. **`evaluate.ts`** — `compileFence(file): CompiledFence`
   (precompiled `PathMatcher`s), `evaluateFenceWrite({ compiled,
   relPath })`: allow globs checked first (allowed, silent), then
   entries in order → `{ verdict: "warn" | "deny", entry }` or
   `{ verdict: "allowed" }`.
5. **Guard piggyback** (`apps/cli/src/hooks/guard-run.ts`) — lazy
   `await import("@megasaver/fence")` inside try/catch (per
   `decisions/lazy-load-heavy-deps`, with a no-eager-import guard
   test); normalizes `file_path` (absolute or relative; win32 `\` →
   `/`) against `locateFenceRoot`; deny short-circuits with the
   verified wire + ledger row; warn text is prepended to whatever
   additionalContext the existing logic yields; when the mistake
   firewall itself denies (strict mode), its deny wins unchanged and
   the fence warn is dropped for that call (the write is blocked
   anyway — documented).
6. **CLI `mega fence`** (`apps/cli/src/commands/fence/`) — `init
   [--write]`, `allow <path>`, `status`, `check <path> [--json]`
   (exit 0 allowed / 1 fenced — wrapper dialect). House
   cli-test-pattern (`run<Cmd>(input): Promise<0|1>`, injected
   cwd/stdout/stderr). Writes atomic (tmp+rename); read-modify-write
   under `withFileLock` (`@megasaver/shared/node`,
   `packages/shared/src/file-lock.ts:25`).
7. **Connector block** — `renderFenceBlockText` caps the listing at 20
   entries + "and N more — see fence.yaml", names alternatives and
   `mega fence allow`; `apps/cli/src/commands/connector/sync.ts` loads
   `fence.yaml` (absent → `""` removes a stale block) and passes
   `fenceBlock` through `upsertBlock` for every flat-file target
   (`builtinTargets`, `generic-cli/src/targets.ts:69`).

## Error handling

- Hook side is fail-open, always exit 0: fence parse error, missing
  file, unreadable dir → no enforcement, primary guard output
  unchanged. A DENY is an explicit protocol answer, never a crash.
- `parseFenceFile` violations (caps, brackets, unknown keys via
  `.strict()`) are loud in CLI paths (`init`/`status`/`check` report;
  exit 1) and silent-open in the hook. `mega fence status` is the
  diagnosis surface.
- Ledger writes stay best-effort (F-FW-3): a ledger failure never
  suppresses the warn/deny.

## Security & privacy

- No file contents in ledger events or warn texts — class, reason,
  relpath only (F-FW-1 value-free posture kept).
- No regex over untrusted input: literal header search, NFA globs
  (ReDoS posture per `concepts/glob-compile-redos`); caps on glob
  length/count bound evaluation cost.
- Fence never *allows* anything the permission system would block; it
  only warns or denies. Allow-list only silences the fence itself.
- `locateFenceRoot` never walks above the `.git` boundary, so a
  parent directory outside the repo cannot inject a fence.

## Testing

- Unit: schema round-trip + caps; gitattributes translation incl.
  skipped patterns; each derivation signal via injected seams;
  determinism (derive twice → byte-identical); evaluate precedence
  (allow > entry, first match); win32 path normalization (structural,
  `node:path`).
- Hook: guard-run harness (payload-object injection via
  `call(payload)` — `apps/cli/test/hooks/guard-run.test.ts:55`): warn
  merges with firewall text in documented order; deny wire exact;
  no fence.yaml → output byte-identical to today (inert); fail-open on
  unreadable fence; ledger row kinds/detector/sourcePath; no-eager-
  import guard. No timing-tight assertions (CI-slowness lesson).
- CLI: init (fresh write, additive re-run, `--write` append preserves
  comments), allow (comment-preserving, locked), check exit codes.
- Connector: fence block upsert/remove; cursor frontmatter + outside-
  sentinel content preserved; integration `mega connector sync` smoke.

## Risk & process

HIGH (§12): touches the connector core path, public CLI flags, and a
PreToolUse guard. Worktree `feat/generated-file-fence` (no `main`
edits); `architect` design pass; `code-reviewer` AND `critic` separate
passes; evidence-preserving mode only. Escalation: if implementation
needs to touch the permission wire beyond the verified deny shape, or
`mega fence init` starts *writing* outside fence.yaml, stop → re-spec.

## Dependencies / build order

18 of 20 (wave-2). Depends on shipped machinery only: policy
`compileGlob`, context-gate firewall ledger, connectors-shared
sentinels, guard hook. Coordinates with session-mesh Task 9 (same
handler): whichever lands second wires the documented fence → firewall
→ mesh ordering; both are additive and independent.

## Open questions

1. Should `deny` entries also compile a stronger line into the flat-
   file blocks (Cursor/Codex have no deny mechanism — text-only)?
2. `bun.lockb` (binary) — fence as lockfile even though Edit tools
   rarely target it?
3. Should `mega fence check` gain `--staged` (batch mode for git
   hooks) in a follow-up?
