---
title: Pro module 8 — safe reversible memory-file compression (mega compress)
date: 2026-07-08
status: approved
risk: CRITICAL
scope: an eighth Pro module — a gated top-level `mega compress <path>` command that runs the EXISTING `compressProse` extractive engine over a single markdown/text file and, on `--apply`, atomically overwrites it after writing a mandatory `<path>.bak`. Dry-run is the default (preview + savings, zero writes). Adds a pure metric composer to `@megasaver/pro-analytics`, exposes the existing `compressProse` from `@megasaver/output-filter`'s public entry, and re-points savings-fix R5 advice at this command. Mutates user repo files — CRITICAL.
base: main (461cebe2)
reviewers: [code-reviewer, critic, security-reviewer, tracer]
manual-confirmation: given (user approved design 2026-07-08 — marker-skeleton + mandatory .bak; dry-run default + git-dirty guard + atomic temp+rename + restore hint; any path guarded to .md/.txt/.mdc; R5 advice → runnable command pointer)
---

# Pro module 8 — safe reversible memory-file compression (`mega compress`)

## Motivation

Every session loads `CLAUDE.md`, `AGENTS.md`, and friends into context verbatim.
Module 5 (`mega savings fix`) already *detects* oversized memory files (R5) but
its invariant is "never write repo files" — so it can only advise. `mega compress`
is the module that actually acts, safely: it runs the deterministic extractive
compressor Mega Saver already ships (`compressProse`) over one file, shows exactly
what it would strip and how many tokens/dollars that saves, and — only on explicit
`--apply` — overwrites the file after writing a backup you can restore with one
`mv`. The compression is lossy by design (paragraph bodies collapse to
`… [N paragraphs]` markers); the product value is doing it *reversibly and
transparently* (source: wiki/syntheses/pro-differentiation-portfolio.md; the 1.x→2.0
program item 1.10).

## Locked decisions (user-approved 2026-07-08)

1. **`--apply` output = the marker skeleton, `<path>.bak` mandatory.** The written
   file is exactly `compressProse(original)` — kept content (headings, code
   fences, blockquotes, each section's first paragraph, first 3 list items)
   verbatim, everything else replaced by `… [N paragraphs]` / `… [N more items]`
   markers. A backup of the ORIGINAL is written to `<path>.bak` *before* the
   overwrite, always. Transparent lossy: the user sees the markers and keeps the
   original.
2. **Dry-run is the default; `--apply` is the CRITICAL write path.**
   - Default (no `--apply`): print a preview (what collapses) + savings line +
     an explicit lossiness warning. **Zero writes.**
   - `--apply`: (1) if the target is git-*tracked* and *dirty* (uncommitted
     modifications) → refuse without `--force`; (2) if `<path>.bak` already
     exists → refuse without `--force` (never silently clobber a prior backup);
     (3) write `<path>.bak` = original; (4) atomically overwrite the target
     (temp file in the same dir + `rename`); (5) print the restore hint
     `mv <path>.bak <path>`.
3. **Any path argument, guarded to `.md` / `.txt` / `.mdc` extensions.** The
   extension is validated (case-insensitive) at the CLI boundary; anything else is
   rejected with a clear stderr line and exit 1, before any read. Flexible target
   (CLAUDE.md, AGENTS.md, docs/*.md, .cursor/rules/*.mdc); no globbing, no
   recursion — exactly one explicit file per run.
4. **savings-fix R5 stays advice, but its `command` becomes a runnable pointer.**
   R5 remains `appliable: false` (savings-fix never writes repo files — its HIGH
   invariant is preserved). Its `command` field changes from `null` to
   `mega compress <basename>` (basename only — full paths must never leak into the
   shareable teardown output; the m6 privacy invariant). One-line change + tests.

## Design

### Engine reuse & package boundaries (the safe seam)

The extractive engine already exists: `compressProse(text: string): string` in
`packages/output-filter/src/compress/prose.ts` (deterministic, no model — see its
header for the exact keep/collapse rules). It is currently **not** on
output-filter's public surface. Two minimal moves keep the blast radius tiny and
avoid the 1.6.0 bundle-resolution incident class:

- **Expose the engine, don't move it.** Add one line to
  `packages/output-filter/src/index.ts`:
  `export { compressProse } from "./compress/prose.js";`. `@megasaver/output-filter`
  is already a (dev)dependency of `@megasaver/cli` — `bench.ts` imports
  `classifyOutput`/`filterOutput` from it and the tsup bundle inlines it. So the CLI
  can import `compressProse` with **no new dependency and no new bundle path**.
- **Measurement lives in pro-analytics, and stays pure-math.** A new file
  `packages/pro-analytics/src/compress-file.ts` exports `composeCompressionReport`
  (takes the before/after strings — it does NOT import the engine) and
  `renderCompressionSummary`. `@megasaver/pro-analytics` gains **no** new
  dependency. The CLI orchestrates: read → `compressProse(original)` (core, gated
  behind entitlement) → `composeCompressionReport(original, compressed)` (Pro, lazy
  import). Open-core story: the compressor is MIT/free (it runs inside the saver
  pipeline); the Pro value is the measured, reversible, safe-apply command around it.

Circular-import check: output-filter does not depend on pro-analytics or stats;
pro-analytics gains no new dep. No cycle introduced.

### 1. Pure engine — `packages/pro-analytics/src/compress-file.ts`

```
CompressionReport = {
  originalBytes: number;        // Buffer.byteLength(original, "utf8")
  compressedBytes: number;      // Buffer.byteLength(compressed, "utf8")
  bytesSaved: number;           // Math.max(0, originalBytes - compressedBytes)
  tokensOriginal: number;       // tokensFromBytes(originalBytes)
  tokensCompressed: number;     // tokensFromBytes(compressedBytes)
  tokensSaved: number;          // Math.max(0, tokensOriginal - tokensCompressed)
  dollarsSaved: number;         // (tokensSaved / 1_000_000) * INPUT_PRICE_PER_MTOK_USD
  paragraphsCollapsed: number;  // sum of N over "… [N paragraphs]" markers
  listItemsDropped: number;     // sum of N over "… [N more items]" markers
  changed: boolean;             // compressed !== original
  compressed: string;           // echoed for --json and --apply
};
```

- **`composeCompressionReport(original: string, compressed: string): CompressionReport`**
  — pure. Byte counts via `Buffer.byteLength(..., "utf8")` (memory files may hold
  multibyte content; char length would misprice). Money model reused from
  `@megasaver/stats`: `tokensFromBytes` + `INPUT_PRICE_PER_MTOK_USD` (the flat
  $3/MTok input price). Marker counts scan `compressed` for the exact strings
  `compressProse` emits — `/… \[(\d+) paragraphs?\]/g` and
  `/… \[(\d+) more items?\]/g` (note the singular forms the engine uses for N=1)
  — and sum the captured Ns. `changed` compares the raw strings.
  - WHY a comment: the marker counts are a *display* nicety derived by scanning
    output; if a source file literally contained a marker-shaped string the count
    could over-report. The **byte/token/dollar figures are exact** regardless — they
    come from byte lengths, not the scan. Documented, not defended against (YAGNI).
- **`renderCompressionSummary(report: CompressionReport): string`** — a fixed
  multi-line block: a "lossy, deterministic, no model" line; the counts
  (`N extra paragraphs → "… [N paragraphs]"`, `N list items beyond the first 3`);
  a "headings, code, blockquotes, and each section's first paragraph kept verbatim"
  line; and the savings line `A→B bytes · ~T tokens · ~$D (est.)`. Every `$` carries
  `(est.)`. No file paths, no user text — counts, byte figures, and fixed copy only
  (so the summary is safe to show and to log).
- Export both + the type from `packages/pro-analytics/src/index.ts`.

### 2. Gated CLI — `apps/cli/src/commands/compress.ts` (top-level)

`runCompress(input)` mirrors `runTeardown`'s injected-fs shape. Injected surface
(all defaulted in `defaultCompressFs()`, all faked in tests):

```
readFile:        (path) => string          // default: readFileSync(path, "utf8")
fileExists:      (path) => boolean          // default: existsSync
writeFile:       (path, content) => void    // default: ATOMIC temp-in-same-dir + renameSync
gitFileStatus:   (path) => GitFileStatus    // default: git status --porcelain via execFileSync (argv, never a shell)
GitFileStatus = "clean" | "dirty" | "untracked" | "unknown"
```

Control flow (order is the security contract):

1. **Entitlement FIRST.** `checkEntitlement("savings-analytics", …)`; not entitled →
   `COMPRESS_UPSELL` (reuses `PRO_ANALYTICS_URL`) to stdout, `return 0`. Nothing is
   read, compressed, measured, or written on the free path — spy-enforced across
   every flag combo (`{}`, `{apply}`, `{apply,force}`, `{json}`).
2. **Path-extension guard.** Lowercased extension of the positional path must be one
   of `.md` / `.txt` / `.mdc`; else `stderr("mega compress only accepts .md, .txt,
   or .mdc files")`, `return 1`. Checked before any fs read.
3. **Existence.** `!fileExists(path)` → `stderr("no such file: <path>")`, `return 1`.
4. **Read + measure.** `original = readFile(path)`; lazy
   `const { composeCompressionReport, renderCompressionSummary } =
   await import("@megasaver/pro-analytics")`; `compressed = compressProse(original)`
   (imported statically from `@megasaver/output-filter`);
   `report = composeCompressionReport(original, compressed)`.
5. **`--json`** → `stdout(JSON.stringify(report))`, `return 0`. JSON is a read-only
   inspection surface: it never writes, even if `--apply` is also set (documented).
6. **Dry-run (default, no `--apply`).**
   - `!report.changed` → `stdout("already tight — nothing to compress")`, `return 0`.
   - else → print `renderCompressionSummary(report)` + a lossiness warning +
     the hint "re-run with --apply to overwrite (a <path>.bak backup is written
     first)". **`writeFile` never called** — spy-enforced. `return 0`.
7. **`--apply` (the CRITICAL write path).**
   - `!report.changed` → `stdout("already tight — nothing to compress; not
     writing")`, `return 0`. (No pointless `.bak`, no rewrite of an identical file.)
   - `gitFileStatus(path) === "dirty"` && `!force` →
     `stderr("<path> has uncommitted changes — commit them or re-run with
     --force")`, `return 1`. **No write.** (`clean` / `untracked` / `unknown`
     proceed: the `.bak` is the universal safety net; the git guard adds protection
     specifically for tracked work the user has not yet committed.)
   - `bak = path + ".bak"`; `fileExists(bak)` && `!force` →
     `stderr("backup already exists: <path>.bak — remove it or re-run with
     --force")`, `return 1`. **No write.**
   - `writeFile(bak, original)` — backup the ORIGINAL first.
   - `writeFile(path, report.compressed)` — atomic overwrite (temp+rename).
   - `stdout` the savings line + `"backed up to <path>.bak"` +
     `"restore with: mv <path>.bak <path>"`. `return 0`.

Flags: positional `<path>` (required), `--apply`, `--force`, `--json`,
`--store <dir>` (store used ONLY for the entitlement check). No `--out`, no
`--mode` (the engine has no modes). Register `compress` in `main.ts` subCommands.

**Atomic write default:** write to `<path>.<pid-or-counter>.tmp` in the *same
directory* as the target (rename is only atomic within a filesystem), then
`renameSync(tmp, path)`; mirrors `apps/cli/src/hooks/intent-run.ts:42-43`. On
success no `.tmp` remains. Used for both the `.bak` and the target so every write
is crash-safe.

### 3. R5 pointer — `packages/pro-analytics/src/fix.ts`

In the `advise-compress-memory-file` branch (currently ~lines 139-151): keep
`kind`, `appliable: false`, `target: f.path`, and `estDollarsReturned` unchanged;
change `command: null` → `command: \`mega compress ${baseName(f.path)}\`` (the
existing `baseName` helper — basename only, so no full path can reach the
shareable teardown); update `detail` to
`"Run mega compress <file> to preview a reversible, backed-up compression."`.
Nothing else in savings-fix changes; it still writes no repo files.

### 4. Docs + changeset

- `README.md`: command-table row + a Pro-section pair
  (`mega compress CLAUDE.md`, `mega compress CLAUDE.md --apply`) + a bullet stating:
  dry-run by default; `--apply` is lossy but writes a `<path>.bak` you restore with
  `mv`; only `.md`/`.txt`/`.mdc`.
- `.changeset/compress.md`: `@megasaver/cli` minor (→ 1.10.0).

## Security / risk (CRITICAL)

This command **mutates user repo files** — the first module to do so. The chain the
critic, security-reviewer, and tracer must attack:

- **No write without `--apply`.** Dry-run is default; every non-apply path is
  spy-proven to leave `writeFile` uncalled (incl. `--json`).
- **No overwrite without a recoverable backup.** `.bak` is written before the
  target, always; a pre-existing `.bak` is never clobbered without `--force`.
- **Atomicity.** temp-in-same-dir + `rename` — no half-written/truncated file if the
  process dies mid-write; no leftover `.tmp` on success.
- **git-dirty guard** protects tracked-and-modified files; `.bak` protects
  untracked / no-git / clean-tracked files. Justify the fail-open on
  `gitFileStatus === "unknown"`: the `.bak` is the real safety net, so an
  undeterminable git state must not block the user, but it also must not *suppress*
  the backup.
- **Blast radius.** Extension guard limits targets to text-ish docs; single explicit
  path (no glob/recursion); the command never deletes.
- **Symlink note (v1 limitation):** `renameSync` onto a symlinked path replaces the
  *link* with a regular file rather than following it. v1 operates on the literal
  path; symlinked memory files are a non-goal. The security-reviewer confirms this is
  acceptable for the target file types.
- **No shell injection.** `gitFileStatus` uses `execFileSync("git", [...])` with the
  path as an argv element — never a shell string. The path also flows into
  stdout/stderr and (via R5) into rendered markdown inline-code; assert (as the bench
  markdown test does) that a metacharacter-laden basename renders inside inline code
  and never executes.

## Testing (TDD)

- **compress-file engine (pure, pro-analytics):**
  - math: fixture `compressed` with `… [3 paragraphs]` + `… [5 more items]` →
    `paragraphsCollapsed=3`, `listItemsDropped=5`, exact bytes/tokens/dollars,
    `changed=true`.
  - identical original/compressed → `changed=false`, all savings + counts 0.
  - singular markers `… [1 paragraph]` / `… [1 more item]` → counted as 1 each.
  - multiple paragraph markers across sections summed.
  - multibyte: a non-ASCII original → `originalBytes` (via Buffer) exceeds its char
    length (pins byte-accurate pricing).
  - `renderCompressionSummary`: contains `(est.)`, the counts, "lossy", "verbatim";
    contains no path/user-text.
- **CLI compress (apps/cli), injected fs/git:**
  - free path each combo (`{}`,`{apply}`,`{apply,force}`,`{json}`) → upsell, exit 0;
    injected spies `readFile`/`writeFile`/`gitFileStatus` all uncalled (the Pro
    `composeCompressionReport` is unreachable by construction — no read ⇒ no report;
    it is lazy-imported after the gate, not injected).
  - `.js` path → stderr extension message, exit 1, `readFile` uncalled.
  - missing file → stderr, exit 1, `writeFile` uncalled.
  - dry-run compressible doc → summary printed, `writeFile` UNCALLED, exit 0.
  - dry-run already-tight (short doc) → "already tight", `writeFile` uncalled, exit 0.
  - `--json` → valid `CompressionReport` JSON; `writeFile` uncalled even with
    `--apply` also set.
  - `--apply` happy path (git `clean`, no `.bak`) → `writeFile` called TWICE, order
    pinned `(bak, original)` then `(path, compressed)` via call log; stdout has
    `mv <path>.bak <path>`; exit 0.
  - `--apply` git `dirty` + no `--force` → stderr "--force", `writeFile` UNCALLED,
    exit 1.  `--apply` git `dirty` + `--force` → both writes, exit 0.
  - `--apply` `.bak` exists + no `--force` → stderr "backup already exists",
    `writeFile` UNCALLED, exit 1.  + `--force` → both writes, exit 0.
  - `--apply` already-tight → "not writing", `writeFile` UNCALLED, exit 0.
  - `--apply` git `untracked` / `unknown` → both writes, exit 0 (`.bak` is the net).
  - **real-fs round-trip + coupling guard** (temp dir, real `compressProse` + real
    `composeCompressionReport` + default atomic `writeFile`): an oversized `.md` →
    dry-run reports `changed` + positive savings (proves the marker regexes match
    the engine's real output — a silent format drift would zero the counts here);
    `--apply` → target shrinks, `<path>.bak === original`, no `.tmp` left; `mv`
    restore yields the original bytes.
- **R5 (pro-analytics/src/fix.test.ts):** memory file > threshold →
  `command === "mega compress <basename>"` (not null, not a full path),
  `appliable === false`, `detail` mentions `mega compress`; hostile path
  `/x/secret-project/CLAUDE.md` → `command === "mega compress CLAUDE.md"`.
- **teardown privacy addendum:** the existing hostile-label/path sweep still passes;
  add a case asserting the R5-derived command renders in `teardown.md` inside inline
  code with no path separator leaked.
- `pnpm verify` green.
- **E2E smoke on the PACKED tarball** (not source — the 1.6.0-class bundle guard):
  `npm pack` → install → test key activate → oversized temp `.md` →
  `mega compress f.md` (dry-run shows savings) → `mega compress f.md --apply`
  (f.md shrinks, `f.md.bak` exists, `mv` restores) → deactivate → free path shows
  upsell. Proves the lazy pro-analytics import AND the newly-exposed `compressProse`
  both resolve inside the shipped bundle.

## Non-goals (deferred)

LLM/semantic compression; a marker-less "kept-only" mode; a full line-by-line
unified diff in the terminal (v2 — counts + savings + `--json` skeleton suffice);
combined `--apply --json` writing; multi-file / glob / recursive targets; following
symlinks; auto-apply from savings-fix R5 (`[apply]`); GUI surface; localization.

## Slices

- **A**: pure engine (`composeCompressionReport` + `renderCompressionSummary`) +
  the one-line `compressProse` export from output-filter — TDD.
- **B**: gated CLI (`runCompress` + path guard + injected fs/git + atomic `.bak`
  apply + flags) incl. the real-fs round-trip/coupling test — TDD.
- **C**: R5 command pointer (fix.ts) + teardown privacy addendum — TDD.
- **D**: register + README + changeset + `pnpm verify` + tarball e2e smoke +
  CRITICAL reviews (code-reviewer + critic + security-reviewer + tracer + 3-lens
  final).
