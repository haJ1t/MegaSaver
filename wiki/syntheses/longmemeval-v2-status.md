---
title: LongMemEval-V2 / LM2 Status
tags: [synthesis, long-memory, benchmark, status]
sources:
  - GitHub PR #315
  - docs/superpowers/specs/2026-07-20-long-memory-lm2-hybrid-recall-design.md
  - benchmarks/longmemeval-v2/README.md
status: active
created: 2026-07-27
updated: 2026-07-27
---

# LongMemEval-V2 / LM2 Status

## Product state

LM2 durable recall is on `main` through PR #315 (`b8554f7a`). Core memory
entries reach it through the CLI, MCP bridge, and daemon adapters. The release
does not establish a LongMemEval-V2 score. (source: GitHub PR #315; `wiki/log.md`,
2026-07-27 release entry)

## Official evidence preparation

The official checkout and public dataset are pinned to the revisions required
by `benchmarks/longmemeval-v2/README.md`; Small-tier data validation found 451
questions and 1,870 trajectories. Web and enterprise manifests were built from
that revision with fixed digests. A native macOS path bug discovered during the
first real web insertion is repaired in the pending Darwin-anchor change: the
secure vector anchor now accepts only the verified `/tmp` and `/var` system
aliases and keeps arbitrary symlinks fail-closed. The corrected built transport
successfully inserted the first manifest-admitted public web trajectory with
`indexingComplete: true`. (source: local pinned-data audit, 2026-07-27;
`docs/superpowers/specs/2026-07-27-lm2-darwin-anchor-design.md`)

## Evidence boundary

No official accuracy, latency, LAFS, leaderboard, or first-place claim is
valid yet. The remaining official harness requires complete web and enterprise
runs with configured reader and evaluator model endpoints, followed by the
repository evidence verifier. Those external endpoints are not configured in
the current environment. (source: `benchmarks/longmemeval-v2/README.md`;
official verifier preflight, 2026-07-27)

## Next gate

Merge the reviewed Darwin-anchor repair, then run both official domains using
the pinned reader/evaluator configuration and submit the resulting artifacts
to the evidence verifier. Only a successful full verifier run makes an
official score eligible.
