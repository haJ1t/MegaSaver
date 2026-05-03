---
title: Risk-Aware Development
tags: [concept, process, dogfood]
sources: [raw/mega-saver-platform-fikri.txt, docs/superpowers/specs/2026-05-03-mega-saver-bootstrap-design.md]
status: active
created: 2026-05-03
updated: 2026-05-03
---

# Risk-Aware Development

Mega Saver's product has a Risk Detector (fikri §9) that picks the right compression / discipline for each task. We **dogfood** the same idea on ourselves: every feature carries an implicit risk level that gates which skills are mandatory.

## The four levels

### LOW

- Examples: README edit, comment polish, CLI help-text tweak, internal log message, dev-only logging.
- Mandatory: brainstorming + light verification.
- Optional: full superpowers chain.
- OK to skip: TDD when no logic.
- Skill mode: aggressive compression allowed.

### MEDIUM (default)

- Examples: normal feature add, refactor, bug fix in non-critical module, dev tooling, build script.
- Mandatory: full [[concepts/superpowers-discipline]] chain.
- Required reviewer: `code-reviewer`.
- Skill mode: balanced compression.

### HIGH

- Examples: token audit logic, context packer, evidence-preserving compression, memory schema change, session storage format, connector core path, public CLI flags, anything touching user files at scale.
- Mandatory: full chain + `omc:architect` for design + `omc:critic` adversarial review + worktree (no `main` edits).
- Required reviewer: `code-reviewer` AND `critic` (separate passes).
- Skill mode: evidence-preserving only. **No** aggressive compression.

### CRITICAL

- Examples: cryptographic ops, anything that deletes user data, anything that mutates user repos beyond known ignore patterns, license/permission code, production incident response.
- Mandatory: HIGH chain + `omc:tracer` evidence loop + `omc:security-reviewer` + verifier with reproduction evidence + manual user confirmation in spec.
- **Forbidden:** `autopilot`, `ralph`, any unsupervised loop.
- Skill mode: debug + evidence only. **No** log compression.

## Risk assignment rules

- The spec author writes the level into the spec frontmatter (`risk: medium`).
- A reviewer may **upgrade** the risk. They may **never silently downgrade**.
- If unclear, default MEDIUM.

## Anti-cheat

> Risk level cannot be lowered to skip a skill.
> Wanting to lower the risk is a signal to keep the skill.

This rule is in [[sources/spec-bootstrap]] §12 and replicated into the bootstrap CLAUDE.md §12 / `docs/conventions/risk-modes.md`.

## Why this dogfood matters

Mega Saver's product promises risk-aware compression to its users. If the product itself were built without risk-aware discipline, the team would not catch the gap between "evidence-preserving compression works" and "evidence-preserving compression works under HIGH risk." Dogfooding closes that gap.

## Related

- [[concepts/superpowers-discipline]]
- [[concepts/contextops]]
- [[decisions/bootstrap-matrix]] decision #5 (strict discipline)
