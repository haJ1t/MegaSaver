---
title: Single policy snapshot for autopilot run (TOCTOU fix)
risk: LOW-MEDIUM
status: approved
created: 2026-07-17
source: i14 gauntlet critic finding #6
---

# Single policy snapshot for `mega brain autopilot run`

## The weakness (TOCTOU, not agent-reachable)

`runAutopilotRun` (`apps/cli/src/commands/brain/autopilot.ts`) reads the autopilot
policy TWICE:
- line 166 — `if (!readAutopilotPolicy(storeRoot).enabled)` (the enabled gate,
  before `await ensureStore()`).
- line 194 — `const policy = readAutopilotPolicy(storeRoot)` (passed to
  `runAutopilot`, after `ensureStore`).

`runAutopilot` never re-checks `.enabled`; it uses only `autoApproveTypes` and
`maxAutoApprovesPerSession` from the second read. The `await ensureStore()` between
the two reads is a TOCTOU window: a concurrent `mega brain autopilot on/off` (or a
direct edit of `autopilot.json`) landing in that window makes the run execute with
a policy snapshot (read #2) that the enabled gate never validated — e.g. auto-approve
under `autoApproveTypes`/cap the user just changed, or with `enabled:false` in the
very snapshot the run is acting on.

Severity is LOW: single-user local CLI, no adversary — it requires the user to
toggle their own store mid-run. Deferred rather than blocking i14 merge. But the
fix is clean and makes the code strictly more coherent (the run acts on exactly the
policy that was gated), so it is worth doing.

## The fix

Read the policy ONCE and thread that single snapshot through both the enabled gate
and `runAutopilot`. Do NOT re-read.

Placement preserves the two existing ordering constraints:
- **PRO gate first, zero work when unentitled** (§8 comment / architect M3): the
  single read stays AFTER the entitlement check, so an unentitled real run still
  returns on the upsell before any policy read.
- **Enabled gate before `ensureStore`** (M3: a disabled run must not initialize the
  store, which is a write): the read + enabled check stay before the `try {
  ensureStore }` block.
- **`--dry-run` skips PRO + enabled** but still needs the policy for the run: the
  single read must also feed the dry-run path.

Resulting shape:
```ts
if (!input.dryRunFlag) {
  const ent = checkEntitlement("brain-autopilot", { ... });
  if (!ent.entitled) { input.stdout(AUTOPILOT_UPSELL); return 0; }
}
// ONE snapshot, threaded through the enabled gate AND runAutopilot below, so a
// concurrent `autopilot on/off` in the ensureStore window can't make the run act
// on a policy the gate never validated (TOCTOU).
const policy = readAutopilotPolicy(input.storeRoot);
if (!input.dryRunFlag && !policy.enabled) {
  input.stderr("autopilot is off — enable with: mega brain autopilot on");
  return 1;
}
// ... ensureStore, session/project checks ...
const result = await runAutopilot({ ..., policy, ... });   // same snapshot; the
                                                           // line-194 re-read is gone
```

## Invariants preserved

- `readAutopilotPolicy` is unchanged — it still fails closed and returns a
  `structuredClone` of the disabled default (a prior review fixed an aliasing bug
  where the returned default was the shared singleton; this fix does not touch that
  function, only calls it once).
- Non-race behavior is byte-identical: in the common case the two reads returned the
  same policy, so threading one is the same output. Existing run suite stays green
  unmodified.
- Entitlement-first, enabled-before-ensureStore, dry-run-free all preserved.

## Verification

- **Single-snapshot test (TDD, written first):** the injected `ensureStore` sits
  EXACTLY in the TOCTOU window (between the gate read and the old line-194 read). A
  test injects an `ensureStore` that writes a MUTATED policy (`autoApproveTypes: []`)
  to `autopilot.json` as a side effect before returning the registry, simulating a
  concurrent `autopilot on` landing mid-run. Seed a recurring failure that
  auto-approves under the ORIGINAL allowlist. Assert the run auto-approves it (used
  the gate's snapshot). Against the current double-read this FAILS (the re-read gets
  the empty allowlist → 0 approved); after the fix it passes. Mutation-proven both
  ways.
- Existing `brain-autopilot-run` + `brain-autopilot-policy` suites green unmodified.
- `pnpm verify`. External review: code-reviewer (LOW-MEDIUM, machine-writes-approved
  gate) — confirm the ordering constraints held and `structuredClone` fail-closed
  behavior is intact.

## Non-goals

- Not making `runAutopilot` re-check `.enabled` (the finding prescribes threading the
  snapshot, not a second gate).
- Not adding locking/atomicity around the store (out of scope for a single-user CLI;
  the single-snapshot read is the coherent fix).
