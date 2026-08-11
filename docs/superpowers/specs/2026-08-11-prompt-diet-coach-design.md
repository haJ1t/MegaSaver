---
feature: prompt-diet-coach
date: 2026-08-11
risk: MEDIUM
status: draft-design
pending: [user-spec-review]
reviewers: [code-reviewer]
build-order: "7 of 9 (wave-3 batch)"
---

# Prompt Diet Coach — Advisory Only (P2-2)

## Problem

Long, repetitive prompts bloat every turn: the same file list re-enumerated, "please" scaffolding, verbatim pasted errors, and 5-file reads that could be one `rg`. Unlike `paste-airlock` (`docs/superpowers/specs/2026-08-06-paste-airlock-design.md`) which parks giant pastes, the mid-tail of verbosity has no feedback loop. Wave-2 `flow-governor` (`docs/superpowers/plans/2026-08-06-flow-governor.md`) is the turn-budget advisor, but it reacts to turn count, not to prompt shape.

## Goal

1. `UserPromptSubmit` hook emits a **diet suggestion** as `hookSpecificOutput.additionalContext` — advisory, never blocking — when a prompt is verbosely re-statable or batchable: repeated file mentions, list-then-read patterns, over-long scaffolding.
2. `mega prompt diet "<prompt>" [--json]` replays the same heuristics offline for any string, printing the suggestion + estimated token delta (`estimateTokens` before/after).
3. Coaching is **off by default**, toggled by `store/config/prompt-coach.json` (`{enabled:boolean, threshold:"conservative"|"balanced"|"aggressive"}`) — `mega prompt coach on|off|threshold <v>` manages it (pattern: `store/config` already holds `budget.json` for anomaly alerts).

Success criteria: prompt "read src/a.ts, src/b.ts, src/c.ts one by one" → suggests `rg -n "pattern" src/`; prompt "please please kindly ..." → trims scaffolding in suggestion; `mega prompt diet` offline matches hook suggestion; `pnpm verify` green.

## Non-Goals (YAGNI)

- No LLM rewrite — deterministic heuristics + string templates only.
- No blocking, no `decision:block`, no prompt rewrite — `additionalContext` only (`UserPromptSubmit` hook contract, like `task-kickoff-pack.ts:45`).
- No learning, no per-user style model in v1 (follow-up).
- No daemon, no network.

## Locked Decisions

1. **Hook is advisory, fail-open.** `apps/cli/src/hooks/prompt-coach-run.ts` mirrors `warmup-run.ts` / `saver-run.ts` posture: outer try/catch, `process.exitCode=0`, empty output on any failure, never emits `decision`. Config absent or `{enabled:false}` → empty output (no coaching).
2. **Heuristics (deterministic, capped).** Five rules, each a pure function `(prompt:string) => Suggestion|null`:
   - **Repeated mentions:** same absolute/relative path appears ≥3× → "mention once, list needs".
   - **File-list-then-read:** prompt enumerates ≥3 file paths and next action is likely reads → "batch reads into one `rg` / `mega output exec`".
   - **Scaffolding bloat:** filler n-grams (`please`, `kindly`, `could you`, `I would like`) ratio > 0.08 → trimmed variant.
   - **Pasted error verbatim:** stack-trace shaped block > 400 chars → "paste-airlock it instead of inlining".
   - **Repeated instruction:** same sentence (normalized) appears 2× → deduped variant.
   Each returns `{rule, suggestion:string, tokensBefore:number, tokensAfter:number, delta:number}`. At most **one** suggestion per prompt (highest delta), rendered as a one-screen card (≤ 12 lines) + token receipt.
3. **Token accounting via `estimateTokens`.** Before/after counted with the same `estimateTokens` (`@megasaver/output-filter`) the gate uses; delta is advisory, not a bill claim (honest-metrics).
4. **Budget-gated suppress.** When prompt length already ≤ `TASK_KICKOFF_CHARACTER_CAP/2` (4500) and token count ≤ `TASK_KICKOFF_TOKEN_CAP/2` (1000), no suggestion (not worth the turn).
5. **Ownership.** `apps/cli` owns all: `prompt/coach.ts` (pure rules), `hooks/prompt-coach-run.ts` (hook), `commands/prompt/coach.ts` + `diet.ts` (CLI). No new package.

## Architecture

```
UserPromptSubmit {prompt, cwd, session_id} -> mega hooks prompt-coach
  read store/config/prompt-coach.json (exists? enabled?)
  if disabled -> ""
  else runRules(prompt) -> best Suggestion or null
       -> envelope {hookSpecificOutput:{additionalContext: card}} or ""

mega prompt diet "please read a.ts ..." -> same runRules -> print card + delta
mega prompt coach on|off|threshold <v> -> write config (atomic 0600)
```

## Components

- **C1 `apps/cli/src/prompt/coach.ts` (pure):** `DietRule`, `runDietRules(prompt): Suggestion|null`, `estimateDietDelta(prompt, suggestion)`.
- **C2 `apps/cli/src/hooks/prompt-coach-run.ts`:** `buildPromptCoachOutput(payload, storeRoot): string`, `runPromptCoachFromProcess`.
- **C3 `apps/cli/src/commands/prompt/coach.ts` + `diet.ts` + `index.ts`:** citty `mega prompt coach|diet`.

## Error handling

- Config missing/malformed → empty output (no coaching), never throw (fail-open).
- Prompt empty / non-string → empty output.
- All file reads wrapped; hook never throws into the host.

## Security & privacy

- Prompt is already redacted before it reaches the hook's suggestion text? No — coach runs before redaction in the hook chain, so it calls `redact()` on the suggestion's example snippet before emitting.
- No prompt contents persisted (suggestion is ephemeral `additionalContext`); no network.

## Testing

- **Unit (TDD):** each rule fires/doesn't fire on fixture prompts, scaffolding ratio, repeated mention threshold, pasted-error heuristic, dedup, single-best selection (highest delta), token delta computed, suppress on short prompt, redaction on suggestion.
- **Integration:** `buildPromptCoachOutput` with `enabled:true` on a verbose prompt → envelope contains card; with `enabled:false` → `""`; `runDiet` offline mirrors hook's best rule.

## Risk & process

**MEDIUM** (§12: touches `UserPromptSubmit` hook path, but advisory only, no block, no session mutation). Reviewer `code-reviewer` only. `pnpm verify` + hook smoke (enabled toggle + verbose prompt → card) required.

## Dependencies / build order

- Depends on: `store/config` dir convention, `estimateTokens`, `redact`.
- Independent of P0/P1; complements `paste-airlock` and `flow-governor`.
- Build order **7 of 9 (wave-3 batch)**.

## Open questions

1. Should coach also suggest `mega output chunk` when the prompt asks to re-read a previously chunked file? (v1: no — diff-on-reread already handles.)
