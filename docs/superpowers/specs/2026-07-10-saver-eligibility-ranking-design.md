# Saver Eligibility + Ranking — Wave 3 Design

- **Date:** 2026-07-10
- **Risk:** HIGH (token audit logic, context packer, ranking — §12)
- **Scope:** Wave 3 of the saver-savings-gaps program ([wiki/syntheses/saver-savings-gaps.md](../../../wiki/syntheses/saver-savings-gaps.md)): findings B8, B9, B10, D16, D17, D18, D19, D20.
- **Base:** stacked on `feat/saver-recovery` (wave 2). Branch `feat/saver-eligibility`.
- **Status:** approved (design gate 2026-07-10, user picked all four recommended options)

## Problem

Two failure themes confirmed by the 46-finding audit:

- **B. Eligibility** — outputs that should compress never do. The hook pre-gates by
  byte size (`minBytesFor`), but `filterOutput` re-decides with fixed token
  constants (1200/2000), producing a dead band (B8). Safe mode's 32 000 B gate
  exceeds Claude Code's ~30 000-char Bash truncation ceiling, so safe mode never
  compresses a command (B9). The hook never passes `source` into `filterOutput`,
  so semantic AST chunking is dead code and every file read is chunked at blind
  40-line boundaries (B10).
- **D. Ranking quality** — compression actively misleads. Kept excerpts render in
  score order with bare `\n` joins, no elision markers, no line info (D16). Intent
  is a workspace-global latest-wins file that never expires (D17). The intent
  tokenizer is ASCII-only, so Turkish prompts rank nothing (D18). Mode records pin
  a HIGH-risk repo to `aggressive` with no veto (D19). The prose compressor
  truncates lists to 3 items (D20).

## Design

### B8 — dead band: single gate authority

The hook's `minBytesFor(tool, mode)` becomes the ONE eligibility decision. The
hook passes its effective gate value into `record()` as `compressFloorBytes`;
`recordAndFilterOverlayOutput` derives both token thresholds from it and passes
them to `filterOutput`:

```
passthroughThresholdTokens = hardWrapThresholdTokens = ceil(compressFloorBytes / 4)
```

Consequence: any output that clears the hook gate gets `decision === "compressed"`.
The `light` band disappears on the hook path (it was discarded by
`record-output.ts` anyway). Library callers of `filterOutput` that do not pass
thresholds keep the existing 1200/2000 defaults — no behavior change outside the
hook/daemon path.

- `RecordOverlayOutputInput` gains optional `compressFloorBytes: number`.
  Fallback when absent: `modeToBudget(mode)` (preserves old callers).
- Daemon `excerptRequestSchema` gains the same optional field; `saver-run.ts`
  forwards it.
- Zod fields on `filterOutput` (`passthroughThresholdTokens`,
  `hardWrapThresholdTokens`) already exist — no output-filter schema change.

**Why thresholds derive from the gate, not the mode budget (B8×B9 interaction):**
with mode-budget-derived thresholds, safe mode would need 8000 tokens (32 000 B)
to compress — but B9 lowers the safe Bash gate to 24 000 B (6000–7500 tokens for
real payloads), which would land in `passthrough`. Deriving from the effective
per-call gate keeps both fixes coherent.

### B9 — safe mode Bash: ceiling-aware floor

Claude Code truncates Bash tool output at ~30 000 chars before the PostToolUse
hook sees it, so any gate ≥ 30 000 B means "never". In `saver.ts`:

```ts
const BASH_COMPRESS_FLOOR = 24_000; // must stay below Claude Code's ~30 000-char Bash ceiling

function minBytesFor(tool: string, mode: TokenSaverMode): number {
  const budget = modeToBudget(mode);
  if (tool === "Bash") return Math.min(budget, BASH_COMPRESS_FLOOR);
  return ORIGINAL_TOOLS.has(tool) ? budget : Math.max(budget, NEW_SURFACE_MIN_BYTES);
}
```

Aggressive (4000) and balanced (12 000) are unchanged (`min` is a no-op). Safe
now compresses 24 000–30 000 B Bash outputs. Read/Grep/Glob keep the 32 000 B
safe-mode semantics.

### B10 — wire `source` into `filterOutput`

Single-site fix in `record-output.ts` (~L104): pass
`source: chunkSetSource(input.sourceKind, input.label)` into `filterOutput`,
using the **raw** (pre-redaction) label — the file extension must survive for
semantic chunking to trigger. The redacted label continues to be what's
persisted in the chunk set (unchanged).

- Lights up `chunkBySemantic` for `.ts/.tsx/.js/.jsx/.mts/.cts/.mjs/.cjs`,
  `.py`, `.go`, `.rs`, `.md`, `.json` file reads (capability already exists and
  is tested at the library layer in `filter-output-semantic.test.ts`).
- Daemon path fixes itself for free — `excerptHandler` already carries
  `sourceKind` + `label` and routes through the same function. No HTTP schema
  change.
- Behavior shifts to validate: file sources get `skipDedupe` semantic chunks;
  `compressorEligible` excludes non-`structured` compressors for file sources,
  so `.md` file reads leave the prose compressor (see D20).

### D16 — render in source order with elision markers

`returnedTextOf` in `record-output.ts` is the single rendering chokepoint. New
behavior:

1. Sort kept excerpts by `startLine` ascending (source order, not score order).
2. Emit elision markers for gaps — leading, between non-adjacent excerpts, and
   trailing (total line count computed from the raw text):

```
<summary>
… [lines 1–44 omitted]
<excerpt lines 45–80>
… [lines 81–520 omitted]
<excerpt lines 521–560>
… [lines 561–1203 omitted]
```

Marker format: `… [lines A–B omitted]` — short, deterministic, no per-gap fetch
instructions (the wave-2 recovery footer already advertises chunk fetch).
`OutputExcerpt.startLine/endLine` already carry the needed metadata; today it is
discarded at the join.

Both consumers of `returnedTextOf` (`returnedText`, `redactedReturnedContent`)
get the same treatment automatically.

### D17 — intent: per-session + TTL

- `intent-run.ts` payload schema adds `session_id` (optional string — Claude
  Code sends it on every hook event).
- **Write:** with a session id → `stats/<wsKey>/intent/<sessionId>.json`; always
  also write the legacy `stats/<wsKey>/session-intent.json` (keeps old saver
  binaries and id-less payloads working). Same `{prompt, ts}` shape, atomic
  tmp+rename, redacted prompt.
- **Read:** `readSessionIntent(storeRoot, wsKey, sessionId?)` — per-session file
  first, legacy fallback. Both reject entries older than
  `INTENT_TTL_MS = 30 * 60_000` (the `ts` field is finally read).
- **GC:** the wave-2 `maybeRunOverlayGc` sweep additionally prunes
  `stats/*/intent/*.json` files older than the same 30-day retention. Intent
  files are ≤1 KB; TTL already makes stale ones inert, GC just bounds disk.
- `saver.ts` threads its `sessionId` into the read (it already has
  `p["session_id"]`).

### D18 — Unicode tokenizer

`rank.ts` `tokenize`:

```ts
const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
```

One function serves both intent and chunk tokenization, so matching stays
symmetric (Turkish `İ` → `i̇` on both sides). Score-pinning tests
(`determinism.guard.test.ts`, `rank.test.ts`) re-baseline.

### D19 — repo-local mode floor

New committed policy file at the repo root: `.megasaver/policy.json`:

```json
{ "modeFloor": "balanced" }
```

- Zod schema: `{ modeFloor?: "balanced" | "safe" }` (closed set; `aggressive`
  floor is meaningless). Unknown keys rejected. Malformed file → ignored with
  no clamp (fail-open, consistent with hook philosophy) — `mega doctor` can
  surface it later (wave 4 territory).
- **Enforcement, single point:** `resolveWorkspaceTokenSaverSettings` reads the
  policy from the git worktree top-level (fallback cwd), and clamps the resolved
  mode to the floor using the order `aggressive < balanced < safe`. A clamped
  result is marked (e.g. `clampedBy: "policy"` on the resolution) so `status`
  can show it.
- `mega session saver enable --mode aggressive` on a floored repo: prints a
  notice that the policy clamps it; the record is still written as requested
  (resolver clamps at read time — one enforcement point, no write-path drift).
- **This repo** gets `.megasaver/policy.json` with `{"modeFloor": "balanced"}`
  — the existing aggressive pin becomes effectively balanced, honoring §12
  (HIGH-risk source repo must not run evidence-dropping compression).

### D20 — conscious accept (scoped down by B10)

After B10, `.md` **file reads** route to semantic markdown chunking — the wiki
startup-read breakage (the finding's real-world harm) is fixed by B10, not by
touching the prose compressor. The prose compressor still applies to
fetch/command prose, where the 3-item list truncation and paragraph collapse
remain **as designed**: the elision markers it emits (`… [N more items]`,
`… [N paragraphs]`) plus the wave-2 recovery footer make the loss recoverable.
No code change. Documented here as a conscious accept.

## Test strategy (RED-first, per finding)

| Finding | Failing test before code |
|---|---|
| B8 | e2e: 5 KB output, aggressive → `decision === "compressed"` (today: passthrough). Unit: `record-output` derives thresholds from `compressFloorBytes`. |
| B9 | `minBytesFor("Bash", "safe") === 24_000`; e2e: 26 KB Bash, safe → compressed (today: passthrough). |
| B10 | e2e: `.ts` file read through `recordAndFilterOverlayOutput` → semantic (function-aligned) excerpts, not 40-line slices. Mock-arg test: `filterOutput` receives `source: {kind:"file", path}` with the raw label. |
| D16 | Excerpts render sorted by `startLine` with `… [lines A–B omitted]` markers at leading/middle/trailing gaps. |
| D17 | Two sessions, same workspace → each reads its own intent. TTL: entry older than 30 min → undefined. Legacy fallback: no per-session file → legacy file (fresh) used. |
| D18 | `keywordScore("worktree oluştur ve derle", chunkWithTurkishWords) > 0` (today: 0/inert). |
| D19 | Resolver + policy floor `balanced` + exact record `aggressive` → resolved mode `balanced`, marked clamped. No policy file → unchanged. Malformed policy → unchanged. |

Re-baselines expected: `determinism.guard.test.ts`, `rank.test.ts` (D18 score
shifts), `record-output-intent.test.ts` (mock-arg now includes `source` and
thresholds), saver e2e fixtures (D16 marker format).

## Non-goals

- Prose compressor behavior changes (D20 — conscious accept above).
- New token-saver mode or `tokenSaverModeSchema` change.
- Per-subagent intent distribution (legacy fallback covers it).
- `mega doctor` surfacing of malformed policy files (wave 4, E22).
- Making `light` decisions storable (dead band closes via thresholds instead).

## Package impact / build order

`output-filter` (D18) → `context-gate` (B8 thresholds, B10 source, D16 render,
D19 resolver+policy) → `daemon` (optional `compressFloorBytes` field) → `core`
(re-export surface only, likely untouched) → `cli` (B9 gate, B8 plumbing, D17
intent hook + GC sweep). Changeset: minor for `context-gate`, `output-filter`,
`cli`; patch for `daemon`.

## Review sign-offs

- Design gate: user approved (2026-07-10), all four AskUserQuestion decisions =
  recommended options (B8 mode-scaled-thresholds-from-gate, B9 Bash floor cap,
  D17 per-session+TTL, D19 repo-local mode floor).
- Spec review: pending user review.
- Final: code-reviewer + adversarial critic in fresh contexts (HIGH risk, §12).
