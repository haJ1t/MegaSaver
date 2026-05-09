---
title: Y3 — Multi-Agent Dogfood docs drift fix
date: 2026-05-09
risk: LOW
status: approved
---

# Y3 — Multi-Agent Dogfood docs drift fix

## Problem

PR #21 (aider connector target) added `CONVENTIONS.md` as the 4th
built-in connector output target. The multi-agent dogfood section
(`CLAUDE.md §7`, `AGENTS.md`, `.cursor/rules/*.mdc`) still enumerates
only 3 agent file scopes. The 4th target is undocumented.

## Decisions

**D1 — Scope: update `docs/conventions/` source file too.**
`CLAUDE.md §7` states its source of truth is `docs/conventions/*.md`.
`AGENTS.md` and `.cursor/rules/mega-conventions.mdc` both carry the
anti-pattern "no editing this file without also editing
`docs/conventions/`". Therefore a new
`docs/conventions/multi-agent-dogfood.md` must be created as the
canonical source for §7 content.

**D2 — `CONVENTIONS.md` is a connector OUTPUT, not a repo-tracked
governance file.**
`mega connector sync --target aider` writes `CONVENTIONS.md` into the
user's project root. It is not committed to the MegaSaver repo itself.
`CONVENTIONS.md` is NOT listed in §2 repo layout (it doesn't exist at
repo root). §7 lists it as a per-agent file scope target because that
is what the aider connector generates.

**D3 — `.cursor/rules/megasaver.mdc` is OUT OF SCOPE.**
That file is connector-managed (PR #17 cursor target). Manual edits
would be overwritten on `mega connector sync --target cursor`. Only
the static `.cursor/rules/*.mdc` files (mega-context, mega-conventions,
mega-discipline) are edited here.

**D4 — No §2 repo layout change needed.**
`CONVENTIONS.md` is not tracked in the repo; it is generated output.
§2 stays as-is.

## Files to change

1. `docs/conventions/multi-agent-dogfood.md` — CREATE (new source-of-truth)
2. `CLAUDE.md` — UPDATE §7 file scopes (3→4) + §7 source pointer + header callout
3. `AGENTS.md` — UPDATE to mirror 4-file scope
4. `.cursor/rules/mega-context.mdc` — UPDATE to enumerate 4 agent files

## Proposed §7 "File scopes" text

```markdown
**File scopes:**

- `CLAUDE.md` — full reference (this file). Used by Claude Code.
- `AGENTS.md` — Codex format. Slim mirror.
- `.cursor/rules/*.mdc` — modular, auto-loaded by Cursor on globs.
- `CONVENTIONS.md` — plain markdown, written by `mega connector sync
  --target aider`. Loaded by Aider via `--read CONVENTIONS.md` or
  `.aider.conf.yml`.
```

## Definition of Done

- `docs/conventions/multi-agent-dogfood.md` created with 4-file list.
- `CLAUDE.md §7` lists 4 file scopes; has source pointer to new file.
- `CLAUDE.md` header callout mentions CONVENTIONS.md/Aider.
- `AGENTS.md` mirrors the 4-file scope.
- `.cursor/rules/mega-context.mdc` enumerates all 4 targets.
- `pnpm verify` green (no code changes; lint/typecheck/test unaffected).
- Manual `grep` confirms no remaining "three agent files" or "3 agent
  files" language in root docs.
