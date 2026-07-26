# Policy ReDoS Probe Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the connection-string ReDoS probe measure the exact regex that `@megasaver/policy` ships.

**Architecture:** The policy table remains the behavior source. The benchmark's local `NEW_DETECTORS` entry is updated to its identical escaped-quote expression; the existing imported-regex parity test remains the permanent guard.

**Tech Stack:** TypeScript regular expressions, Node ESM benchmark script, Vitest, pnpm.

## Global Constraints

- Do not change `packages/policy/src/redaction-patterns.ts` or redaction behavior.
- Keep `redos-probe-parity.test.ts` strict and unchanged.
- Change exactly one exported probe regular expression.
- Verify locally with the focused policy test and full `pnpm verify`, then in the Ubuntu/Windows CI matrix.

---

### Task 1: Align the connection-string benchmark regex

**Files:**
- Modify: `scripts/redos-probe.mjs:166-171`
- Test: `packages/policy/test/redos-probe-parity.test.ts:68-75`

**Interfaces:**
- Consumes: shipped `connection_string_secret.pattern` from
  `packages/policy/src/redaction-patterns.ts`.
- Produces: `NEW_DETECTORS.connection_string_secret.re` whose `source` and
  `flags` match the shipped pattern.

- [ ] **Step 1: Preserve the failing regression check**

Run: `pnpm --filter @megasaver/policy test -- redos-probe-parity.test.ts`

Expected: FAIL at `NEW_DETECTORS.connection_string_secret` because the probe
uses `"[^\"]{8,8192}"` while the shipped pattern accepts doubled quote escapes.

- [ ] **Step 2: Apply the one-expression correction**

Replace the probe entry with:

```js
re: /(?=[^;\s])(?<=(?:^|;)\s{0,8}(?:password|accountkey|sharedaccesskey|sharedaccesssignature|userpassword)\s{0,8}=\s{0,8})(?:"(?:[^"]|""){8,8192}"|'(?:[^']|''){8,8192}'|[^;\s]{8,})/gi,
```

Do not change the seed or any other detector.

- [ ] **Step 3: Verify green**

Run: `pnpm --filter @megasaver/policy test -- redos-probe-parity.test.ts`

Expected: PASS, including the imported-regex byte-for-byte parity assertion.

### Task 2: Release verification and project record

**Files:**
- Modify: `wiki/log.md`
- Modify: `wiki/agent-channel.md`

- [ ] **Step 1: Run the complete gate**

Run: `pnpm verify`

Expected: lint, typecheck, all tests, and conventions pass.

- [ ] **Step 2: Record the correction**

Append the CI failure, root cause, exact one-expression scope, and verification
evidence to the wiki log and shared agent channel.

- [ ] **Step 3: Obtain a fresh independent review**

Have the reviewer inspect the final diff and proof before merging.
