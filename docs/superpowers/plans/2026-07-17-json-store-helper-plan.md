# Shared JSON-store helper — Implementation Plan

**Goal:** Hoist the triplicated advisory atomic-JSON-store mechanic into one core-internal `json-store.ts`, reused by guard-state / warm-start-state / autopilot-store, with byte-identical behavior.

**Architecture:** Helper owns the fs mechanic only (`readJsonFile` parse-or-undefined; `writeJsonAtomic(dir, fileName, data)` mkdir+tmp+rename, swallow, no fsync). Each caller keeps its own Zod schema + fallback → every error posture preserved. Spec: `docs/superpowers/specs/2026-07-17-json-store-helper-design.md`.

**Risk:** MEDIUM-HIGH (touches shipped guard-state + warm-start-state in the connector core path). Net = the three existing suites (31 tests), which must stay green unmodified.

---

### Task 1: `json-store.ts` + tests (TDD)
- Create `packages/core/test/json-store.test.ts` FIRST: read missing → `undefined`; read invalid JSON → `undefined`; read valid → parsed value; write creates a missing dir; write leaves no `.tmp` on success; write overwrites an existing file; write swallows when the target dir path is a file (unwritable) and does not throw.
- Run → RED (module missing).
- Create `packages/core/src/json-store.ts` with `readJsonFile` + `writeJsonAtomic` lifted verbatim from `autopilot-store.ts` (param `storeRoot` → `dir`). WHY comments carried over (no fsync = advisory; swallow = corruption-safe fail-to-default).
- Run → GREEN. `pnpm build`.

### Task 2: rewire `autopilot-store.ts`
- Delete the two private functions; `import { readJsonFile, writeJsonAtomic } from "./json-store.js"`. All call sites unchanged. `structuredClone(DEFAULT_AUTOPILOT_POLICY)` stays.
- `pnpm build`; `autopilot-store.test.ts` (21) GREEN unmodified.

### Task 3: rewire `guard-state.ts`
- `readGuardState`: `guardStateSchema.safeParse(readJsonFile(statePath(rootDir, projectId)))` → `data` : `null`.
- `writeGuardState`: keep session pruning, then `writeJsonAtomic(join(rootDir, "guard"), \`${projectId}.json\`, { ...state, sessions })`.
- Drop now-unused `node:fs` / `node:crypto` imports made orphan by the change.
- `pnpm build`; `guard-state.test.ts` (5) GREEN unmodified.

### Task 4: rewire `warm-start-state.ts`
- `readWarmStartState`: `warmStartStateSchema.safeParse(readJsonFile(statePath(...)))` → `data` : `null`.
- `stampWarmStartSeen`: `writeJsonAtomic(join(rootDir, "warm-start"), \`${projectId}.json\`, { lastSeenAt: now })`.
- Drop orphaned imports.
- `pnpm build`; `warm-start-state.test.ts` (5) GREEN unmodified.

### Task 5: verify + changeset + review
- `pnpm verify` green (lint + typecheck + all suites + conventions:check).
- `.changeset/json-store-helper.md` — `@megasaver/core` patch (internal refactor, no public API change).
- Fresh code-reviewer AND adversarial critic on the full branch diff: confirm no error-posture flattening, no `structuredClone` regression, no fsync added, no scope creep into the three durable/throwing writers, existing suites unmodified.
