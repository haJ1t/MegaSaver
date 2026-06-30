# Plan — M4 transcript→memory (deterministic session distillation)

Spec: [2026-06-30-memory-from-session-design.md](../specs/2026-06-30-memory-from-session-design.md)

TDD throughout: failing test first (RED), implement (GREEN), refactor. Additive.
No LLM. Suggested-only.

1. **Core extractor** — `packages/core/src/session-memory.ts`.
   - RED: `session-memory.test.ts` — 2 distinct + 1 duplicate failure (+ decision
     marker) → expected candidates (dup collapsed; correct type/source/
     relatedFiles/title/content; stable dedupeKey).
   - GREEN: `extractSessionMemories({ sessionId, projectId, failedAttempts })`
     returning `ExtractedCandidate[]`; export from `index.ts`.
   - verify: `pnpm --filter @megasaver/core test` green.

2. **CLI `mega memory from-session`** — `apps/cli/src/commands/memory/from-session.ts`.
   - RED: command test — creates N suggested memories from a session's failures;
     re-run creates 0 (idempotent); summary counts; suggested not recallable via
     `searchMemoryEntries`.
   - GREEN: `runMemoryFromSession` (mirror `sweep.ts` wiring; resolve session →
     project; extractor → createMemoryEntry suggested w/ dedupeKey keyword;
     skip already-present dedupeKeys); register in `memory/index.ts`.
   - verify: `pnpm --filter @megasaver/cli test` green; CLI smoke.

3. **MCP `mega_memory_from_session`** — `packages/mcp-bridge/src/tools/from-session-memory.ts`.
   - RED: tool test — `{ sessionId }` → `{ suggested, skipped }`; re-run skips.
   - GREEN: `handleFromSessionMemory({ registry, now, newId })`; add to
     `tool-name.ts` enum + `server.ts` TOOL_DEFS + dispatch.
   - verify: `pnpm --filter @megasaver/mcp-bridge test` green.

4. **Verify + ship.**
   - FULL `pnpm verify` (turbo build — daemon resolves core from dist).
   - Changeset (minor). Mark spec item 6 DONE in memory-superset-design.md.
     Append `wiki/log.md`.
   - Commit spec + plan + impl + tests + changeset + docs (explicit staging; no
     `git add -A`).
