---
"@megasaver/cli": minor
"@megasaver/connector-claude-code": patch
---

Add an optional Claude Code PreToolUse batch-read adviser. After two eligible
Read, Grep, or Glob calls in the same directory within sixty seconds, the hook
offers one concise `additionalContext` suggestion for batching the remaining
exploration. The current call stays native and remains subject to Claude Code's
permission controls; the adviser never returns an allow or deny decision.

An advice event records only that guidance was offered. It is not a
token-saving event and makes no claim that the agent followed the advice or
that any tokens were saved.

Harden the adviser as a POSIX-only, owner-private version-2 transaction. An
exclusive lock per canonical workspace and safe session serializes the
read/decide/durable-rename boundary; contention or an abandoned lock safely
suppresses optional advice instead of waiting or stealing a lease. Filesystem
operations retain exact canonical realpaths while only an NFC copy enters the
domain-separated directory hash. State is byte- and count-bounded, rejects
legacy and special-node paths, and expires after thirty days; the same strict
retention removes only owned UUID transaction temps. `hooks status --settings`
reports advice installation from a custom settings file. Windows omits or
removes only the owned advice hook and creates no adviser state. Fresh
standalone-bundle and installed-tarball-bin smoke tests now exercise the
two-call contract; the behavioral benchmark remains unmeasured, so this
hardening adds no savings claim.

Move adviser state into opaque per-record v3 capsules under
`stats/cache-advice-v3`, enrolled in a bounded durable FIFO so the daily sweep
claims at most eight frames behind a frozen tail — continuous activity can no
longer starve an expired record out of the thirty-day retention contract. A
single-flight off-hook maintainer (`mega hooks cache-advice-maintain`,
triggered detached from install and from hooks that observe an incomplete
migration) converts legacy flat state outside the PreToolUse response path:
valid version-2 snapshots move into enrolled capsules, unparseable state
becomes an opaque suppression, and migration completes only after a final
clean rescan. Windows still creates none of these nodes, and no advice event
is or becomes a cost-savings measurement.
