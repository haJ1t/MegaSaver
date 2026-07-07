---
title: Pro module 6 — waste exposé generator (mega teardown)
date: 2026-07-07
status: approved
risk: MEDIUM
scope: a sixth proprietary pro-analytics module (TeardownReport composer + markdown/SVG renderers) + a gated top-level `mega teardown` command that writes two NEW files (teardown.md, teardown.svg) with an exists-guard. No store writes; no user-file mutation; no entitlement/crypto change.
base: main (9ea7663d)
reviewers: [code-reviewer, critic]
manual-confirmation: given (user approved design 2026-07-07 — top-level Pro-gated, md+SVG output, full content set, generic-keys-only privacy)
---

# Pro module 6 — waste exposé generator (`mega teardown`)

## Motivation

The GTM plan's Element 2 is a content engine ("weekly teardown+benchmark"
posts). `mega teardown` turns that from manual labor into a product feature:
one command composes a publish-ready, share-safe exposé — "source X returns
~18K tokens per turn" — from the workspace's own measured events, plus the
treatments (module 5 advice) and an honest methodology footnote (source:
wiki/syntheses/pro-differentiation-portfolio.md E4;
wiki/syntheses/gtm-plan-2026-07.md Element 2).

## Locked decisions (user-approved 2026-07-07)

1. **Top-level `mega teardown`, Pro-gated** — same `savings-analytics` key,
   upsell + exit 0 on the free path, lazy pro-analytics import (m1–m5
   pattern). Module 6.
2. **Output = markdown + SVG card.** Default run writes `teardown.md` +
   `teardown.svg` into `--out <dir>` (default cwd). **No PNG in the CLI** —
   a native rasterizer cannot enter the bundle (the 1.6.0 incident class);
   PNG stays the GUI share modal's job.
3. **Exists-guard:** if either output file already exists the command
   refuses with a clear stderr line and exit 1; `--force` overwrites. The
   command must never silently clobber a user's file.
4. **Full content set**: headline → culprits table (per-source per-turn
   averages) → clawed-back story → treatments (module 5 advice reuse) →
   methodology footnote.
5. **Privacy by construction — generic keys only.** The report type has no
   free-text field sourced from user data: only the closed `sourceKind`
   union, the fixed `CLAUDE.md`/`AGENTS.md` memory-file literals, numbers,
   and fixed copy. Event `label` values (free-form in the schema) are never
   rendered at all — culprits key by source, advice titles are fixed
   templates. Paths, project names, workspace labels, and file contents
   NEVER appear. Pinned by a privacy sweep test with hostile label strings.
   Review amendment (Task-1 quality lens): the guarantee is enforced in the
   ENGINE, not just the CLI wiring — module 5's R5 titles render only the
   BASENAME of a memory-file path (`baseName` helper in fix.ts), so even a
   library caller passing a full path cannot leak it into the exposé; a
   hostile-path sweep case pins this in both fix and teardown tests.

## Design

### 1. Proprietary pure engine — `packages/pro-analytics/src/teardown.ts`

Types:

```
TeardownCulprit = {
  key: string;               // sourceKind (closed union)
  events: number;
  tokensReturned: number;
  avgTokensPerTurn: number;  // Math.round(tokensReturned / events)
  dollarsReturned: number;
  returnedShare: number;
};

TeardownAdvice = {
  title: string;             // FixAction.title (generic keys + numbers only)
  command: string | null;    // FixAction.command; appliable actions become
                             // the fixed "mega savings fix --apply"
};

TeardownReport = {
  headline: WasteHeadline;   // reuse computeWasteHeadline
  savedTokens: number;       // tokensFromBytes(headline.totalBytesSaved)
  savedDollars: number;
  culprits: TeardownCulprit[];   // desc by returnedShare, max top 5
  advice: TeardownAdvice[];
};
```

- **`composeTeardown(events, { saver, memoryFiles }): TeardownReport`** —
  reuses `computeWasteBreakdown(by:"source")`, `computeWasteHeadline`, and
  `computeFixPlan` (same inputs as module 5). Advice mapping: advice
  actions carry their own `command`; appliable actions (R1/R2) map to
  `command: "mega savings fix --apply"` so the exposé's treatment list ends
  with the one-command fix. Culprits: every source row with `events > 0`,
  sorted by `returnedShare` desc, capped at 5.
- **`renderTeardownMarkdown(report): string`** — fixed headings:
  `# Where the tokens went — a Mega Saver teardown`, `## The bill`,
  `## The culprits` (table: source / events / avg tokens per turn / share /
  `$ (est.)`), `## What Mega Saver clawed back`, `## The treatments`
  (advice list, commands as fenced inline code), `## Methodology` (flat
  `$3/MTok` input price named explicitly; every `$` labeled `(est.)`;
  "measured, not modeled" line). Zero events → the bill/culprits sections
  render an honest "No recorded events yet" line instead of empty tables.
- **`renderTeardownCardSvg(report): string`** — direction-B editorial card
  (mirrors `packages/stats/src/savings-card.ts` style: light ground, one
  big number, compact token formatting, XML-escape helper replicated
  locally with a WHY comment). Content: big `$ returned (est.)` + saved
  line + top-culprit line ("<key> · ~NK tokens/turn"). All text from
  closed-set keys + numbers + fixed copy.
- Export all three + types from `src/index.ts`.

### 2. Gated CLI — `apps/cli/src/commands/teardown.ts` (top-level)

`runTeardown(input)` mirrors `runRoi`/`runSavingsFix`:

1. `checkEntitlement("savings-analytics", …)` FIRST; not entitled →
   `TEARDOWN_UPSELL` (reuses `PRO_ANALYTICS_URL`), `return 0` — nothing
   read/computed/written, spy-enforced including with `--out`/`--json`/
   `--force` set.
2. Entitled → lazy import; `readAllEvents`
   (`defaultSavingsEventReader`), `readSaver` + `readMemoryFileSizes`
   (reuse module 5's exported default factories), `composeTeardown(...)`.
3. `--json` → `JSON.stringify(report)` to stdout, NO files, `return 0`.
4. File mode: resolve `outDir = --out ?? cwd`; targets `teardown.md`,
   `teardown.svg`. If either exists and no `--force` → stderr
   `refusing to overwrite <path> (use --force)`, exit 1, ZERO files
   written (check BOTH before writing EITHER). Else write both
   (injected `writeFile: (path, content) => void` defaulting to
   `writeFileSync`; tests use a temp dir), then print the two paths +
   a one-line share nudge.

Flags: `--out <dir>`, `--force`, `--json`, `--store <dir>`. Register
`teardown` in `main.ts` subCommands (alphabetical).

### 3. Docs + changeset

- `README.md`: command-table row + Pro section lines
  (`mega teardown`, `mega teardown --out ./posts --force`) + bullet stating
  the privacy rule ("generic source names and numbers only — never paths or
  project names").
- `.changeset/teardown.md`: `@megasaver/cli` minor (→ 1.8.0).

## Security / risk (MEDIUM)

No store writes, no user-file mutation; the only writes are two NEW files
behind an exists-guard (`--force` to override). Entitlement seam reused
read-only. Privacy invariant is a product promise — the critic must attack
it (injection via crafted label strings incl. XML/markdown metacharacters;
the SVG escape helper; the sweep test's completeness).

## Testing (TDD)

- **teardown engine (pure)**:
  - culprit math: avgTokensPerTurn = round(tokensReturned/events); sort by
    returnedShare desc; top-5 cap (6 sources → 5 rows). (Zero-event rows
    cannot exist — breakdown rows are built from events; no test needed.)
  - advice mapping: R3 command passthrough; R1 appliable → literal
    `mega savings fix --apply`; advice-only plan keeps commands.
  - empty events → honest "No recorded events yet" markdown; zeros; no NaN.
  - **privacy sweep**: fixture events built with hostile strings where the
    schema allows (label set to a fake path-like/XML-like string via the
    `as never` fixture), plus saver/memoryFiles fixtures; assert the FULL
    markdown and FULL SVG never contain the fixture cwd, a project-name
    marker string, or an unescaped `<script>`; SVG parses as XML-escaped
    (esc(`<`) present as `&lt;`).
  - markdown structure: all six fixed headings present, `(est.)` present,
    `$3` methodology line present.
- **CLI teardown**:
  - no license (each of `{}`, `{json}`, `{out,force}`) → upsell, exit 0,
    spies: reader fns + `composeTeardown` + `writeFile` ALL uncalled.
  - entitled `--json` → valid TeardownReport JSON, `writeFile` uncalled.
  - file mode in temp dir → both files written; md contains a culprit key;
    svg starts with `<svg`.
  - exists-guard: pre-create `teardown.md` only → exit 1, stderr contains
    `--force`, NEITHER file written (the svg must not appear);
    `--force` → both written.
- `pnpm verify` green. E2E smoke: test key → activate → `mega teardown`
  in a temp dir → files exist, md renders sane; `--json` valid; free →
  upsell; exists-guard trips.

## Non-goals (deferred)

PNG rasterization (GUI); scheduling/weekly automation; decision-trace-level
detail (v2); social-size image variants; GUI teardown tab; localization.

## Slices

- **A**: pure engine (`composeTeardown` + two renderers) — TDD.
- **B**: gated CLI (`runTeardown` + exists-guard + register + README +
  changeset) — TDD.
