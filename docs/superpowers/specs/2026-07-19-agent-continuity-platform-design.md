---
title: Agent Continuity Platform — long-horizon product design
status: user-approved strategy; not an implementation authorization
risk: strategic portfolio — every delivery slice is separately classified
created: 2026-07-19
sources:
  - wiki/syntheses/solo-developer-roadmap.md
  - wiki/syntheses/gtm-plan-2026-07.md
  - wiki/syntheses/saver-cache-churn.md
  - https://survey.stackoverflow.co/2025/ai
  - https://docs.github.com/en/copilot/reference/custom-instructions-support
  - https://docs.cursor.com/context/rules
  - https://arxiv.org/abs/2605.11032
  - https://arxiv.org/abs/2606.24775
---

# Agent Continuity Platform — long-horizon product design

## 1. Decision

MegaSaver is **developer-first now** and an **agent-agnostic continuity layer
over time**. Its initial paying user is the individual developer who works with
coding agents every day. Its destination is a user-owned layer that carries
trusted work state across agent, model, repository, and device boundaries.

The category name used internally is **Agent Continuity Layer**. It is not a
generic AI workspace, chat application, agent vendor, or a token-only utility.

The enduring user promise is:

> Your work, verified decisions, and learned safeguards stay with you—whatever
> agent, model, repository, or machine you use next.

The current tagline, “Less tokens. More signal. Same or better agent
performance,” remains a measurable benefit. It is not the whole category
claim: cost savings must never be stated when provider cache behavior makes
them unproven.

## 2. Why this path

Three paths were considered:

| Path | Benefit | Failure mode | Decision |
|---|---|---|---|
| Stay a developer-only utility | Focused early product | Limits the durable platform and lets native memory commoditize the feature | Rejected as destination |
| Serve every AI user immediately | Large theoretical market | Generic positioning, weak first-use value, unfocused build | Rejected now |
| Start with daily developers; build portable, agent-neutral primitives | Clear wedge plus future market expansion | Requires ruthless sequencing and privacy discipline | **Chosen** |

This is a credible wedge, not a small market: developers are actively mixing AI
tools rather than committing to a single platform, while confidence in AI
output remains low. MegaSaver must therefore own the cross-tool continuity and
evidence problem, not compete on model intelligence. (source: [Stack Overflow
Developer Survey 2025](https://survey.stackoverflow.co/2025/), [GitHub custom
instruction support](https://docs.github.com/en/copilot/reference/custom-instructions-support),
[Cursor rules and memories](https://docs.cursor.com/context/rules))

## 3. The product system

MegaSaver earns a place in a daily workflow only when all five layers work
together:

1. **Continuity** — portable, bounded handoffs and durable project knowledge
   let a task resume correctly on another agent, branch, or machine.
2. **Truth** — source, freshness, lineage, conflict, and validation status are
   visible. A memory is never silently treated as fact.
3. **Control** — the user owns the brain, controls sync and sharing, and can
   inspect, repair, export, revoke, or forget it.
4. **Economics** — context, time, rate-limit, and spend effects are measured
   honestly and in a provider-cache-aware way.
5. **Ecosystem** — reusable, inspectable packs and a stable interchange format
   allow community value without turning private work into platform data.

The moat is the combination: an encrypted user-owned brain, evidence-backed
state evolution, cross-agent adapters, and a compatible ecosystem. No single
memory store, compressor, or dashboard is enough.

## 4. Non-negotiable design rules

- Core stays agent-agnostic; every vendor surface remains a thin connector.
- Memory has provenance, scope, confidence, timestamp, and expiry. Untrusted
  imports are parsed and guarded before they can affect an agent.
- Local-first and encrypted user-controlled sync remain defaults. Aggregated
  learning is strictly opt-in, privacy-reviewed, and never required for value.
- A provider-native cache is a constraint, not an obstacle to conceal. Product
  copy uses measured end-to-end cost and quality outcomes only.
- Cross-agent transfer is explicit, destination-bounded, redaction-first,
  expiry-bound, and reversible. It never auto-launches another agent.
- Open interchange increases adoption; paid value comes from trusted operation,
  sync, safeguards, evaluation, and convenience—not locking up a user’s work.

## 5. Four horizons

### Horizon 1 — the indispensable personal developer brain (now → retained use)

Package the shipped Experience Layer as one observable daily outcome. Complete
the already-sequenced Agent Passport / Hot Handoff, Brain Doctor, Context
Contracts, and conservative Déjà Vu work. The point is not more features: it
is that an activated developer demonstrably starts better, repeats fewer known
mistakes, and can continue work without re-explaining it.

### Horizon 2 — portable work state (after the personal loop is proven)

Evolve `.megabrain` and `.megahandoff` into an openly documented, versioned
interchange contract with scoped capability, provenance, expiry, and
injection-resistant rehydration. Do not declare a new industry standard before
real cross-agent use proves the contract. Recent work on portable agent memory
supports this as a promising direction, not as sufficient validation. (source:
[Portable Agent Memory](https://arxiv.org/abs/2605.11032))

### Horizon 3 — trusted ecosystem (after portability is reliable)

Launch signed and inspectable starter brains, skill packs, and framework
playbooks. The marketplace distributes repeatable expertise; it must not
receive users’ private session data. A public MegaSaver Index can compare
context-quality and compatibility only with reproducible, consented fixtures.

### Horizon 4 — the professional-agent continuity layer (only after the
developer wedge compounds)

Apply the same primitives to adjacent professional agents—security, data,
design, research, and operations—through vertical adapters and packs. Do not
build generic collaboration software first. Teams and enterprises become a
distribution and governance layer after individual pull is proven, not the
reason to compromise the personal product.

## 6. Sequencing, gates, and measures

The next committed feature order remains unchanged: **Agent Passport → Brain
Doctor → Context Contracts → Déjà Vu**. Hot Handoff already has its own
HIGH-risk design and must not be redesigned in this document.

| Gate | Measure | Required result before the next expansion |
|---|---|---|
| Personal value | An activated developer reaches a successful, explainable continuity moment in under 10 minutes | Measured in production onboarding; no hidden configuration required |
| Daily trust | Fourth-week retention and weekly brain-health engagement improve against the pre-Experience-Layer baseline | Define the numeric threshold from the first stable instrumentation cohort; do not invent a vanity target |
| Transfer safety | Valid agent-to-agent handoff completion, secret/path exclusion, expiry rejection, and no auto-launch | 100% automated safety fixtures pass; successful handoff rate is reported honestly |
| Context quality | Contract fixtures detect a stale/missing required fact and pass after an auditable repair | Every contract failure names its evidence and repair path |
| Platform readiness | At least two independent agent connectors and real user cross-agent use validate the interchange format | Only then version and invite outside implementers |
| Global scale | Activated, retained developer cohorts grow through self-serve installation, localized onboarding, and shareable proof | Million-user goals are pursued through retention and referral, not paid acquisition alone |

The north-star behavior is **weekly active developers who complete a verified
continuity moment**, rather than installed CLIs, stored memories, or claimed
tokens saved.

The scale checkpoints are deliberately ambitious but are not revenue
forecasts: **100,000 MAU** proves repeatable self-serve adoption, **1 million
MAU** proves global distribution, and **5 million MAU** establishes category
leadership. Each checkpoint is valid only when retained-use and safety gates
continue to pass; acquisition cannot compensate for a failing personal loop.

## 7. Distribution and business model

Keep a generous open local core so a developer can prove value privately.
Personal Pro monetizes continuity across devices/agents, advanced health and
contract workflows, and premium packs. Expansion should be self-propagating:
handoffs, starter packs, public compatibility fixtures, honest before/after
reports, and localized onboarding create reasons to invite the next developer.

Team, compliance, and manager reporting remain later extensions. They must
inherit the user-owned evidence model, never turn MegaSaver into surveillance
software.

## 8. Risks and safeguards

| Risk | Safeguard and rollback rule |
|---|---|
| Native vendors add memory | Compete on portability, evidence, and user ownership; keep adapters replaceable |
| Private data or prompt injection crosses an agent boundary | Treat every import as untrusted; redaction-first, explicit destination, expiry, parse-on-handoff, and per-slice security review |
| “Savings” claims are false because of caching or variance | Cache-aware measurement gates; remove or correct claims when benchmark evidence fails |
| Marketplace becomes a prompt-injection channel | Signed provenance, readable manifests, scoped capabilities, review/quarantine, and user confirmation before install |
| “Everyone” expansion dilutes the developer product | No new vertical before the platform-readiness gate; separate spec and owner for every vertical |
| Cloud/data-network pressure undermines trust | Local-first operation remains complete; telemetry is minimized, consented, and independently auditable |

## 9. Delivery artifacts and ownership

This design changes strategy only. It authorizes no product code.

| Artifact | Purpose | Owner / condition |
|---|---|---|
| `wiki/syntheses/global-agent-continuity-strategy.md` | Durable decision, horizons, and guardrails | Created with this design |
| `wiki/syntheses/solo-developer-roadmap.md` | Near-term execution sequence | Remains the active delivery source |
| `docs/superpowers/specs/2026-07-18-hot-handoff-design.md` | First HIGH-risk continuity slice | Existing owner; no overlap |
| Future scoped specs | Brain Doctor, Context Contracts, Déjà Vu, interchange contract, packs, and vertical adapters | One approved spec and plan per slice |

Before any slice is implemented: classify its risk, create an isolated
worktree when required, use TDD, run the stated verification gate, and obtain
an independent reviewer pass. A strategic reversal is safe: stop future
expansion, retain the local core and portable exports, and do not delete or
strand user data.
