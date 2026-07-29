# Mechanical Verification Report

## 1. `pnpm verify` — Run 1

- **Exit Code:** `0`
- **Turbo Tasks:** 60 successful, 60 total
- **Conventions Sync Check:** `ok` (CLAUDE.md, AGENTS.md, .cursor/rules/mega-context.mdc, .cursor/rules/mega-conventions.mdc, .cursor/rules/mega-discipline.mdc)
- **Failing Tests:** None (0 failures)

## 2. `pnpm verify` — Run 2

- **Exit Code:** `0`
- **Turbo Tasks:** 60 successful, 60 total
- **Conventions Sync Check:** `ok`
- **Failing Tests:** None (0 failures)
- **Flakiness / Different Test Results:** None (0 tests gave a different result between runs)

## 3. `docs/superpowers/specs/2026-07-28-saver-compression-integrity-design.md` §7 References

The file:line references mentioned across the design spec and §7:

1. `types.ts compressorEligible` (spec §7 line 342, spec §1a line 62 `packages/output-filter/src/types.ts:266-274`)
   - **Claim:** `compressorEligible` gates category compressors for file sources: `decision === "compressed" && (!isFileSource || classification.category === "structured") && isConfidentClassification(classification)`.
   - **Status:** True.
   - **Current Line:** `packages/output-filter/src/types.ts:301-304` (shifted from lines 266-274).

2. `minBytesFor` (`apps/cli/src/hooks/saver.ts:52-57` cited in spec §1a line 35)
   - **Claim:** `minBytesFor` defines compression eligibility floor.
   - **Status:** True.
   - **Current Line:** `apps/cli/src/hooks/saver.ts:52-57` (unchanged).

3. `record-output.ts:145` (`packages/context-gate/src/record-output.ts:145` cited in spec §1a line 36)
   - **Claim:** `record-output.ts` sets output budget to `modeToBudget(mode)`.
   - **Status:** Modified by W1/A4. `maxReturnedBytes` is no longer passed to `filterOutput` in `record-output.ts` (see line 171 comment). `floorBytes` is set at line 164.
   - **Current Line:** `packages/context-gate/src/record-output.ts:164` & `171-178` (shifted from line 145).

4. `DEFAULT_MODE = "safe"` (`packages/context-gate/src/resolve-saver-settings.ts:44` cited in spec §1a line 57)
   - **Claim:** `DEFAULT_MODE` is `"safe"`.
   - **Status:** True.
   - **Current Line:** `packages/context-gate/src/resolve-saver-settings.ts:44` (unchanged).

5. `record-output.ts:178-191` (`packages/context-gate/src/record-output.ts` cited in spec §1b(i) line 72)
   - **Claim:** Hook path persists full redacted raw.
   - **Status:** True.
   - **Current Line:** `packages/context-gate/src/record-output.ts:201-240` (shifted from lines 178-191).

6. `packages/context-gate/src/read.ts:249-255` (cited in spec §1b(i) line 75)
   - **Claim:** `read.ts` persisted `filtered.excerpts` instead of full raw.
   - **Status:** Resolved by W2/A2 implementation. `read.ts` now persists full raw via `recoverableChunks(input.raw)`.
   - **Current Line:** `packages/context-gate/src/read.ts:264` & `291` (shifted from lines 249-255).

7. `packages/context-gate/src/run-command.ts:390-396` & `636-642` (cited in spec §1b(i) lines 76-77)
   - **Claim:** `run-command.ts` paths persisted `filtered.excerpts` instead of full raw.
   - **Status:** Resolved by W2/A2 implementation. `run-command.ts` now persists full raw via `recoverableChunks(outcome.capture.raw)`.
   - **Current Line:** `packages/context-gate/src/run-command.ts:395` & `656` (shifted from lines 390-396 & 636-642).

8. `packages/connectors/shared/src/context-gate-block.ts:28` (cited in spec §1b(i) line 80)
   - **Claim:** Tells connected agents "The COMPLETE output is stored locally in ~40-line chunks...".
   - **Status:** True.
   - **Current Line:** `packages/connectors/shared/src/context-gate-block.ts:28-30` (unchanged).

9. `recovery-footer.ts:43-46` (cited in spec §1b(ii) line 88)
   - **Claim:** Publishes `~40 lines each, i = 0..N-1`.
   - **Status:** True.
   - **Current Line:** `packages/context-gate/src/recovery-footer.ts:43-46` (unchanged).

10. `packages/stats/src/event.ts:20,43` and `summary.ts:10,27` (cited in spec §1c line 104)
    - **Claim:** Stats schema enforces `nonnegative()`.
    - **Status:** True for `bytesSaved`/`bytesSavedTotal`; `deltaBytes`/`deltaBytesTotal` signed field added per W0/B1.
    - **Current Line:** `packages/stats/src/event.ts:35` and `packages/stats/src/summary.ts:16,34` (shifted from lines 20,43 & 10,27).

## 4. TODO, FIXME, XXX, "ponytail:" Search Results in Source Files

Excluding test files (`**/test/**`, `*.test.ts`, `*.test-d.ts`), build artifacts (`**/dist/**`), and `node_modules`.

- **TODO:** `0` matches
- **FIXME:** `0` matches
- **XXX:** `0` matches
- **ponytail:** `38` matches:

1. `apps/gui/src/views/cockpit/daemon-status.tsx:6`
   `// ponytail: status-only panel; daemon is lazily spawned by MCP/hook clients,`
2. `apps/gui/src/lib/workspace-context.ts:12`
   `// ponytail: single-sourced from the recent-session list. A workspace with no`
3. `apps/gui/bridge/routes/daemon.ts:24`
   `    // ponytail: daemon-down is the normal case; never let this throw`
4. `apps/gui/bridge/routes/workspace-context.ts:13`
   `// ponytail: no coChangeLog here — the workspace is addressed by a one-way FNV`
5. `apps/cli/src/commands/memory/from-session.ts:100`
   `      // ponytail: one capture (≈1 git spawn per cited file) per candidate;`
6. `apps/cli/src/commands/handoff/open.ts:46`
   `    // ponytail: TOCTOU — file could grow between stat and read; acceptable for a`
7. `apps/cli/src/commands/brain/import.ts:48`
   `    // ponytail: TOCTOU — file could grow between stat and read; acceptable for a`
8. `apps/cli/src/hooks/saver-run.ts:102`
   `const DAEMON_TIMEOUT_MS = 1500; // ponytail: short timeout; a hung socket must not stall the hook`
9. `apps/cli/src/hooks/saver-run.ts:118`
   `          // ponytail: daemon excerptHandler supplies storeRoot itself; do NOT add evidenceStoreRoot.`
10. `packages/policy/src/evaluate-command.ts:48`
    `  // ponytail: input gate only. Content that a recursive grep -r . sweeps out`
11. `packages/context-pruner/src/cochange.ts:44`
    `// ponytail: 50 caps a commit at 2450 ordered pairs; per-pair emission (only`
12. `packages/context-pruner/src/score.ts:27`
    `// O(commits²-per-commit) parse runs once. ponytail: single-entry memo is enough`
13. `packages/context-pruner/src/read-cochange-log.ts:17`
    `// ponytail: never invalidated within a process — a fresh commit mid-session`
14. `packages/indexer/src/extract/extract-rs.ts:12`
    `// ponytail: naive brace count ignores strings/comments/char literals; accepted ceiling per spec.`
15. `packages/indexer/src/extract/extract-go.ts:12`
    `// ponytail: naive delimiter count ignores strings/comments; accepted ceiling per spec.`
16. `packages/core/src/warm-start.ts:46`
    `// ponytail: hardcoded thresholds (spec locked decision 3) — only budget is a flag`
17. `packages/core/src/autopilot.ts:130`
    `    // ponytail: one capture (~1 git spawn per cited file) per candidate —`
18. `packages/core/src/brain-import.ts:44`
    `  // ponytail: writes are per-call and non-transactional; merge-only + content dedupe makes a re-run self-healing, so partial writes on a mid-loop throw are acceptable for v1.`
19. `packages/connectors/claude-code/src/hook-settings.ts:245`
    `  // ponytail: no matcher for UserPromptSubmit — Claude Code ignores the field for this event type`
20. `packages/connectors/claude-code/src/hook-settings.ts:281`
    `  // ponytail: no matcher for SessionStart — Claude Code ignores the field for this event type`
21. `packages/mcp-bridge/src/tools/run-command.ts:50`
    `  // ponytail: mirror evaluateCommand's recursive_megasaver guard BEFORE forwarding —`
22. `packages/mcp-bridge/src/tools/forward.ts:10`
    ` * ponytail: no handle caching — one ping per tool call (loopback, 1.5s-bounded).`
23. `packages/mcp-bridge/src/tools/search-code.ts:208`
    `  // ponytail: mirror evaluateCommand's recursive_megasaver guard BEFORE forwarding —`
24. `packages/output-filter/src/normalize.ts:86`
    `  // ponytail: hex and port masks removed — they folded distinct value-bearing events`
25. `packages/output-filter/src/dedupe.ts:17`
    `// ponytail: input that puts every hash in one bucket is still all-pairs; that`
26. `packages/output-filter/src/types.ts:255`
    `        // ponytail: tool name hardcoded; lift to a constant when the CLI surface stabilises.`
27. `packages/output-filter/src/parsers/semantic.ts:43`
    `// ponytail: line cap, not budget — the chunker has no mode/budget in scope.`
28. `packages/output-filter/src/parsers/outline.ts:8`
    `// ponytail: 6-line cap + naive opener scan. Upgrade to the real body-opener`
29. `packages/output-filter/src/parsers/outline.ts:14`
    `// ponytail: mirrors extractorFor in semantic.ts (different return type — full ExtractedBlock vs span-only). Keep the extension set in sync when adding languages.`
30. `packages/output-filter/src/parsers/outline.ts:78`
    `  // ponytail: last-writer-wins on duplicate spans. Pre-1.0 extractors don't emit true duplicates; if they did, the block is omitted from the skeleton (its lines still ride in a covering chunk, so the read stays lossless).`
31. `packages/output-filter/src/compress/prose.ts:101`
    `    // ponytail: indented code treated same as a fence block (verbatim)`
32. `packages/brain-sync/src/config.ts:70`
    `  // ponytail: if the deadline passes under contention the write is skipped —`
33. `packages/context-gate/src/retention-prune.ts:13`
    `// ponytail: full ledger scan per prune run (daily, or on an explicit`
34. `packages/context-gate/src/shown-index.ts:30`
    `// ponytail: load-modify-write, last-writer-wins under parallel same-session calls.`
35. `packages/daemon/src/handlers-registry.ts:14`
    `// ponytail: safeSegmentSchema duplicated from handlers.ts — no abstraction until`
36. `packages/daemon/src/handlers.ts:51`
    `    // ponytail: exactOptionalPropertyTypes — omit key entirely when absent`
37. `packages/daemon/src/handlers.ts:158`
    `// ponytail: two copies until a later phase extracts to @megasaver/shared.`
38. `packages/daemon/src/handlers.ts:312`
    `  // ponytail: skip BM25 re-rank (needs @megasaver/retrieval) — add when search relevance is poor.`

## 5. `git log --oneline main..HEAD` Commit Subjects Exceeding 50 Characters

Total commits: 44. Commits exceeding 50 characters in subject: **32**.

1. `a5c1bf4b` (71 chars): `Merge branch 'feat/saver-a-architecture' into docs/saver-integrity-spec`
2. `93cf6a8c` (65 chars): `refactor(output-filter): model-facing bytes counts, never renders`
3. `bdaef5eb` (56 chars): `feat(output-filter): budget targets a share of the input`
4. `569bb112` (66 chars): `Merge branch 'feat/saver-c-defects' into feat/saver-a-architecture`
5. `07b28502` (69 chars): `Merge branch 'feat/saver-b-accounting' into feat/saver-a-architecture`
6. `ded11c16` (51 chars): `docs(wiki): lint already fixed at tip, A4 unblocked`
7. `2dde93f6` (53 chars): `style: biome format + lint fixes across track-B files`
8. `7492b11f` (58 chars): `fix(output-filter): honest collapse promises in prose/json`
9. `12e69d1c` (53 chars): `fix(output-filter): parseGoTest keeps panicking tests`
10. `51f6c1da` (59 chars): `fix(output-filter): loose error-TS mention never classifies`
11. `2a1de2fe` (55 chars): `docs(saver): flag track B lint gate, record integration`
12. `eb7490b4` (61 chars): `feat(context-gate): wire signed savings and honest exec bytes`
13. `dd495c17` (54 chars): `fix(output-filter): compressTsc drops nothing silently`
14. `6f034280` (69 chars): `Merge branch 'feat/saver-b-accounting' into feat/saver-a-architecture`
15. `eabc2130` (57 chars): `feat(bench-replay): enforce fresh store per benchmark run`
16. `5eb74ef9` (55 chars): `docs(wiki): report B1 store.ts flag, B3 gap, B4 numbers`
17. `89f5daf2` (61 chars): `feat(output-filter): real BPE count at the reporting boundary`
18. `579bb2a2` (53 chars): `docs(saver): review B1-B3, flag two cross-track seams`
19. `55f8067f` (60 chars): `feat(context-gate): charge chunk expansions as recovery debt`
20. `cc9c6395` (63 chars): `fix(output-filter): keep collapse markers under budget pressure`
21. `9fbd9cfe` (56 chars): `fix(output-filter): number gap markers in raw line space`
22. `3f4864a7` (56 chars): `feat(output-filter): model-facing byte accounting module`
23. `3c175ea7` (54 chars): `feat(stats): signed deltaBytes makes inflation visible`
24. `303de7ee` (65 chars): `fix(cli): evaluate combined stdout and stderr length in size gate`
25. `c144cfb2` (57 chars): `docs(saver): record A2 landing and the open B2 dependency`
26. `225a0279` (54 chars): `fix(context-gate): recover from raw, not from excerpts`
27. `5fa4b5e5` (66 chars): `fix(retrieval): split camelCase and snake_case identifiers in BM25`
28. `6e408658` (53 chars): `fix(output-filter): filter stop words from intent set`
29. `e0184acf` (53 chars): `fix(cli): prevent non-path bloat in rebuilt filenames`
30. `38bb2993` (54 chars): `test(context-gate): assert the save-integrity contract`
31. `91906677` (52 chars): `docs(saver): fix worktree setup, publish A1 contract`
32. `f873f0fe` (54 chars): `docs(saver): record verified baseline and branch point`
