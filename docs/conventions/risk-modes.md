# Risk-Aware Development Modes

Mega Saver's product has a Risk Detector. We dogfood it on
ourselves: every feature has an implicit risk level that
determines which skills are mandatory and which compression
intensity is allowed.

## Risk levels

### LOW

- Examples: README edit, comment polish, CLI help-text tweak,
  internal log message, dev-only logging.
- Mandatory: brainstorming + verification (lite).
- Optional: full superpowers chain.
- OK to skip: TDD when no logic.
- Skill mode: aggressive compression allowed in research.

### MEDIUM

- Examples: normal feature add, refactor, bug fix in non-critical
  module, dev tooling, build script.
- Mandatory: full superpowers chain (`process-discipline.md`).
- Required reviewer: `code-reviewer`.
- Skill mode: balanced compression.

### HIGH

- Examples: token audit logic, context packer, evidence-preserving
  compression, memory schema change, session storage format,
  connector core path, public CLI flags, anything touching user
  files at scale.
- Mandatory: full chain + `omc:architect` for design
  + `omc:critic` adversarial review + worktree (no `main` edits).
- Required reviewer: `code-reviewer` AND `critic` (separate
  passes).
- Skill mode: evidence-preserving only. No aggressive compression.

### CRITICAL

- Examples: cryptographic ops, anything that deletes user data,
  anything that mutates user repos beyond known ignore patterns,
  license / permission code, production incident response.
- Mandatory: HIGH chain + `omc:tracer` evidence loop
  + `omc:security-reviewer` + verifier with reproduction evidence
  + manual user confirmation in spec.
- Forbidden: `autopilot`, `ralph`, or any unsupervised loop.
- Skill mode: debug + evidence only. No log compression.

## Risk assignment

- Spec author assigns risk in spec frontmatter.
- Reviewer may upgrade. Never silently downgrade.
- If unclear, default MEDIUM.

## Anti-cheat

- Risk level cannot be lowered to skip a skill.
- Wanting to lower the risk is a signal to keep the skill.
