---
title: BB3 — @megasaver/policy package TDD plan
status: proposed
risk: HIGH
created: 2026-05-10
parent: aa1-context-gate-epic
sub-pr: BB3
spec: docs/superpowers/specs/2026-05-10-bb3-policy-design.md
---

# BB3 — `@megasaver/policy` TDD plan

Worktree: `/Users/halitozger/Desktop/MegaSaver/.worktrees/bb3-policy`.
Work ONLY here. Spec is authority; this plan executes it.
TDD per `CLAUDE.md` §4: failing tests first, then impl, then
verify, then commit. HIGH risk → `architect` design + `critic`
adversarial review before merge (`CLAUDE.md` §12).

---

## File map (every new file)

### Scaffold (mirror `packages/shared/` exactly — spec §7)

- [ ] `packages/policy/package.json`
- [ ] `packages/policy/tsconfig.json`
- [ ] `packages/policy/tsconfig.test.json`
- [ ] `packages/policy/tsconfig.test-d.json`
- [ ] `packages/policy/tsup.config.ts`
- [ ] `packages/policy/vitest.config.ts`
- [ ] `packages/policy/src/index.ts` (barrel — public surface only)

### Source (impl — spec §2–§5)

- [ ] `packages/policy/src/deny-code.ts` (closed enum, spec §2/§6)
- [ ] `packages/policy/src/allowed-commands.ts` (const, spec §3a)
- [ ] `packages/policy/src/dangerous-patterns.ts` (const, spec §3b)
- [ ] `packages/policy/src/evaluate-command.ts` (spec §3)
- [ ] `packages/policy/src/secret-paths.ts` (denylist + glob→regex, spec §4a)
- [ ] `packages/policy/src/evaluate-path-read.ts` (spec §4)
- [ ] `packages/policy/src/redaction-patterns.ts` (baseline table + Zod, spec §5a)
- [ ] `packages/policy/src/redact.ts` (spec §5)

(One responsibility per file, ≤300 LOC each — `CLAUDE.md` §8.)

### Tests (failing-first)

- [ ] `packages/policy/test/dependency-graph.test.ts` (spec §1 — cycle guard)
- [ ] `packages/policy/test/deny-code.test-d.ts` (spec §6 — tuple pin)
- [ ] `packages/policy/test/deny-code.test.ts` (spec §6 — runtime drift guard)
- [ ] `packages/policy/test/evaluate-command.test.ts` (spec §3, §8.1–§8.3)
- [ ] `packages/policy/test/evaluate-path-read.test.ts` (spec §4, §8.4)
- [ ] `packages/policy/test/redact.test.ts` (per-pattern + 3 negatives, spec §5/§8.5)
- [ ] `packages/policy/test/redact.property.test.ts` (fast-check, spec §5/§8.5)

No `pnpm-workspace.yaml` edit. No root config edit (turbo
auto-discovers via glob — spec §7).

---

## Tasks

### Task 1 — Scaffold the package (no logic)

- [ ] Copy `packages/shared/{tsconfig.json,tsconfig.test.json,tsconfig.test-d.json,tsup.config.ts,vitest.config.ts}` verbatim into `packages/policy/`.
- [ ] Write `packages/policy/package.json` per spec §7: name `@megasaver/policy`, deps `{ "@megasaver/shared": "workspace:*", "zod": "^3.24.1" }`, devDeps `{ "@types/node": "^22.19.17", "fast-check": "^3.23.2" }`.
- [ ] Write `src/index.ts` re-exporting only: `policyDenyCodeSchema`, `PolicyDenyCode`, `evaluateCommand`, `EvaluateCommandInput`, `EvaluateCommandResult`, `evaluatePathRead`, `EvaluatePathReadInput`, `EvaluatePathReadResult`, `redact`, `RedactResult`.
- [ ] Run `pnpm install` from the worktree root so the `workspace:*` link resolves.
- [ ] verify: `pnpm --filter @megasaver/policy build` emits `dist/` (will fail until src modules exist — expected; scaffold complete when install resolves and tsup is invocable).

### Task 2 — Closed enum + dependency-graph guard (TDD)

- [ ] Write FAILING `test/deny-code.test-d.ts` mirroring `packages/shared/test/token-saver-mode.test-d.ts`: 6-member assignability, `@ts-expect-error` non-member, `as string` rejection, `.options` spread, exact alphabetic readonly tuple (spec §6).
- [ ] Write FAILING `test/deny-code.test.ts`: `expect(policyDenyCodeSchema.options).toEqual([...6 alphabetic members...])`.
- [ ] Write FAILING `test/dependency-graph.test.ts`: read this package's `package.json`, assert every `dependencies` key ∈ `["@megasaver/shared", "zod"]` (spec §1).
- [ ] Implement `src/deny-code.ts` (alphabetic enum + WHY comment per spec §2).
- [ ] verify: `pnpm --filter @megasaver/policy test` — deny-code + dep-graph green.

### Task 3 — evaluateCommand (TDD)

- [ ] Write FAILING `test/evaluate-command.test.ts` covering, in spec §3 decision order:
  - re-entry: `MEGASAVER_ORIGIN_PID = String(process.pid + 1)` → `recursive_megasaver`; `= String(process.pid)` → not denied for that reason; absent/empty → skipped.
  - dangerous: each of the 8 `DANGEROUS_PATTERNS` denied with `dangerous_pattern`, including dangerous use of an allow-listed binary (e.g. `node` rendered line piping to `sh`) and `bash -c "rm -rf /"` via full-line render.
  - allow-list: non-member → `command_not_allowed`; each pattern checked against `[command, ...args].join(" ")`.
  - allow: a clean allow-listed command (e.g. `ls -la`) → `{ allowed: true }`.
- [ ] Implement `src/allowed-commands.ts` (25-member alphabetic readonly, spec §3a), `src/dangerous-patterns.ts` (8 regexes, spec §3b), `src/evaluate-command.ts` (decision order spec §3, reads `process.pid`).
- [ ] verify: `pnpm --filter @megasaver/policy test test/evaluate-command.test.ts` green.

### Task 4 — evaluatePathRead (TDD)

- [ ] Write FAILING `test/evaluate-path-read.test.ts`:
  - each of the 15 §4a denylist patterns denied with `secret_path_read` (incl. case-insensitive and `\`-separator variants).
  - a benign project-relative path (e.g. `src/index.ts`) → `{ allowed: true }`.
  - assert `path_denied` is NEVER emitted by this function (spec §4b).
- [ ] Implement `src/secret-paths.ts` (15-pattern denylist + internal glob→regex helper, NOT exported, spec §4a) and `src/evaluate-path-read.ts` (normalise + match, spec §4).
- [ ] verify: `pnpm --filter @megasaver/policy test test/evaluate-path-read.test.ts` green.

### Task 5 — redact (TDD)

- [ ] Write FAILING `test/redact.test.ts`: one positive per baseline pattern name (spec §5a — 10 names) asserting the secret is replaced and `count` increments; three negatives that look secret-shaped but must NOT redact (e.g. "bearer" as a noun in prose); `{ redacted: "", count: 0 }` for secret-free input.
- [ ] Write FAILING `test/redact.property.test.ts` (fast-check): generated secret-shaped inputs → no recognised pattern survives `redact()` (spec §5/§8.5).
- [ ] Implement `src/redaction-patterns.ts` (10-entry baseline, Zod-validated at load, `anthropic_key` ordered before `openai_key`, `g` flag where needed — spec §5a) and `src/redact.ts` (apply patterns, accumulate `count`, spec §5).
- [ ] verify: `pnpm --filter @megasaver/policy test test/redact.test.ts test/redact.property.test.ts` green.

### Task 6 — Full verify gate

- [ ] verify: `pnpm verify` from the worktree root (lint + typecheck + test, whole monorepo) — honest passing output, no `--no-verify`, no skips (spec §8.8).
- [ ] Confirm acceptance §8.1–§8.8 all satisfied.
- [ ] Add a changeset (`@megasaver/policy` new public API — `CLAUDE.md` §9 item 9).
- [ ] Confirm zero pending checkbox items in this plan.

### Task 7 — Review + commit

- [ ] `architect` design review + `critic` adversarial review (HIGH risk, `CLAUDE.md` §12) — author ≠ reviewer (§9 item 6).
- [ ] Address review feedback via `superpowers:receiving-code-review`.
- [ ] Commit (Conventional Commits, ≤50 char subject, `CLAUDE.md` §10). Suggested sequence:
  1. `feat(policy): scaffold @megasaver/policy package`
  2. `feat(policy): add PolicyDenyCode closed enum + dep guard`
  3. `feat(policy): add evaluateCommand gate`
  4. `feat(policy): add evaluatePathRead secret-path gate`
  5. `feat(policy): add redact + baseline redaction patterns`

---

## Verification matrix (spec §8)

| Acceptance | Verified by |
|------------|-------------|
| §8.1 dangerous patterns denied | `test/evaluate-command.test.ts` |
| §8.2 origin-pid re-entry guard | `test/evaluate-command.test.ts` |
| §8.3 allow-list deny/allow | `test/evaluate-command.test.ts` |
| §8.4 secret-path denylist | `test/evaluate-path-read.test.ts` |
| §8.5 redaction (10 patterns + 3 neg) | `test/redact.test.ts` + `test/redact.property.test.ts` |
| §8.6 deny-code tuple pin | `test/deny-code.test-d.ts` + `test/deny-code.test.ts` |
| §8.7 dependency allow-list | `test/dependency-graph.test.ts` |
| §8.8 monorepo verify green | `pnpm verify` (worktree root) |

---

## Risk notes

- HIGH: deny-lists are the security contract. Do NOT add
  defensive impossible-case branches (`CLAUDE.md` §13); validate
  the redaction table at the boundary with Zod and trust internal
  paths.
- `dangerous_pattern` MUST run before the allow-list (spec §3) —
  a regression here lets an allow-listed binary run a dangerous
  pipeline. Covered by the "dangerous use of allow-listed binary"
  case in Task 3.
- The `intent_missing` and `path_denied` enum members have no
  producer in BB3 (spec §2a, §4b). Do NOT invent code paths to
  emit them; they are pinned for downstream consumers.
- No `process.pid` DI seam — tests use `process.pid ± 1` for
  deterministic mismatch (spec §3).
