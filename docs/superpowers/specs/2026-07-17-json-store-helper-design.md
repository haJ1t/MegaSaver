---
title: Shared atomic-JSON-store helper (json-store.ts)
risk: MEDIUM-HIGH
status: approved
created: 2026-07-17
---

# Shared atomic-JSON-store helper

## Problem

Three `@megasaver/core` modules hand-roll the identical ~15-line atomic-JSON-store
mechanic — read = `JSON.parse(readFileSync)` in try/catch, write = `mkdirSync`
recursive + write to `.{randomUUID}.tmp` + `renameSync`, no fsync, swallow write
errors:

- `guard-state.ts` (`readGuardState` / `writeGuardState`) — shipped
- `warm-start-state.ts` (`readWarmStartState` / `stampWarmStartSeen`) — shipped
- `autopilot-store.ts` (private `readJsonFile` / `writeJsonAtomic`) — feat/brain-autopilot

`autopilot-store.ts` already factored the mechanic into a `(storeRoot, fileName,
data)` write and a `(path) => unknown` read for its own two stores, proving the
abstraction is trivial and store-agnostic. A code reviewer flagged the triplication
as past the repo's "3 similar lines > premature abstraction" threshold (§8).

## The one design decision that makes this safe

**The helper owns ONLY the filesystem mechanic. Each caller keeps its own Zod
schema and its own fallback.** The three modules share the fs plumbing but differ
in error posture *after* the read:

| module | read miss/corrupt | write failure |
|---|---|---|
| guard-state | `null` | swallow |
| warm-start-state | `null` | swallow |
| autopilot-store (policy) | `structuredClone(DEFAULT_AUTOPILOT_POLICY)` — **fail-closed** | swallow |
| autopilot-store (digest) | `{ lastDigestAt: null }` | swallow |

The fail-closed default on the policy exists because a corrupt `autopilot.json` must
never enable auto-approval (which writes approved memory rows unattended); the
`structuredClone` fixed a proven bug where the returned singleton could be mutated
to flip that default to enabled process-wide. If the helper baked in a fallback,
these postures would have to be flattened or passed as a flag — a regression risk.

Instead the helper returns raw `unknown` on read (parse-or-`undefined`) and each
caller applies `schema.safeParse(...)` + its own fallback — exactly how
`readAutopilotPolicy` already does it. Error posture is preserved **by
construction**, in the caller, not by the helper.

## Scope — why exactly these three, and not the other three atomic writers

Core has three OTHER `renameSync` users (`embed-memory.ts`, `overlay-store.ts`,
`json-directory-store.ts`). They are deliberately **out of scope** — they are a
different, stronger mechanic and folding them into this helper would REGRESS them:

- they `fsyncSync` the temp file **and** the parent directory (power-loss durability);
- they **throw** `CorePersistenceError` on failure — losing an embedding / overlay /
  registry write is data loss, not advisory;
- they guard against parent-dir symlink attacks and carry Windows-specific handle logic.

This helper is for **advisory** state only — no fsync (deliberate: "a lost stamp
just re-onboards next session"), swallow-on-failure, small Zod-validated payloads.
Mixing the two error models is the exact thing this design refuses to do.

## API — `packages/core/src/json-store.ts` (core-internal, NOT barrel-exported)

```ts
// Read: parse-or-undefined. The caller applies its own schema + fallback so each
// store keeps its error posture (null vs fail-closed default).
export function readJsonFile(path: string): unknown

// Write: mkdir(recursive) + write to a .{uuid}.tmp + rename. Swallows all errors
// (best-effort advisory state; tmp+rename prevents partial-file corruption). No
// fsync — a lost write falls back to each caller's safe default.
export function writeJsonAtomic(dir: string, fileName: string, data: unknown): void
```

Both are lifted **verbatim** from `autopilot-store.ts`'s current private copies —
the write param name generalizes from `storeRoot` to `dir` (guard/warm write into a
subdirectory: `join(rootDir, "guard")`, `join(rootDir, "warm-start")`; autopilot
writes into `storeRoot` directly). Not re-exported from `index.ts`: these are
core-internal plumbing, and `guard-state`'s helpers were never public either (§8:
the barrel exports only public surface).

## Call-site rewiring (behavior byte-identical)

- **autopilot-store.ts** — delete the two private functions, `import { readJsonFile,
  writeJsonAtomic } from "./json-store.js"`. Every call site (`readJsonFile(join(...))`,
  `writeJsonAtomic(storeRoot, "autopilot.json", policy)`, etc.) is **unchanged** —
  the signatures match. `structuredClone(DEFAULT_AUTOPILOT_POLICY)` stays put.
- **guard-state.ts** — `readGuardState` becomes
  `guardStateSchema.safeParse(readJsonFile(statePath(rootDir, projectId)))` → `data`
  or `null`. `writeGuardState` keeps its session-pruning, then
  `writeJsonAtomic(join(rootDir, "guard"), \`${projectId}.json\`, { ...state, sessions })`.
- **warm-start-state.ts** — same shape:
  `warmStartStateSchema.safeParse(readJsonFile(statePath(...)))` → `data` or `null`;
  `writeJsonAtomic(join(rootDir, "warm-start"), \`${projectId}.json\`, { lastSeenAt: now })`.

## Verification

- New `json-store.test.ts` (TDD, written first): read missing/bad-JSON/valid;
  write creates the dir, is atomic (no `.tmp` left behind on success), overwrites,
  and swallows on an unwritable target.
- The three existing suites (`guard-state` 5, `warm-start-state` 5, `autopilot-store`
  21 = 31 tests) must stay GREEN **unmodified** — they are the behavior-parity net.
  Editing any existing assertion is a red flag meaning behavior changed.
- `pnpm verify` (lint + typecheck + all suites + conventions:check).
- External review: code-reviewer AND adversarial critic (§12 MEDIUM-HIGH, shipped
  security-adjacent path) — verify no error-posture flattening, no `structuredClone`
  regression, no scope creep into the fsync-throwing writers.

## Reviewed micro-divergence (the only non-byte-identical behavior)

`writeGuardState`'s session-pruning previously ran *inside* the try that
swallowed write errors; it now runs before `writeJsonAtomic` (only the write is
swallowed). For any valid `GuardState` the pruning is pure `Object.keys`/
`Object.fromEntries` and cannot throw, so persisted output is byte-identical
(gauntlet critic diffed the >20-session payload — identical, keeps last 20).
The behaviors differ only on a runtime input that violates the `GuardState`
type — an impossible-per-§8 case we deliberately do not defend, and re-wrapping
pure pruning in a swallow-try to preserve that would ADD the defensive code §8
bans. Left as-is; both the code-reviewer and the adversarial critic confirmed no
reachable regression.

## Non-goals

- No fsync added (would change the advisory contract).
- No barrel export.
- The three durable/throwing atomic writers are untouched.
- No behavior change of any kind — pure extraction.
