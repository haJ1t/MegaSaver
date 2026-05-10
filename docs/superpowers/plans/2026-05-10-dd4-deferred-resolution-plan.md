# DD4 — Deferred Items Resolution Plan

**Date:** 2026-05-10
**Risk:** LOW
**Batch:** DD4 (deferred backlog closure)
**Branch:** `feat/dd4-deferred-resolution`

## Items

### S8 — `--target` help-text divergence (filter ≠ seed)

**Status: CLOSED** (by AA2, PR #25, `a8fb044`)

**Finding:** Both `connectorSyncCommand` and `connectorStatusCommand` `--target`
descriptions were updated by AA2 to derive the enum list from
`KNOWN_TARGET_IDS.join(" | ")`. The action phrases correctly differ:

- `sync --target`: `"...to seed when its file does not exist."` — accurate.
  The sync loop iterates ALL `KNOWN_TARGETS`; `targetFlag` only suppresses the
  skip-when-missing guard for the named target. Other targets still run for
  existing files. "seed when its file does not exist" is precise.
- `status --target`: `"...to filter the report."` — accurate.
  The status loop filters `KNOWN_TARGETS.filter((t) => t.id === input.targetFlag)`
  so only the named target is inspected. "filter the report" is precise.

No code change required. S8 is closed post-AA2.

**Files touched:** `wiki/log.md`, `wiki/index.md` (closure note only)

---

### W7 — `Intl.Segmenter` grapheme-aware truncation

**Status: CLOSED as WONT-DO (v0.1)**

**Decision (locked by user):** codepoint-only truncation accepted for v0.1.
`Intl.Segmenter` for grapheme-aware splitting is deferred. Real-world impact
is low (edge case: emoji or combining diacritic content in memory entries).

**Code change:** one-line WHY comment in `truncate()` inside
`apps/cli/src/commands/memory/shared.ts`.

**Files touched:** `apps/cli/src/commands/memory/shared.ts`, `wiki/log.md`,
`wiki/index.md`

---

### T6 — sync error line `session=<id|none>` suffix

**Status: STILL DEFERRED** (owned by `--json` write-side batch)

**Decision:** T6 is not implemented here. It remains bundled with the future
`--json` write-side batch (session create/end/update, memory create, connector
sync). Adding `session=<id|none>` to sync error lines requires understanding
the full `--json` output contract before locking the text format.

**Files touched:** `wiki/log.md`, `wiki/index.md` (deferral note only)

---

## Verification

- `pnpm verify` must pass green (lint + typecheck + test).
- No new tests required (W7 comment is WHY-only; S8 + T6 are doc-only).
