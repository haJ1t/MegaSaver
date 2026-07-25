---
"@megasaver/policy": major
"@megasaver/cli": patch
---

Reject `deny.write` in `.megasaver/permissions.yaml` instead of silently
ignoring it.

`deny.write` compiled into `ProjectPermissions.denyWritePatterns`, and nothing
in the repo ever read that field — there is no `evaluatePathWrite` to pair with
`evaluatePathRead`, and live write enforcement was scoped out by
`docs/superpowers/specs/2026-06-03-permissions-yaml-design.md` §5.4. The result
was a security policy whose YAML presented `write:` as a peer of `read:` and
`commands:`, both of which are enforced, while it denied nothing.

The inconsistency this closes: the same `deny:` object already failed closed on
a *misspelled* key (`deny.execute` → `PolicyLoadError`) while accepting a
correctly-spelled, entirely inert one. A typo screamed; a dead rule was silent.

**Breaking — migration.** A `permissions.yaml` that declares `deny.write` now
fails closed: `mega output exec`, `mega output file`, `mega output filter`, and
the MCP `read_file` / `run_command` / `search_code` tools all return
`policy_load_failed` until the key is removed. The error names the key and says
what to do:

```
deny.write is not enforced: Mega Saver has no write gate, so these globs would
never deny anything. Remove the deny.write key; use deny.read / deny.commands,
which are enforced.
```

Delete the `write:` block. Nothing is lost — those globs denied nothing before
this release, so no write that was previously blocked becomes permitted.

`ProjectPermissions` no longer declares `denyWritePatterns`. `denyReadPatterns`,
`denyCommands`, and every evaluator are unchanged.

`mega output exec` (`@megasaver/cli`, patch) stopped dropping the
`policy_load_failed` detail. It printed only
`error: command_denied: policy_load_failed`, so on the surface most likely to
hit a bad permissions file the operator could not tell an unenforceable key from
a YAML syntax error. The detail now rides after the code —
`error: command_denied: policy_load_failed: <reason>` — which keeps the
CLI/MCP code parity that motivated the original omission. Applies to every
`policy_load_failed` cause, not just `deny.write`.

Major rather than minor: a previously-valid config file is now rejected and a
public type field is removed. Both are breaking and must be visible at release.

When a real write gate lands, `write:` returns to the schema *with* a call site
behind it. See
`docs/superpowers/specs/2026-07-25-deny-write-honest-rejection-design.md`.
