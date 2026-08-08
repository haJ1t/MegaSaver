---
title: RTK vs Mega Saver — Competitive Analysis (2026-08-01)
tags: [competitive, rtk, token-saver, strategy, gap-analysis]
sources:
  - https://github.com/rtk-ai/rtk (README, docs/contributing/ARCHITECTURE.md)
  - https://blog.jetbrains.com/ai/2026/07/rtk-claude-code-token-savings/
  - syntheses/saver-cache-churn.md
  - syntheses/token-saver-root-cause-2026-07-28.md
  - syntheses/saver-root-cause-2026-07-28.md
  - docs/superpowers/specs/2026-07-19-net-positive-megasaver-design.md
  - docs/superpowers/specs/2026-07-28-saver-compression-integrity-design.md
  - docs/superpowers/plans/2026-07-31-saver-audit-fixes-plan.md
  - syntheses/proxy-first-party-cache-parity.md
status: active
created: 2026-08-01
updated: 2026-08-01
---

# RTK vs Mega Saver — Competitive Analysis

User ask (2026-08-01): deep analysis of RTK vs our saver — where we fall short
and what new ideas could put us ahead. Findings below; **no spec/plan yet**
(process-discipline gate: ideas need brainstorming → spec before code).

## 1. What RTK actually is

`rtk` (Rust Token Killer, rtk-ai/rtk, Apache-2.0): single Rust binary, <10ms
overhead, that proxies shell commands and compresses their stdout before the
agent reads it. ~100+ curated command filters (git, ls, grep, pytest, cargo,
npm, docker, kubectl, aws, gh…). Four filter strategies: smart filtering,
grouping, truncation, deduplication. A PreToolUse hook rewrites Bash commands
(`git status` → `rtk git status`) transparently for 15 agent tools. Ships
`rtk gain` analytics dashboard, `rtk discover` (missed-opportunity finder),
`rtk session` (adoption tracking), tee-to-file on failure for full-output
recovery, opt-in telemetry, Homebrew/curl/cargo install. (source:
github.com/rtk-ai/rtk README + ARCHITECTURE.md)

**Crucially: RTK is LOSSY compression.** Dropped content is gone unless tee
fired (failures only, by default). No recovery footer, no chunk store, no
integrity gate.

## 2. The external verdict — RTK does not actually save money either

> **Unverified external source (noted 2026-08-05).** Every figure in this
> section comes from one blog post and none has been checked against a primary
> artifact — no run log, no billing export, no reproduction. §6's strategic
> read and the ranking in
> [[syntheses/cache-write-cost-reduction-2026-08-01]] §4 both inherit these
> numbers. If they are wrong, two pages of strategy move with them. Treat as a
> lead, not as measurement; our own numbers in §4 are measured and cited.


JetBrains paired A/B benchmark (rtk v0.43.0, Claude Code 2.1.201,
claude-sonnet-5, SkillsBench 86 tasks, 425 billed trials, ~$320):

- Advertised 60–90%; measured **+7.6% MORE expensive** at low reasoning
  effort (p=0.004), ±0% at high effort. Quality unchanged.
- Ceiling math: the Bash hook sees only ~33% of Bash calls carrying ~20% of
  tool-result chars; squeezing that by 70% caps at **≈3% of input tokens**.
  Read/Grep/Glob bypass the hook entirely.
- `rtk gain` reported 96.2M tokens "saved" while the bill went UP — the
  scoreboard counts raw output as counterfactual even when the client would
  have truncated it, and prices everything as fresh input.
- Penalty mechanism: more hook rewrites → more turns (+13.8%) and cache
  reads (+14.3%) → thin systematic tax, no saving.
(source: blog.jetbrains.com/ai/2026/07/rtk-claude-code-token-savings)

**This is the same failure we measured on ourselves** (cache-churn 0.93–0.97x,
[[syntheses/saver-cache-churn]]): output compression alone has a ~3–10%
input ceiling while cache writes are 62–75% of baseline cost. The market's
leading competitor is publicly proven net-negative. That is our opening.

## 3. Where RTK beats us today (our gaps)

1. **Frictionless install.** `brew install rtk && rtk init -g` → done, one
   command per agent, 15 agents. Ours: npm install, hook install, daemon,
   workspace enable, GUI. Activation funnel is RTK's biggest structural win.
2. **Filter breadth.** 100+ hand-tuned command filters (aws/kubectl/docker/
   pulumi/gh/pnpm…) vs our ~dozen parsers (vitest/tsc/pytest/go/cargo/eslint
   + generic). Each filter is cheap to write; the matrix is a moat of volume.
3. **Zero-cache-tax write path.** RTK rewrites the COMMAND before execution —
   the compressed output is the only version that ever exists, so it cannot
   invalidate a cached turn. Our saver rewrites `tool_result` in place
   post-execution → the proven cache-churn tax (until first-sight lands).
4. **Perceived-honesty UX.** RTK's README openly admits bash-output ≠ bill,
   bytes/4 estimation, and the Read/Grep hook blind spot. Their docs say the
   quiet part; ours (pre-audit-fix) claimed "Nothing is lost…" where three of
   four paths were excerpts-only.
5. **Speed.** Single Rust binary, <10ms, no daemon, no node_modules.
6. **Always-on recovery on failure.** Tee saves full raw on any failing
   command by default — the exact "agent needs the one dropped line on a
   failing build" case.

## 4. Where we already beat RTK (defend and surface)

1. **Coverage.** We touch Read/Grep/Glob/Bash + MCP + proxy; RTK structurally
   cannot touch ~80% of tool-result bytes (JetBrains finding 1).
2. **Losslessness.** Chunk store + recovery footer + W4 integrity property
   test (reconstruct redacted raw from delivered ∪ chunks). RTK has none.
3. **Cost accounting.** Usage-ledger-based honest metrics
   ([[syntheses/proxy-first-party-cache-parity]], 1.30x measured cost win via
   first-party route); RTK's scoreboard is self-graded fiction (finding 5).
4. **Memory/continuity layer.** Living Brain, Warm Start, Mistake Firewall,
   Brain Sync, Handoff — RTK has nothing above the output layer.
5. **Everything our own audits already found and are fixing** (9 P1 defects,
   PR pending): safe-mode dead zone, tsc/go-test parsers, filenames
   corruption, negative-savings representation, debit-on-expand.

## 5. Ideas to leapfrog (all require spec+plan before code)

Ordered by leverage-per-effort against the proven cost decomposition
(turn count and cache stability are the levers; compression ratio is not):

1. **"Prove it" public benchmark.** Re-run the JetBrains ladder on ourselves
   post-audit-fix and publish the paired-bill table — the first token tool
   with a reproduced net-cost number. RTK cannot answer this; their ceiling
   is ~3%. Gate: benchmark infra + audit-fix merge.
2. **PreToolUse command-rewrite mode (RTK's mechanism, our integrity).**
   Rewrite Bash commands to `mega output exec <cmd>` BEFORE execution — the
   compressed form is the only version the client ever caches (zero churn,
   no first-sight ledger needed on this path), AND the raw lands in our chunk
   store with a recovery footer (lossless, which RTK isn't). Turns their best
   architectural idea into our best-possible saver path.
3. **Filter-matrix expansion with integrity gate.** Port the top-30 RTK
   command filters (git/docker/kubectl/aws/gh) into output-filter, each
   behind the W4 reconstruct-or-declare test. Cheap, incremental, closes the
   breadth gap without copying their lossiness.
4. **`mega discover` — missed-savings finder.** RTK's `discover` is a great
   adoption loop; ours can be honest: scan hook/usage logs, report commands
   that bypassed the saver with their MEASURED sizes (not invented
   counterfactuals).
5. **Turn-cutter warm start (already spec'd, Stage B).** Fewer exploration
   turns is the only lever that multiplies cache reads AND writes. RTK has
   nothing here and structurally can't — they have no repo index or memory.
6. **Cache-stable pack (already spec'd).** Byte-stable per-session context
   pack — the determinism invariant that RTK's per-command rewriting can't
   offer at the session level.
7. **Failure-tee parity.** Auto-persist full raw whenever a command exits
   non-zero, surfaced in the footer. We persist raw on the hook path already;
   extend to exec/read paths (part of W2/W3 anyway) and name it.
8. **Session-level savings story, not output-level.** Replace the headline
   "% of output compressed" with "session cost vs your own trailing baseline"
   once workspaceKey stamping on usage rows lands (the sound gate the
   net-effect estimator needed). Nobody else can even measure this.

## 6. Strategic read

RTK validated the market (people want this) and publicly discredited the
output-compression-only approach (JetBrains, +7.6%). Our differentiators —
coverage, losslessness, honest accounting, memory layer, turn-count levers —
are exactly the things their architecture cannot grow into. Our risks are
their strengths: install friction, filter breadth, and a saver that (until
the audit-fix branch + rewrite-mode land) still pays cache tax on the hook
path. The leapfrog move is not "compress better than RTK" — it is
"measure what RTK can't, and win on the bill, not the diff."

