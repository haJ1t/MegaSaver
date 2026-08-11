# Evidence Bundle Exporter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** `mega pr bundle` builds a content-addressed evidence bundle (json + md) from preflight/sweep/chunk-set/receipt joins; `mega pr verify` hash-re-verifies it.

**Architecture:** Pure schema + builder + verify determinism in `apps/cli/src/bundle/`; two citty commands; no GitHub API.

**Tech Stack:** TypeScript strict ESM, Zod, Vitest, citty, node:crypto sha256, node:fs, `@megasaver/content-store`, `@megasaver/policy`.

## Global Constraints

- Zod strict, sorted-key canonical JSON, bundleId = sha256(canonical)[0:12]; no extra keys.
- Only chunkSetId + hash in bundle, never chunk text.
- Git via execFile argv + 2s timeout; fail to stale, not to crash.
- Redaction on render, not on hash.
- Conventional commits ≤ 50 chars.

---

### Task 1: schema + canonical + hash

**Files:** `apps/cli/src/bundle/schema.ts` (new), `apps/cli/test/bundle/schema.test.ts` (new)

- [ ] Write failing test: schema rejects extra key; `canonicalJson({b:1,a:1}) === canonicalJson({a:1,b:1})`; same payload → same bundleId; different payload → different bundleId; hash stability.
- [ ] Run — FAIL
- [ ] Implement `evidenceBundleSchema` (version literal 1, refs, hashes), `canonicalJson` (recurse sorted keys), `bundleIdOf`, `hashBytes`.
- [ ] Run — PASS
- [ ] Commit: `feat(cli): evidence bundle schema + canonical`

---

### Task 2: pure builder + md renderer

**Files:** `apps/cli/src/bundle/build.ts` (new), `apps/cli/test/bundle/build.test.ts` (new)

- [ ] Write failing test: build from fake gitState + preflight hashes + receipts → bundle with lineage hashes; `renderBundleMd` contains `## Diff`, `## Tests`, `## Context` sections in order; redaction replaces `secret` in paths.
- [ ] Run — FAIL
- [ ] Implement `buildEvidenceBundle` (join inputs, compute bundleId, lineage hashes) + `renderBundleMd` (fixed sections, 50-path trim, no LLM)
- [ ] Run — PASS
- [ ] Commit: `feat(cli): bundle builder + renderer`

---

### Task 3: verify (pure)

**Files:** `apps/cli/src/bundle/verify.ts` (new), `apps/cli/test/bundle/verify.test.ts` (new)

- [ ] Write failing test: valid bundle → all pass; flipped chunk hash → fail; added chunk → stale; malformed bundle → throws schema error; no git → stale.
- [ ] Run — FAIL
- [ ] Implement `verifyBundle` (re-hash chunk-sets via injected reader, re-parse git oids, fence check)
- [ ] Run — PASS
- [ ] Commit: `feat(cli): bundle verify`

---

### Task 4: `mega pr` commands

**Files:** `apps/cli/src/commands/pr/bundle.ts`, `verify.ts`, `index.ts` (new), `apps/cli/test/commands/pr-bundle.test.ts` (new), `apps/cli/src/main.ts` (register)

- [ ] Write failing tests: tmp store+git → `runBundle` writes `store/bundles/<id>.json` + `.md`; `runVerify` on it → exit 0; corrupted bundle → exit 1; no project → exit 1; --json shape.
- [ ] Run — FAIL
- [ ] Implement io-injected `runBundle`/`runVerify`, citty wiring, `resolveStorePath`, `findProjectByCwd`, `captureGitState`, content-store reads.
- [ ] Run + dep-graph guard — PASS
- [ ] Commit: `feat(cli): mega pr bundle + verify`

---

### Task 5: changeset, wiki, verify

- [ ] Changeset `@megasaver/cli` minor
- [ ] Wiki: `wiki/entities/cli.md` pr bundle section
- [ ] `pnpm verify` green; smoke: `mega pr bundle --why "x"` → `mega pr verify`
- [ ] Commit: `chore: changeset + wiki for bundle`
- [ ] Hand off to `code-reviewer`
