# Reserve ledger keyword namespace — Implementation Plan

**Goal:** Close the denial-of-capture vector where an agent plants a `from-session:`
ledger keyword via an agent-facing surface to suppress a legitimate autopilot /
from-session capture. Reserve the namespace: only internal ledger writers may place
it; every non-internal keyword boundary strips it.

**Architecture:** Two core helpers (`isReservedKeyword`, `stripReservedKeywords`)
beside `DEDUPE_KEYWORD_PREFIX`. Four boundaries route external keyword data through
them: save_memory (MCP), memory create (CLI), brain import (core), memory update
(CLI — preserves existing reserved keywords + strips reserved from user input).
Internal writers (from-session, autopilot) bypass the boundaries and are untouched;
the shared ledger keeps deduping. Spec: `docs/superpowers/specs/2026-07-17-reserve-ledger-keyword-design.md`.

**Risk:** MEDIUM (denial-only, agent-facing, connector core path). Net = existing
suites unmodified + new boundary/regression tests.

---

### Task 1: core helpers (TDD)
- `packages/core/test/session-memory.test.ts` (extend): `isReservedKeyword("from-session:x")` true; `isReservedKeyword("x")` false; `stripReservedKeywords(["a","from-session:x","b"])` → `["a","b"]`; `[]` → `[]`; no-reserved unchanged.
- RED → add both exports to `session-memory.ts` beside `dedupeKeywordFor` → GREEN. `pnpm build`.

### Task 2: end-to-end regression (TDD, written first — the reproduction)
- A test that seeds a genuinely cross-session-recurring failure, has an agent plant the forged `from-session:<failureId>:<contentHash>` keyword via `save_memory` (MCP tool), then runs autopilot and asserts the lesson IS captured (staged/approved ≥1, not `skippedExisting`). Against current code this FAILS (forged keyword lands, suppresses). Keep it red until Task 3.

### Task 3: boundaries strip reserved keywords
- `save-memory.ts:136` → `keywords: stripReservedKeywords(d.keywords ?? [])`.
- `create.ts:172` → `stripReservedKeywords(toStringArray(input.keywordFlags))`.
- `brain-import.ts:~50` → strip reserved from each imported memory's keywords before `createMemoryEntry`.
- `update.ts:155` → `patch.keywords = [...existing.keywords.filter(isReservedKeyword), ...stripReservedKeywords(userKeywords)]` (read the resolved existing entry; preserve its reserved keywords).
- Per-boundary tests on real stored rows: input `["from-session:forged","real"]` → stored keywords exclude the forged one, `"real"` survives; update on a real from-session row preserves its ledger keyword AND strips a forged add.
- Task 2's regression flips GREEN.
- `pnpm build`; existing save-memory / memory-create / memory-update / brain-import / autopilot suites GREEN unmodified.

### Task 4: verify + changeset + review
- `pnpm verify` green.
- `.changeset/reserve-ledger-keyword.md` — core minor (new exports), mcp-bridge + cli patch.
- Fresh code-reviewer AND critic on the full diff: no internal writer caught by the strip; shared ledger still dedupes (no duplicate-capture regression); all four boundaries covered; update preserves existing reserved keywords; the regression test genuinely reproduces then closes the suppression.
