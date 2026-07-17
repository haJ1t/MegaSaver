# Autopilot policy single-snapshot — Implementation Plan

**Goal:** `runAutopilotRun` reads the autopilot policy once and threads that one
snapshot through both the enabled gate and `runAutopilot`, closing the TOCTOU
between the two reads (i14 gauntlet finding #6).

**Architecture:** No new dependency, no core change. Move the single
`readAutopilotPolicy` call after the PRO gate and before `ensureStore`; the enabled
check and `runAutopilot` both consume it. Delete the line-194 re-read. Spec:
`docs/superpowers/specs/2026-07-17-autopilot-policy-snapshot-design.md`.

**Risk:** LOW-MEDIUM (single-user, touches the machine-writes-approved gate).

---

### Task 1: single-snapshot test (TDD)
- Add to `apps/cli/test/commands/brain-autopilot-run.test.ts`: seed a recurring
  failure that auto-approves under the DEFAULT allowlist; `activatePro()`;
  `writeAutopilotPolicy(store, {...DEFAULT_AUTOPILOT_POLICY, enabled: true})`.
- Inject `ensureStore` that, before returning `ensureStoreReady(store)`, writes a
  MUTATED policy `{...DEFAULT_AUTOPILOT_POLICY, enabled: true, autoApproveTypes: []}`
  to `join(store, "autopilot.json")` (via `writeAutopilotPolicy`) — this is the
  concurrent `autopilot on` landing in the TOCTOU window.
- Assert: the run auto-approves the recurring failure (`approved` row present) — it
  used the gate's ORIGINAL snapshot, not the flipped one.
- Run → RED against the current double-read (line-194 re-read gets the empty
  allowlist → 0 approved, the recurring row is staged instead).

### Task 2: thread the single snapshot
- `apps/cli/src/commands/brain/autopilot.ts` `runAutopilotRun`:
  - After the `if (!input.dryRunFlag) { entitlement }` block, add
    `const policy = readAutopilotPolicy(input.storeRoot);` then
    `if (!input.dryRunFlag && !policy.enabled) { stderr(off msg); return 1; }`.
  - Delete the line-166 inline `readAutopilotPolicy(...).enabled` check (now folded
    into the above) and the line-194 `const policy = readAutopilotPolicy(...)`
    re-read; `runAutopilot` uses the threaded `policy`.
- Keep the WHY comment explaining the single-snapshot / TOCTOU reasoning.
- Run → GREEN. Existing run + policy suites green unmodified.

### Task 3: verify + changeset + review
- `pnpm verify` green.
- `.changeset/autopilot-policy-snapshot.md` — `@megasaver/cli` patch (behavior
  unchanged except the race; no public API change).
- Fresh code-reviewer on the diff: ordering constraints (PRO first, enabled before
  ensureStore, dry-run reads policy), `structuredClone` untouched, the test genuinely
  pins single-snapshot (mutation-proven).
