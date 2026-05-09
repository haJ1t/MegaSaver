---
title: Y3 — Multi-Agent Dogfood docs drift fix — Plan
date: 2026-05-09
spec: docs/superpowers/specs/2026-05-09-y3-docs-drift-design.md
risk: LOW
---

# Y3 — Plan

## Steps

### 1. Create `docs/conventions/multi-agent-dogfood.md`

New source-of-truth file for §7 content. Lists 4 file scopes.
Commit: `docs(conventions): add multi-agent-dogfood source`

### 2. Update `CLAUDE.md`

- Header callout: add CONVENTIONS.md/Aider to the mirror list.
- §7 "File scopes": add 4th bullet for CONVENTIONS.md.
- §7: add "Source: docs/conventions/multi-agent-dogfood.md" pointer.
- §7 opening prose: change "all three agent files" → "all four agent files".

Commit: `docs(claude-md): list 4 agent file scopes`

### 3. Update `AGENTS.md`

Add a "Multi-Agent Dogfood" section mirroring the 4-file scope list.

Commit: `docs(agents-md): sync 4 agent file scopes`

### 4. Update `.cursor/rules/mega-context.mdc`

Add a "Agent file scopes" note enumerating all 4 targets.

Commit: `docs(cursor): enumerate 4 agent file scopes`

### 5. DoD gate — `pnpm verify`

Run from worktree root. Must be GREEN.

### 6. Manual sanity

```bash
grep -n "File scopes" CLAUDE.md AGENTS.md
grep -n "CONVENTIONS.md" CLAUDE.md AGENTS.md .cursor/rules/mega-context.mdc docs/conventions/multi-agent-dogfood.md
```

All four files must mention CONVENTIONS.md.

### 7. Push + PR

```bash
git push -u origin feat/y3-docs-drift
gh pr create ...
```

SendMessage team-lead with PR URL.
