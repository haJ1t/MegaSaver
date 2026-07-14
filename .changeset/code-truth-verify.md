---
"@megasaver/core": minor
"@megasaver/output-filter": minor
"@megasaver/stats": minor
"@megasaver/entitlement": minor
"@megasaver/mcp-bridge": minor
"@megasaver/cli": minor
---

Code-Truth Verify (i6): git-anchored memories that stale and heal.

- core: `memory-anchor` module (codeAnchor/lastVerified schemas, best-effort
  `captureCodeAnchor`), `code-truth` module (pure `verifyAnchors` planner +
  `runVerify` git runner), whole-batch `applyMemoryEntryPatches`, and
  `STALE_WEIGHT` down-ranking for stale rows on includeStale surfaces.
  Contradiction closes `validTo` with ownership tracking
  (`closedByCodeTruth`); heal reopens only code-truth-owned closes. Anchor
  paths reject control characters at the schema boundary.
- output-filter: public `extractBlocksForFile` polyglot per-file extraction.
- cli: `mega memory verify` (free one-shot; `--install-hook` /
  `--uninstall-hook` Pro post-commit automation), `--symbol` inputs,
  `--no-anchor` opt-out, sweep verify pre-pass (Pro), show/explain anchor
  summary + verification badge.
- mcp-bridge: `save_memory` symbol anchors, `get_relevant_memories`
  verification badges + Pro pre-recall spot-check with sentinel-guarded
  disclosure, new `verify_memories` tool (Pro).
- stats/entitlement: `code-truth` ProFeature key, stale-recall-avoided ledger
  and "stale recall waste avoided" savings line.
