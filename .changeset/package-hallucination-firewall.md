---
"@megasaver/context-gate": minor
"@megasaver/cli": minor
---

Package-Hallucination Firewall: a warn-only PreToolUse layer on agent
edits extracts npm/PyPI package references from new text and verifies
them offline in three tiers (project-local → committed seed ∪ local
cache → unknown); unknown names get an additionalContext warning with a
typosquat hint and firewall-ledger events (unknown-package /
typosquat-suspect, grammar-bounded). `mega firewall status/refresh/allow`
manage the cache and allowlist — refresh is the only network touchpoint
and no hook path performs network I/O. Never blocks an edit; with no
package refs the guard hook output is byte-identical to before.
