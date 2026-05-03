# Skill Routing

How Claude Code adapts to context. The rules below are non-negotiable.

## superpowers — every feature

See `process-discipline.md`. Mandatory chain on every feature.
Conditional set as listed.

## Design skills (GUI phase, v0.3+)

Mega Saver MVP is headless. Design skills activate when GUI work begins.

| Trigger / Phase                          | Skill                          |
|------------------------------------------|--------------------------------|
| New screen/component CONCEPT exploration | `huashu-design`                |
|   (no code yet, exploring variants)      |   (HTML hi-fi + critique)      |
| Concept locked → real frontend impl      | `taste-skill` OR `gpt-tasteskill` |
| Existing UI audit / polish / redesign    | `impeccable`                   |
| Style direction (theme/palette/typo)     | `ui-ux-pro-max` OR style packs |
|                                          |   (`minimalist`/`soft`/`brutalist`) |
| Accessibility pass                       | `design:accessibility-review`  |
| Pre-merge design critique                | `design:design-critique`       |
| Design system docs                       | `design:design-system`         |
| UX copy (microcopy/error/empty)          | `design:ux-copy`               |
| Visual reference generation              | `imagegen-frontend-web`        |

`taste-skill` vs `gpt-tasteskill`:

- engineering-heavy / metric-driven   → `taste-skill`
- editorial / motion / hero pages     → `gpt-tasteskill`
- if unsure                           → `taste-skill` default

## OMC — agent delegation

Skills:

- `omc:plan` — strategic planning, optional interview.
- `omc:ultrawork` — parallel high-throughput.
- `omc:ralph` — self-referential loop until complete.
- `omc:team` — N agents on shared list.
- `omc:debug` — session/repo state diagnose.
- `omc:trace` — evidence-driven causal tracing.
- `omc:verify` — verifier pass (process-discipline step 4).
- `omc:deepinit` — codebase docs (one-time after first feature).
- `omc:wiki` — persistent knowledge wiki.
- `omc:autopilot` — full autonomous (avoid until v0.2).

Agents (via Agent tool):

- `executor` — implementation.
- `planner` / `architect` — design, trade-offs (Opus).
- `explore` — codebase search.
- `code-reviewer` — pre-merge review.
- `critic` — adversarial review.
- `debugger` — root cause.
- `verifier` — completion check.
- `writer` — docs/comments.
- `document-specialist` — external SDK/API docs.
- `security-reviewer` — OWASP/secrets pass.

## claude-api skill

If Mega Saver Core calls the Anthropic API directly (e.g., native
LLM-powered compression or summarization), the `claude-api` skill
auto-triggers. It enforces:

- Prompt caching always on.
- Latest model defaults
  (`claude-opus-4-7` / `claude-sonnet-4-6` / `claude-haiku-4-5`).
- Streaming where applicable.

Mega Saver does NOT proxy or relay user prompts to LLMs by default.
Direct API use is opt-in per feature and must be flagged in the
feature spec along with cost and privacy notes.
