---
feature: package-hallucination-firewall
date: 2026-08-06
risk: HIGH
status: draft-design
pending: [user-spec-review]
reviewers: [code-reviewer, critic]
build-order: "8 of 20 (wave-2 batch)"
architect-pass: |
  2026-08-15, fresh context: REQUEST-CHANGES → all findings folded.
  B1 (BLOCKING): shipped subCommands:{airlock} makes citty throw
  E_UNKNOWN_COMMAND on --days 7 AND on any new positional — feature
  removes the block, folds airlock into the positional dispatch, pins
  a citty-layer regression test. M2: collector filter needs explicit
  kind narrowing (.includes() narrowing doesn't exist in TS). M3:
  tier-1 PyPI gains <name>.py/<name>/__init__.py file probes (dominant
  false-positive class). M4: mesh stays outside the compose seam,
  joined at caller sites (\n\n); three mesh-variant compose tests
  added. M5: refresh grammar-validates names before fetch/cache.
  Minors folded: typosquat hints at distance 1 only (m8), RMW inside
  withFileLock + Windows rename (m9), __future__ pinned (m10), no
  typosquat hint for truncated unscoped npm names (m11), per-name
  refresh progress (m13), both joins pinned (m14), stage-order claim
  corrected to the real path (m6), anchors refreshed (m7).
---

# Package-Hallucination Firewall (wave-2 #8)

## Problem

LLMs invent package names in 3–8% of generated code (up to 30% in some
ecosystems); a hallucinated name an agent then installs is a supply-chain
attack vector (slopsquatting). Research says a verification layer cuts
phantom packages to <0.5%
(wiki/syntheses/llm-code-problems-research-2026-07.md, proposal 1).
Today no Mega Saver surface inspects package references in agent-produced
edits: `guard-run.ts` intercepts Edit/Write for the Mistake Firewall, but
an import of `left-padd` or a `package.json` entry for `reqeusts` sails
through silently and becomes an `npm install` one turn later.

## Goal

A warn-only PreToolUse layer on agent edits: extract package references
from the NEW text of Edit/Write/MultiEdit calls (import/require
statements and dependency-manifest edits), verify each reference
offline in three tiers, and for unknown names inject an
`additionalContext` warning plus a firewall-ledger event. A typosquat
heuristic adds a "did you mean X?" hint. `mega firewall
status/refresh/allow` manages the local known-registry cache and a
private-registry allowlist. Ecosystems v1: npm + PyPI.

## Non-Goals

- Blocking or modifying any edit. v1 never emits `permissionDecision`
  from this layer; the Mistake Firewall's strict-mode deny is untouched.
- Network I/O anywhere in the hook path. Refresh is explicit CLI only.
- Cargo (`Cargo.toml`) / Go (`go.mod`) ecosystems — conformance
  follow-ups; v1 classifies only npm/PyPI files.
- Full PyPI import-name→distribution mapping (small committed alias
  seed only: `cv2`→`opencv-python` class of mismatches).
- `NotebookEdit` cell parsing (cell-JSON extraction is a follow-up).
- Version/range validation — name existence only.
- Pro gating: all package-firewall surfaces are free. The existing Pro
  `mega firewall` audit run is unchanged.
- Bash command scanning (`npm install <pkg>`) — follow-up; the edit is
  the earliest interception point and the v1 scope.

## Locked Decisions

1. **Warn-only v1.** Advisory `additionalContext` only; fail-open
   (hook always exits 0, empty output on any error) — same contract as
   `buildGuardHookOutput`. Wanting to block is the escalation signal,
   not a flag.
2. **Offline-first, three tiers.** Tier 1: the project's own
   manifests/lockfiles/`node_modules` (resolvable locally ⇒ fine, zero
   network). Tier 2: committed top-N seed lists ∪ a local cache file
   refreshed ONLY by `mega firewall refresh`. Tier 3: unknown ⇒ warn +
   ledger event. A structural test pins "no fetch/http import in any
   hook-path module".
3. **Reuse the firewall ledger.** Events go through the existing
   `appendFirewallEvent` (`packages/context-gate/src/firewall-ledger.ts`).
   `firewallEventSchema` gains kinds `unknown-package` and
   `typosquat-suspect` plus optional `packageName` / `ecosystem` /
   `suggestion` fields. No second ledger.
4. **F-FW-1 preserved by grammar.** The ledger stays value-free with
   respect to file content: `packageName`/`suggestion` are Zod-bounded
   to ecosystem name grammar (npm ≤214 chars, PyPI-normalized ≤100),
   so no free text from an edit can reach the ledger.
5. **Composed into the existing guard hook process through the ONE
   shared seam.** No second PreToolUse spawn and no private merge
   helper: composition goes through `composeGuardOutputs` in
   `guard-run.ts` — structured stage results — the seam
   shared with the generated-file-fence and session-mesh pairs
   (whichever pair lands first creates it; the others extend its
   input with their stage). A strict-mode deny passes through
   byte-identical (package warn dropped — the edit is blocked
   anyway). With no package refs the emitted output is
   byte-identical to today.
   ARCHITECT FINDING (folded 2026-08-15): the seam composes
   mistake-firewall + package-firewall stages only; mesh (shipped
   direct, v2.6) stays joined at the caller sites with its own `\n\n`
   delimiter — today's actual output order is mesh-computed-first,
   firewall-text-then-mesh. The seam's documented order is therefore
   **mistake-firewall → package-firewall**, and the mesh join contract
   is: when the composed result is non-empty, the caller appends
   `meshAdditional` as `\n\n${meshAdditional}`; on deny, package text
   is dropped but mesh stays (today's wire); when the composed result
   is `""`, today's mesh-only behavior is unchanged. Both joins are
   pinned by tests.
6. **Logic lives in `@megasaver/context-gate`.** Extraction,
   local-resolve, cache, typosquat are agent-agnostic pure/fs modules
   beside `firewall-ledger.ts`. Claude Code payload parsing stays in
   `apps/cli/src/hooks/` (§1 non-negotiable). apps/cli imports only
   `@megasaver/context-gate` (already on the §3c allow-list); never
   `@megasaver/stats` directly.
7. **CLI shape: explicit positional dispatch inside the parent
   `run` — NOT citty `subCommands`.**
   `apps/cli/src/commands/firewall.ts` moves to
   `commands/firewall/index.ts` (guard/ precedent); bare
   `mega firewall` still runs the Pro audit; `status`/`refresh`/`allow`
   are new free subcommands, dispatched by the parent `run` on the
   first positional (delegating to each verb's `defineCommand` via
   citty's exported `runCommand`). Verified against the vendored
   citty 0.1.6: with `subCommands` declared, citty runs the parent
   `run` even after dispatching a subcommand, throws
   `E_UNKNOWN_COMMAND` on unknown positionals, and mistakes a value
   flag's value (`mega firewall --days 7`) for a subcommand name —
   so declaring `subCommands` on a parent that keeps a meaningful
   audit `run` with value flags is not viable.
   ARCHITECT FINDING (folded 2026-08-15): the shipped parent ALREADY
   declares `subCommands: { airlock }` — empirically `mega firewall
   --days 7` exits 1 today with `E_UNKNOWN_COMMAND` (the vendored
   citty resolves the first non-dash token as a subcommand name before
   the parent `run`). This feature REPAIRS that shipped defect: the
   `subCommands` block is removed entirely and `airlock` folds into
   the same positional dispatch (`status|refresh|allow|airlock`), with
   a citty-layer regression test pinning both `--days 7` → audit and
   `status` → status.
8. **New-text only.** Extraction reads `new_string`/`content`/
   `edits[].new_string` — never `old_string`; warnings fire on
   introduced references only.
9. **Seeds are committed artifacts.** `data/npm-top.ts`,
   `data/pypi-top.ts`, `data/python-stdlib.ts`,
   `data/pypi-import-aliases.ts` generated by a committed script
   (`scripts/firewall-seed.mjs`, dev-time network); tests assert
   structure, not full contents.

## Architecture

```
PreToolUse (Edit|Write|MultiEdit)          [matcher already installed:
  -> mega hooks guard (existing command)    GUARD_HOOK_MATCHER]
     -> buildGuardHookOutput(...)               (unchanged)
     -> buildPackageFirewallText(...)           (new, apps/cli hook)
          classifyPackageEdit(file_path)        npm source / pypi source /
          extractPackageRefs(kind, newText)       package.json / requirements.txt
          - allowlist hit?        -> silent
          - tier 1 resolvesLocally? -> silent   (manifests, lockfiles,
          - tier 2 known name?      -> silent    node_modules; walk-up ≤12)
          - unknown -> nearestKnownName (≤2 edit distance) -> hint
                    -> appendFirewallEvent(unknown-package | typosquat-suspect)
                    -> per-session warned-set (fire once per name)
     -> composeGuardOutputs({ firewall, packageFirewall }) -> stdout
        (shared stage-compose seam; order fence -> mistake-firewall
         -> package-firewall -> mesh)
```

Store layout (all under the existing `<storeRoot>/firewall/`):
`events.jsonl` (existing ledger) · `registry-cache/npm.json` ·
`registry-cache/pypi.json` · `allowlist.json` ·
`warned/<session_id>.json`.

## Components

1. **Extraction** — `packages/context-gate/src/package-refs.ts`.
   `classifyPackageEdit(filePath)` + `extractPackageRefs(kind, text)`.
   Linear-time regexes only (bounded quantifiers, no `^\s*` under `m` —
   split lines instead, per wiki/concepts/redos-case-output-filter).
   Caps: `PACKAGE_SCAN_CAP` 256 KiB scanned, `MAX_REFS_PER_EDIT` 64,
   grammar-validated names. Excludes relative/absolute/`#` specifiers,
   `node:*` + `builtinModules` (node:module), Python stdlib seed.
2. **Tier-1 local resolver** —
   `packages/context-gate/src/package-local-resolve.ts`.
   `createLocalResolver(startDir)` memoizes file reads; walks up ≤12
   levels (stops after the first `.git` dir). npm: nearest
   `package.json` dep fields, `node_modules/<name>` existence,
   token-boundary probes in `pnpm-lock.yaml` / `package-lock.json` /
   `yarn.lock` (reads capped at 16 MiB). PyPI: `requirements*.txt`,
   `pyproject.toml`, `poetry.lock`, `uv.lock`, `Pipfile(.lock)` probes
   (PEP 503 normalized, `-`/`_` variants) PLUS per-walk-level
   file-existence probes for project-local modules (`<name>.py` and
   `<name>/__init__.py` with `_` variants — the dominant PyPI
   false-positive class, architect M3). Probing uses a hand-rolled
   linear scan, never a regex built from input
   (wiki/concepts/glob-compile-redos).
3. **Tier-2 cache + allowlist** —
   `packages/context-gate/src/package-registry-cache.ts`. Known set =
   seed ∪ cache file; cache appends via `withFileLock`
   (`@megasaver/shared/node`) + tmp-rename atomic write (saver-store
   precedent); `REGISTRY_CACHE_MAX_NAMES` 20 000/ecosystem; corrupt
   cache ⇒ fail-open to seeds. Allowlist entries
   `{name, ecosystem, addedAt}`.
4. **Typosquat** — `packages/context-gate/src/package-typosquat.ts`.
   Bounded optimal-string-alignment distance (early abandon at 2,
   length-diff prefilter) against the seed top-N; exact-known names
   never flagged. ARCHITECT FINDING (m8, folded 2026-08-15): hints
   fire at OSA distance **1** only — every planned fixture is
   distance 1, and distance 2 against short seed names (`ws`, `koa`,
   `uuid`) manufactures nonsense hints. Truncated unscoped npm names
   (first segment of `a/b` specifiers, m11) get the warning but NO
   typosquat hint.
5. **Ledger extension + reader isolation** — `firewall-ledger.ts`
   new kinds/fields (decision 3–4) plus exported
   `PACKAGE_FIREWALL_KINDS`. `@megasaver/pro-analytics` is NOT
   modified: `FirewallEventInput`
   (`packages/pro-analytics/src/firewall-report.ts:5-14`) keeps its
   closed kind union, and the two CLI collectors
   (`apps/cli/src/commands/firewall.ts`, `commands/alerts.ts`)
   filter package kinds before handing events to pro-analytics —
   same pattern as the generated-file-fence pair. Regression tests
   prove the audit report (including its `events` total) and the
   alerts `firewall` spike axis are unchanged by package-kind rows.
6. **Hook** — `apps/cli/src/hooks/package-firewall-run.ts`
   (`buildPackageFirewallText`, never throws) + per-session warned-set
   (session_id path segment validated `[A-Za-z0-9_-]{1,128}`, cap 500
   names), wired into `guard-run.ts` as the `packageFirewall` stage
   of the shared `composeGuardOutputs` seam (decision 5).
7. **CLI** — `commands/firewall/{index,status,refresh,allow}.ts`.
   `status`: cache sizes/ages, seed sizes, allowlist, 7-day
   unknown-event count. `refresh [names...]`: verifies explicit names
   or recent ledger unknowns (≤100) via injected `fetchImpl`
   (`registry.npmjs.org/<name>`, `pypi.org/pypi/<name>/json`, 5 s
   timeout each); 200 ⇒ cache append, 404 ⇒ "likely hallucinated"
   report; per-name progress lines as they resolve. ARCHITECT FINDING
   (M5, folded 2026-08-15): every CLI-provided name is grammar-validated
   with `isValidPackageName` BEFORE any fetch or cache append —
   invalid ⇒ stderr + exit 1 (the boundary rule; junk names must never
   reach public registries or the cache). `allow <name> --ecosystem`:
   grammar-check + append.
8. **Seeds + harnesses** — `scripts/firewall-seed.mjs` (committed
   generator) and `scripts/package-refs-redos-probe.mjs` (committed
   timing harness regenerating every quoted figure —
   wiki/concepts/redos-guard-testing "commit the harness").

## Error handling

- Hook path: every failure ⇒ empty contribution, exit 0 (fail-open,
  repo-wide hook invariant). Ledger/warned-set writes best-effort in
  their own try/catch — a store failure never suppresses the warn.
- Grammar validation at the extraction boundary (Zod at ledger
  boundary); non-conforming specifiers are dropped, never warned on.
- Corrupt cache/allowlist JSON ⇒ treated as absent (seeds still apply).
- `refresh`: per-name network errors reported and skipped (exit 0);
  exit 1 only for invalid args or cache write failure. `allow`: exit 1
  on grammar-invalid name.

## Security & privacy

- **No network in the hook path** — structural test asserts no
  `fetch(`/`node:http(s)`/`undici` in hook-path modules AND that the
  refresh command does contain `fetch(` (non-vacuity, per wiki
  redos-guard-testing corpus lesson).
- **Private-name leak**: `refresh` sends bare package names to public
  registries; private names may leak. Mitigation: refresh skips
  allowlisted names; `status` prints a one-line notice; documented in
  `mega firewall refresh --help`.
- **ReDoS**: linear patterns + committed probe + regression test at the
  shipped `PACKAGE_SCAN_CAP` (§Testing). All scans capped.
- **Ledger stays value-free** (decision 4). Warn text quotes only
  grammar-valid names.
- Paths via `node:path` join only; no exec, no shell.

## Testing

| Layer | Red-first tests |
|---|---|
| Extraction | JS/TS import/require/export-from/dynamic-import fixtures; Python import/from; package.json dep fields (workspace:/file: values skipped); requirements.txt; builtins/stdlib/relative excluded; caps enforced |
| ReDoS guard | ceiling test at `PACKAGE_SCAN_CAP` on 3 adversarial shapes (`retry: 3`, separation measured by the committed probe; session-hints-redos precedent — no timing-tight ratios in CI) + structural pin of bounded quantifiers + minimum-match non-vacuity assertion |
| Tier 1 | temp-dir fixtures per lockfile/manifest kind; walk-up bound; token-boundary (no `re`-inside-word false hit); 16 MiB cap |
| Tier 2 | append/dedupe/cap; corrupt file fail-open; lock contention via `withFileLock` semantics |
| Typosquat | `lodahs`→`lodash`, `reqeusts`→`requests`, distance-3 ⇒ null, exact-known ⇒ null |
| Ledger | new kinds round-trip `.strict()`; CLI collectors filter `PACKAGE_FIREWALL_KINDS`, so `mega firewall` audit output (incl. `events` total) and the alerts `firewall` axis are byte-identical with package-kind rows present; pro-analytics untouched |
| Hook | unknown ⇒ warn text + ledger line; tier-1/allowlist/known ⇒ ""; once-per-session dedupe; malformed payload ⇒ ""; never-throws |
| Composition | no refs ⇒ stdout byte-identical to today; deny passthrough (package warn dropped); both warn ⇒ one `additionalContext` joining firewall + package texts through `composeGuardOutputs` |
| CLI | cli-test-pattern (wiki/workflows/cli-test-pattern) with injected `fetchImpl`; `mega firewall` audit regression |

Feature smoke evidence (DoD 5): captured terminal session — hook stdin
fixture ⇒ warn JSON; `mega firewall allow` ⇒ silent on re-edit;
`refresh` against the real registry for one known + one phantom name.

## Risk & process

**HIGH** (§12: connector-core-path adjacent, public CLI flags, hook on
every edit). Mandatory: worktree (no `main` edits), `architect` design
pass, `code-reviewer` AND `critic` (separate passes), `verifier`
evidence. Risk is never downgraded to skip a skill.
Escalation triggers → re-classify CRITICAL: any blocking/deny behavior,
any network call reachable from a hook, or writes to user repos.

## Dependencies / build order

8 of 20 (wave-2 batch). New extraction/cache/typosquat/hook symbols
are owned here, but TWO other wave-2 pairs touch the same seam files
and require coordination:

- **generated-file-fence (#18)** modifies `apps/cli/src/hooks/guard-run.ts`,
  `packages/context-gate/src/firewall-ledger.ts` (appends
  `fence-warn`/`fence-deny` to the same `kind` enum, with an
  order-pinning test), and the same two CLI collectors
  (`commands/firewall.ts`, `commands/alerts.ts`).
- **session-mesh** (Task 9 there) piggybacks the same guard-run
  handler.

Coordination contract: ONE composition seam — `composeGuardOutputs`
(order fence → mistake-firewall → package-firewall → mesh); whichever
pair lands first creates it, later pairs extend its input. Ledger
`kind` members are appended, never rewritten (this pair's
`unknown-package`/`typosquat-suspect` are disjoint from the fence
kinds); each pair filters its own kinds at the CLI collectors so
pro-analytics stays closed and untouched. Remaining shared touches
(`packages/context-gate/src/index.ts` exports, `apps/cli/src/main.ts`
import path) are additive and rebase-trivial. Changeset required
(public CLI + context-gate publics change).

## Open questions

1. Should `refresh` also pull a fresher top-N list (replacing seeds) or
   only verify names? v1: verify-only; revisit with usage data.
2. PyPI alias-map depth — seed covers ~15 known mismatches; is a
   heuristic (import name ≠ any distribution) warn acceptable later?
3. Cache eviction: v1 refuses growth past the cap (reported by
   `status`); LRU eviction if the cap is ever hit in practice.
4. Should unknown-package counts surface in the Pro audit report
   (`diagnoseFirewall`)? Deferred — free `status` covers v1.
