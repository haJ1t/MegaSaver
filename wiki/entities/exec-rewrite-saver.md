---
title: Exec-Rewrite Saver
tags: [entity, saver, hooks, v2.7]
sources: [docs/superpowers/specs/2026-08-06-exec-rewrite-saver-design.md, wiki/decisions/v27-net-positive-saver.md]
status: active
created: 2026-08-13
updated: 2026-08-13
---

# Exec-Rewrite Saver (`mega output exec-live`)

Wave-2 build #1, v2.7 Net-Positive Saver first pick. Opt-in PreToolUse
mode that rewrites eligible flat-token Bash commands to
`mega output exec-live --live-session <sid> [--store <s>] [--timeout <s>] -- <tokens>`
BEFORE execution — the compressed chunk-store-backed output is the only
version the client ever caches. The client's ~30k truncation cap applies
to the compressed form, never to the raw evidence; the full raw persists
chunk-store-side behind the recovery footer.

## Surfaces

- Hook entry: own `^Bash$` PreToolUse (matcher, timeout 10) — never
  piggybacked on guard; tri-state `mega hooks install claude-code
  --exec-rewrite` (absent preserves, `--no-exec-rewrite` removes).
- `mega hooks exec-rewrite` — fail-open hook runner: `updatedInput`
  ONLY (no `permissionDecision`), full tool_input replacement echo
  (`description` survives), SAFE_TOKEN launcher/store gate, threads
  `tool_input.timeout` (ms→s).
- `mega output exec-live` — LD13 self-validates positionals against
  `classifyExecRewrite` (allowlist is structural, not caller honor);
  `runChild` + daemon-first `makeRecord`; LD6 parity fallback; 600s /
  100MB defaults; content-derived `newId`; canonical-path workspace
  identity.
- Saver exemption (LD12): the PostToolUse saver passes exec-live
  invocations through — no footer-on-footer, no garbage chunk sets.
- Stats: additive `origin: "exec-rewrite"` on overlay events
  (`splitOverlayEventsByOrigin` deferred to the UI wave).

## Evidence (2026-08-13)

- Q1 gate resolved: official hooks docs + live runtime probe on
  Claude Code 2.1.223 — `updatedInput` alone rewrites the command
  (`echo hello` → `echo PROBE_UPDATE_OK` executed).
- Smoke: install entry, rewrite JSON, exec-live compressed
  91890→12211 B with recoverable chunks, LD13 refusal exit 1,
  LD12 saver passthrough, identical re-run → same chunk-set id.
- Canonical-cwd bug found by smoke: macOS getcwd `/private/var/...`
  vs symlinked payload spelling — fixed on both hook gate and
  exec-live (LD14 note).

## Related

- [[decisions/v27-net-positive-saver]] — the v2.7 direction.
- [[entities/cli]], [[entities/connectors-claude-code]],
  [[syntheses/rtk-competitive-analysis-2026-08-01]].
