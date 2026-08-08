---
feature: paste-airlock
date: 2026-08-06
risk: HIGH
status: draft-design
pending: [user-spec-review, architect-pass]
reviewers: [code-reviewer, critic]
build-order: "14 of 20 (wave-2 batch)"
---

# Paste Airlock (#14) — Design Spec

## Problem

Developers paste large blobs into the agent — build logs, stack traces,
curl responses — straight into the prompt. That blob enters context
verbatim, gets re-quoted in replies, survives nowhere after compaction,
and is never redacted or recoverable. Mega Saver intercepts *tool*
output today (PostToolUse saver → `recordAndFilterOverlayOutput`,
`packages/context-gate/src/record-output.ts`) but the paste path — the
single largest uncompressed inflow left — bypasses every gate. The
UserPromptSubmit surface already exists for intent capture
(`apps/cli/src/hooks/intent-run.ts`, PR #180) and proves the event
carries `{ prompt, cwd, session_id }`.

## Goal

1. **Detect** paste-like prompts at UserPromptSubmit with a conservative
   two-signal rule: size (≥ 40 lines OR ≥ 4 KB) AND log-likeness
   (reusing `classifyOutput`, `packages/output-filter/src/classify.ts`).
   Ordinary prose is NEVER intercepted.
2. **Park losslessly:** persist the ORIGINAL prompt text, policy-redacted
   (`redact`, `@megasaver/policy`), as an overlay chunk set
   (`recoverableChunks` + `saveOverlayChunkSet`) fetchable via
   `mega output chunk "<id>" "<i>"` / MCP `proxy_expand_chunk`.
3. **Inject a digest** (`hookSpecificOutput.additionalContext`): an
   "airlocked" label, byte/line counts, classified category, all
   error/fail/warn/exit-marker lines kept in original order up to a
   budget, and the full fetch handle.
4. **Reversibility:** `mega airlock on|off|status` kill-switch, `!raw`
   per-prompt bypass, fail-open exit 0 everywhere.

Success criteria: prose/short prompts produce zero output; a 600-line
vitest log paste parks a chunk set + emits a ≤ 2 KB digest envelope;
secrets never persist un-redacted; `pnpm verify` green.

## Harness contract (VERIFIED) — why v1 is additive, not substitutive

Verified against the Claude Code hooks docs
(code.claude.com/docs/en/hooks.md, checked 2026-08-06): UserPromptSubmit
has **no prompt-replacement field** (no `updatedPrompt`). The output
contract is exactly: (a) `hookSpecificOutput.additionalContext` — a
string added to context ALONGSIDE the unchanged prompt (repo precedent:
`task-kickoff.ts` L312-318); (b) `decision: "block"` — erases the
prompt entirely, `reason` goes to the *user*, not to context. Block is
useless here: it destroys the user's intent (§1 — we are NOT an
LLM-blinder; over-stripping user intent is the worst failure).

**Therefore v1 is the additionalContext design: the raw paste still
enters context once (harness limitation), and the airlock adds parking
+ digest + handle.** The v1 win is honest and real but different from
substitution: the paste survives compaction via the parked copy; the
agent anchors on the digest and fetch handle instead of re-quoting; the
persisted copy is redacted. v1 claims ZERO token savings (see LD4).
A substitution mode ("v2-replacement", the original ambition) is
specified as DORMANT: it activates only if the harness ships a
prompt-modification field, and is a separate spec cycle. This paragraph
is the requirement-(d) honesty marker: additionalContext is the real
path; replacement is NOT possible today. (No ASSUMPTION remains — the
contract was verified, not assumed.)

## Non-Goals (YAGNI)

- **No prompt modification or blocking.** Never emit `decision`.
- **No overlay stats event, no savings claim.** `TokenSaverEvent`'s
  adoption metrics treat every event as a proxy-tool interception
  (`packages/stats/src/metrics.ts` `proxyToolNameForSourceKind`), and
  v1 removes zero tokens from context — a `bytesSaved` row would be
  fiction (honest-metrics posture). Also keeps the hard rule: apps/cli
  never imports `@megasaver/stats` directly.
- **No `OutputSourceKind` extension** (same reason: that enum feeds the
  stats event schema and the adoption denominator contract).
- **No evidence-ledger row in v1.** Evidence rows model compressions;
  the parked chunk set IS the airlock's evidence. Revisit with v2.
- **No multi-segment splitting.** v1 treats the whole prompt as the
  candidate segment; the log-line-fraction threshold tolerates a short
  prose preamble ("why does this fail?\n\n<log>"). Per-segment
  extraction is v2.
- **No daemon route.** The hook works in-process from disk.

## Locked Decisions

1. **Trigger = size AND log-likeness (two-signal).** Size: prompt
   ≥ `AIRLOCK_MIN_LINES = 40` OR ≥ `AIRLOCK_MIN_BYTES = 4096`.
   Log-likeness: `classifyOutput({ text })` confident (≥ 0.5 floor) in
   `vitest`/`typescript`/`diff`/`structured`, OR line-signal fraction
   ≥ `LOG_LINE_MIN_FRACTION = 0.4` over ≥ 8 lines. A confident `prose`
   classification VETOES interception unconditionally.
2. **Sibling handler `mega hooks airlock`, not an intent-run extension.**
   intent-run wraps a 500 ms-deadlined worker orchestration
   (`TASK_KICKOFF_DEADLINE_MS`, `task-kickoff-process.ts`); the airlock
   does store I/O + classification on up to 1 MiB and must not share
   that deadline or failure domain. One responsibility per hook is the
   repo pattern (saver/intent/warmup/guard each separate), and two
   same-event entries keyed by subcommand are proven to coexist
   (`entryMatchesSubcommand`, `hook-settings.ts`; recap beside warmup).
   Stdin cap: `MAX_AIRLOCK_HOOK_STDIN_BYTES = 1 MiB` — 4× intent-run's
   `MAX_INTENT_HOOK_STDIN_BYTES` (256 KB) precedent, because large
   pastes are this feature's entire subject; over-cap → fail open.
3. **Park surface = overlay chunk set with a new source member
   `{ kind: "paste", label }`** in `overlayChunkSetSchema`
   (`packages/content-store/src/chunk-set.ts`). Chunking via the
   existing `recoverableChunks` (context-gate; newly exported), 40-line
   chunks, same coordinate system as every other stored output. NOT
   `recordAndFilterOverlayOutput` wholesale — its stats/evidence side
   effects are exactly what Non-Goals exclude. `chunkSetId` is
   content-derived (`cs-` + sha256 of redacted text, 32 hex): a
   re-paste of the same blob overwrites its own set (wiki
   `concepts/chunk-set-identity`: reads may key on the bare id).
4. **Digest is conservative and always reversible.** Keep ALL lines
   matching error/fail/warn/exit-marker signals, in original order,
   up to `AIRLOCK_DIGEST_KEEP_BUDGET = 1536` bytes (line clamp 200
   chars), then `+N more matching lines in store`. Header always
   carries: `[airlocked]` label, byte count, line count, category, and
   the full fetch handle (`mega output chunk` wording mirrors
   `buildRecoveryFooter`, `context-gate/src/recovery-footer.ts`). No
   savings percentage is printed (LD: no savings claim in v1).
5. **Redact once, use twice.** `redact(prompt)` runs first; BOTH the
   parked chunks and the digest are built from the redacted text.
   (§1 evidence-preserving: redaction is the only lossy step, and it is
   the mandated one.)
6. **Kill-switch + bypass.** `<storeRoot>/airlock.json`
   `{ enabled: boolean }`, atomic tmp+rename write; missing file =
   enabled (installing the hook is the opt-in). `mega airlock off|on`
   toggles it; `mega airlock status` reports it. Per-prompt bypass:
   prompt matching `/^\s*!raw\b/` skips everything (marker mandated by
   the feature brief; see Open questions for the TUI `!` collision).
7. **New log-line signal regexes are linear by construction:** each is
   tested against a 512-char per-line head slice, uses bounded
   quantifiers, and never uses `^\s*` under `m` (wiki
   `concepts/redos-case-output-filter`). A committed growth-ratio guard
   test (4× step, min-per-side, seeded anchored corpus with a minimum
   match-count assertion) fences them per
   `concepts/redos-guard-testing` / `redos-growth-ratio-measurement`.

## Architecture

```
UserPromptSubmit {prompt, cwd, session_id} -> mega hooks airlock
  cap stdin 1 MiB; config enabled? ; /^\s*!raw\b/ bypass?
  assessPaste(prompt)                    [@megasaver/output-filter]
    size(40 lines OR 4 KB) AND (classifyOutput confident log category
    OR log-line fraction >= 0.4); prose veto
  -> not a paste: exit 0, no output (the common path)
  -> paste: redact(prompt)              [@megasaver/policy]
       parkPaste: recoverableChunks -> saveOverlayChunkSet
         content/<wk>/<sid>/cs-<sha256:32>.json  source={kind:"paste"}
       buildAirlockDigest: header + kept error lines + fetch handle
       stdout: {hookSpecificOutput:{hookEventName:"UserPromptSubmit",
                additionalContext: digest}}
(raw prompt enters context unchanged — harness contract, v1)
recovery: mega output chunk "cs-…" "<i>"  /  MCP proxy_expand_chunk
```

## Components

- **C1 `@megasaver/output-filter` — `src/paste.ts`:** `assessPaste(text)
  : PasteAssessment { intercept, category, confidence, logLineFraction,
  lines, bytes }` + exported trigger constants. Reuses `normalize` +
  `classifyOutput`; adds per-line signal regexes (timestamp, level,
  frame, path:line, exit marker, shell echo) run on 512-char heads.
- **C2 growth-ratio guard test** (`test/paste-quadratic.test.ts`),
  mirror of `test/dedupe-quadratic.test.ts`, driven through
  `assessPaste` (the public entry), committed with the feature.
- **C3 `@megasaver/content-store`:** `overlayChunkSetSchema` source
  union + `{ kind: "paste", label: z.string() }` (additive; TS
  exhaustiveness surfaces every switch site at typecheck).
- **C4 `@megasaver/context-gate`:** export existing `recoverableChunks`
  from the package index (public-API addition, changeset).
- **C5 CLI hook (`apps/cli/src/hooks/airlock.ts` + `airlock-run.ts` +
  `commands/hooks/airlock.ts`):** config read, bypass, park, digest,
  envelope; fail-open process wrapper (exit 0 always, cap stdin).
- **C6 CLI kill-switch (`apps/cli/src/commands/airlock.ts`):**
  `mega airlock on|off|status`, injected-io Citty handler per
  `wiki/workflows/cli-test-pattern`.
- **C7 connector:** `AIRLOCK_HOOK_COMMAND`, `buildHookCommand` union +
  `"airlock"`, second UserPromptSubmit entry via
  `addUserPromptSubmitHook`, `installClaudeCodeHook({ airlock?: boolean })`
  (default true, `--no-airlock`), uninstall + status wired.

## Error handling

- Every entry point mirrors `runSaverHookFromProcess` /
  `runIntentHookFromProcess`: outer try/catch, `process.exitCode = 0`,
  no stdout on any failure — a crashing UserPromptSubmit hook would
  block every prompt (fail-open is not optional).
- Zod `safeParse` on the payload; missing/unsafe `session_id`
  (intent-run's `SAFE_SEGMENT`) → no interception (park needs the
  overlay key `(workspaceKey, session_id)`).
- Stdin over 1 MiB → no interception (mirrors intent-run's cap shape).
- Park write failing → NO digest either: a handle pointing at nothing
  is worse than silence (reversibility invariant: digest ⇒ parked).
- Config unreadable/malformed → treated as enabled=true only if the
  file is absent; a malformed file reads as DISABLED (fail toward
  doing nothing).

## Security & privacy

- The parked copy is `redact`-ed before persist; the digest is built
  from the same redacted text; the chunk-set `label` is a fixed string
  (`"user paste"` + counts), never raw prompt content.
- `session_id`/`workspaceKey` path segments gated by `SAFE_SEGMENT` /
  content-store `assertSafeSegment` (existing).
- Store files 0o600/0o700 posture matches intent-run's writer.
- The digest is data, not instructions; it is rendered from
  schema-validated fields and clamped lines only.
- The raw prompt still reaches the model (harness contract) — the
  airlock adds no NEW exposure; it strictly reduces what is *persisted*.

## Testing

TDD, red first. C1: fixture-driven positives (vitest log, tsc output,
timestamped build log, large JSON array, git diff) and negatives
(prose/markdown, short error snippet, 39-line boundary, single-line
5 KB blob); fraction + veto edges. C2: growth-ratio guard (anchored
corpus, min-match assertion, 4× step, min-per-side, no wall-clock
ceiling). C5: park+digest round-trip through a temp store; `!raw`
bypass; disabled config; secret redaction visible in BOTH chunk file
and digest; fail-open on malformed stdin/no session_id; digest absent
when park fails (injected thrower). C6: on/off/status round-trip with
injected io. C7: add/remove/idempotence + install/uninstall/status.
No timing-tight tests; the only timing instrument is the C2 ratio.

## Risk & process

**HIGH** (§12: public CLI flags, connector core path, prompt-path hook
at session scale). Worktree mandatory; `architect` pass on this spec;
`code-reviewer` AND `critic` in separate fresh contexts; verifier
evidence: captured smoke (paste payload → chunk file + envelope; prose
payload → silence) + `pnpm verify`. Escalation triggers: any need to
touch `filterOutput` internals, ranking weights, or stats schemas ⇒
stop, re-spec.

## Dependencies / build order

"14 of 20 (wave-2 batch)". Depends only on shipped surfaces:
output-filter classify (v1.2), content-store overlay sets (BB4/#140),
context-gate chunker + footer (#140/F30), intent hook + installer
(#180/#141). Cross-pair notes: compaction-guard's capsule builder
buckets unknown source kinds as fetches — a one-line `"paste"` count
there is a follow-up, not a blocker; session-resurrection's
`listOverlayChunkSets` lists paste sets automatically. Changesets:
`@megasaver/output-filter`, `@megasaver/content-store`,
`@megasaver/context-gate`, `@megasaver/connector-claude-code`,
`@megasaver/cli` (all minor).

## Open questions

1. `!raw` vs the Claude Code TUI: a leading `!` in the composer enters
   bash mode, so the marker may be untypeable interactively (it works
   when pasted mid-edit or sent programmatically). If field reports
   confirm the collision, add `#raw` as a synonym — marker itself is
   mandated by the brief.
2. Should a confident `diff` paste keep hunk headers (`@@`) in the
   digest in addition to error lines? v1: no — error-pattern lines only.
3. v2-replacement: if the harness adds prompt modification, substitution
   re-opens as its own spec (new risk analysis: modifying user input is
   CRITICAL-adjacent).
4. Digest utility telemetry (was the handle ever fetched?) wants a
   stats event family — deferred with the Non-Goal until v2.
