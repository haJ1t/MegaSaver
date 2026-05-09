---
title: AA4 — wiki/entities/cli.md schema-derived surface table — Plan
date: 2026-05-10
spec: docs/superpowers/specs/2026-05-10-aa4-wiki-cli-surfaces-design.md
risk: LOW
---

# AA4 — Plan

## Steps

### 1. Add "Closed-set surface derivation" section to `wiki/entities/cli.md`

Insert between "Boundary rules" and "Risk" sections. Content per spec:
table of 4 closed-sets + narrative (auto-update promise, comment
removal, `toBe` drift-guard pattern).

Commit: `docs(wiki): document schema-derived surfaces (AA4)`

### 2. DoD gate — `pnpm verify`

Run from worktree root. Must be GREEN.

### 3. Manual sanity

```bash
grep -n "Closed-set surface derivation" wiki/entities/cli.md
grep -n "agentIdSchema\|riskLevelSchema\|memoryScopeSchema\|KNOWN_TARGETS" wiki/entities/cli.md
```

All 4 closed-sets must appear.

### 4. Push + PR

```bash
git push -u origin feat/aa4-wiki-cli-surfaces
gh pr create ...
```

SendMessage team-lead with PR URL.
