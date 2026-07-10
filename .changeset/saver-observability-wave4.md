---
"@megasaver/shared": minor
"@megasaver/context-gate": minor
"@megasaver/stats": minor
"@megasaver/connector-claude-code": minor
"@megasaver/core": minor
"@megasaver/cli": minor
---

Saver observability wave 4 (E21-E29): a dead saver is now visible. The
per-workspace heartbeat registry becomes a full liveness ledger — hook
failures (with a coarse kind), successful completions, and daemon
fallbacks are recorded best-effort and surfaced in `mega session saver
resolve`, `mega hooks status`, and a new `mega doctor` verifier section
(registration, binary, store bake, heartbeat liveness, spawned self-test,
daemon ping). Corrupt per-session overlay summaries self-heal from their
events JSONL (stamped `rebuiltAt`); summary read-modify-writes are
serialized by a new stale-aware `withFileLock` in `@megasaver/shared`
(which also unfreezes the heartbeat lock), and the daily GC sweep
reconciles summaries that lag their JSONL. `mega hooks install` now
registers hooks by absolute CLI path with explicit timeouts, bakes
`--store` for non-default stores, and migrates legacy bare entries in
place; `mega hooks status <id>` also resolves live overlay sessions, and
the no-arg form aggregates savings and liveness across workspaces.
