---
"@megasaver/cli": minor
"@megasaver/connector-claude-code": patch
"@megasaver/stats": minor
---

Add an optional POSIX Task Kickoff response with session-global at-most-once
delivery, canonical unique-project selection, and owner-only persistence.
Recognize and deduplicate only supported first-party hook launchers, refuse
symlinked or non-regular accounting targets through a no-follow, nonblocking
descriptor, and make the irreversible stdout accounting boundary explicit.
Ship the sidecar-free Node 22 bundle behind a full-minification, sub-12 MiB CI
gate; Windows continues to emit no Task Kickoff output or state.
This release makes no measured cache-write savings claim; that remains gated on
a paired fresh-store benchmark with task-parity and total-cost evidence.
