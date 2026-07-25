---
title: LongMemEval-V2 Source Summary
tags: [source, benchmark, long-memory, evaluation]
sources: [https://github.com/xiaowu0162/LongMemEval-V2]
status: active
created: 2026-07-19
updated: 2026-07-19
---

## Summary

LongMemEval-V2 evaluates long-term agent memory with 451 curated questions over
multimodal web and enterprise trajectories, including haystacks up to 115M
tokens. (source: https://github.com/xiaowu0162/LongMemEval-V2)

## Contract

Its backends ingest trajectories with `insert` and return budgeted text/image
evidence from `query`; it scores accuracy and query latency across static state,
dynamic state, workflow, gotchas, and premise awareness. (source:
https://github.com/xiaowu0162/LongMemEval-V2)

## Project use

[[concepts/long-memory-runtime]] uses it as an external quality gate while
retaining Mega Saver's evidence, approval, and local-first rules.
