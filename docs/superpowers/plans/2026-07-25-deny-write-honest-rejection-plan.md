---
title: Plan — reject `deny.write` instead of silently ignoring it
spec: docs/superpowers/specs/2026-07-25-deny-write-honest-rejection-design.md
risk: CRITICAL
created: 2026-07-25
---

# Plan — reject `deny.write`

## Task 1 — RED: policy parser tests

`packages/policy/test/parse-project-permissions.test.ts`

- Delete the three `denyWritePatterns` assertions (lines 10, 21, 28);
  the field no longer exists, so they become type errors.
- Change the valid-shape fixture to drop `write: ["dist/**"]`.
- Add a `deny.write` rejection block:
  - non-empty list ⇒ `PolicyLoadError`, message matches `/deny\.write/`
    and `/not enforced/`.
  - empty list `[]` ⇒ rejected (presence, not content, is the signal).
  - null value (`write:` with no value in YAML) ⇒ rejected.
  - error carries the zod `cause`.
- Add a message-split guard: an unrelated bad shape
  (`{ deny: { execute: [...] } }`) still throws exactly
  `invalid project permissions` — proves the named message did not
  widen to every failure.

**Verify:** `pnpm --filter @megasaver/policy test` fails on the new
cases (and the deleted assertions no longer compile).

## Task 2 — GREEN: parser

`packages/policy/src/parse-project-permissions.ts`

- `write: globs.default([])` → `write: z.never().optional()`, with a
  WHY comment (spec §3.1) naming the missing call site.
- Drop `denyWritePatterns` from `ProjectPermissions` and from the
  returned object.
- Export a `DENY_WRITE_MESSAGE` const (module-local) and select it in
  the failure branch by zod issue path `["deny", "write"]` (spec §3.2).
- Update the file's header comment: the tighten-only note still holds,
  but `write` is no longer a compiled field.

**Verify:** policy tests green; `pnpm --filter @megasaver/policy typecheck`.

## Task 3 — context-gate end-to-end

`packages/context-gate/test/load-project-permissions.test.ts`

- Remove the `denyWritePatterns` assertion (line 47).
- Add: a real `permissions.yaml` on disk declaring `deny.write` ⇒
  `PolicyLoadError` with the named message — proves the message
  survives the fs + yaml layer to the caller that builds `detail`.

**Verify:** `pnpm --filter @megasaver/context-gate test`.

## Task 4 — docs + release

- `.changeset/deny-write-rejected.md` — **major** for
  `@megasaver/policy`; state the config break, the migration (delete
  the key), and that no protection is lost.
- Amend permissions-yaml spec §5.4: the no-op is closed, point at the
  new spec.
- `wiki/entities/policy.md` — new dated section.
- `wiki/log.md` — timestamped entry.
- `README.md` — the `permissions.yaml` line gains the enforced-key
  list, so the operator-facing doc stops being silent about it.

**Verify:** `pnpm conventions:check` untouched (no `docs/conventions/`
edit); `pnpm verify` green.

## Task 5 — review gates (CRITICAL tier, §12)

`code-reviewer` + `critic` + `security-reviewer`, fresh context,
dispatched in parallel. Then verifier evidence.

**Verify:** `pnpm verify` output captured; reviewer verdicts recorded.
