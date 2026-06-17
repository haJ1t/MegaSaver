# Evidence Ledger Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@megasaver/evidence-ledger`, a new leaf package that owns the canonical evidence schema, retention, revocation, and audit trail shared by ContextGate (token reduction) and Reliable Save.

**Architecture:** A pure leaf package (depends only on `@megasaver/shared` + `zod`). It persists one JSON record per evidence item under `<storeRoot>/evidence/<workspaceKey>/<evidenceId>.json` (atomic write, copied from content-store). The in-record `transitions[]` array IS the audit trail — written atomically with the record; there is **no** separate events sidecar. Raw redacted chunks live in `@megasaver/content-store`; this package stores only the opaque `redactedRawChunkSetId` and deletes raw material through an injected `ChunkDeletePort` (no content-store import). Digests are **computed by the ledger** over post-redaction content passed at append time — callers never supply digests. `sourceRef` is stored already-redacted (caller redacts at append; ledger validates the redaction report at the boundary). Revocation atomically tombstones the record (null digests + null chunk ref + scrub `sourceRef` + clear pins + reset retention) **before** best-effort raw deletion.

**Tech Stack:** TypeScript strict ESM, Zod schemas, Vitest, tsup, Biome, pnpm workspace, Turborepo.

**Source spec:** `docs/superpowers/specs/2026-06-16-evidence-ledger-interface-design.md` (HIGH risk, commit cd6b634 "harden evidence revoke contract").

**Risk:** HIGH (secret-bearing local data + revocation). Execute in an isolated worktree (`superpowers:using-git-worktrees`). Pre-merge requires `code-reviewer` AND `critic` per CLAUDE.md §12.

**Review history:** v1 of this plan was reviewed by code-reviewer + adversarial critic; both found BLOCKING holes (secret survived revoke via `sourceRef`/`rawDigest`/`events.jsonl`; branded-`WorkspaceKey` compile break; no write/event atomicity). The spec was hardened (cd6b634) and this plan revised to match. Key changes vs v1: digests ledger-computed + nulled on revoke; `sourceRef` redacted + scrubbed; `events.jsonl` removed; `workspaceKey` plain-string + boundary parse + match-assert; pin legal only from `session`; GC skips `manual_hold`; planted-secret purge tests added.

---

## File Structure

```
packages/evidence-ledger/
├── src/
│   ├── index.ts          # public surface
│   ├── enums.ts          # sourceKind, retentionClass, status, revocationReason, transitionKind
│   ├── sub-schemas.ts    # sourceRef, sessionRef, redactionReport, returnedChunkRef, transition
│   ├── schema.ts         # evidenceRecordSchema + invariants + EvidenceRecord/Input types
│   ├── backfill.ts       # backfillEvidenceRecord (read-boundary upgrade)
│   ├── errors.ts         # EvidenceLedgerError + error codes
│   ├── digest.ts         # digestContent (sha256 hex over post-redaction text)
│   ├── ports.ts          # ChunkDeletePort type
│   ├── paths.ts          # store path layout + assertSafeSegment (NO events path)
│   ├── atomic-write.ts   # atomicWriteFile (verbatim copy of content-store helper)
│   └── store.ts          # append/get/load/list/pin/unpin/revoke/explain/gc
├── test/
│   ├── dependency-graph.test.ts
│   ├── enums.test.ts
│   ├── schema.test.ts
│   ├── backfill.test.ts
│   ├── digest.test.ts
│   ├── store.test.ts
│   └── index.test-d.ts
├── package.json
├── tsconfig.json
├── tsconfig.test.json
├── tsconfig.test-d.json
├── tsup.config.ts
├── vitest.config.ts
└── CHANGELOG.md
```

Each `src/*` file has one responsibility. `store.ts` is the only IO module; everything else is pure.

**Import hygiene (applies to every "add to store.ts" step):** keep a SINGLE import group at the top of the file. When a later task introduces a new import, MERGE it into the existing top-of-file imports (do not add a second `import ... from "node:fs"` or scatter imports mid-file). Biome `organizeImports` requires this exact order (matches `content-store/src/store.ts`, which passes verify): (1) `node:*`, (2) `@megasaver/*`, (3) relative `./*` **alphabetical** (`./atomic-write` → `./backfill` → `./digest` → `./enums` → `./errors` → `./paths` → `./ports` → `./schema` → `./sub-schemas`). After editing `store.ts` in any task, run `pnpm lint:fix` (biome `--write`) once before the bare `biome check` in `pnpm verify` — it auto-sorts imports so incremental additions self-heal. The `@megasaver/shared` import (`MemoryEntryId`, added in Task 10) goes in group (2), before the relative group.

---

## Task 1: Scaffold the leaf package

**Files:**
- Create: `packages/evidence-ledger/package.json`, `tsconfig.json`, `tsconfig.test.json`, `tsconfig.test-d.json`, `tsup.config.ts`, `vitest.config.ts`, `CHANGELOG.md`
- Create: `packages/evidence-ledger/src/index.ts` (placeholder)
- Create: `packages/evidence-ledger/test/dependency-graph.test.ts`

- [ ] **Step 1: Write the dependency-graph test (the failing test that locks the boundary)**

`packages/evidence-ledger/test/dependency-graph.test.ts`:

```typescript
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ALLOWED_DEPENDENCIES = ["@megasaver/shared", "zod"];

const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

describe("@megasaver/evidence-ledger dependency graph (cycle guard)", () => {
  it("declares exactly the allow-listed dependencies", () => {
    const deps = Object.keys(packageJson.dependencies ?? {}).sort();
    expect(deps).toEqual([...ALLOWED_DEPENDENCIES].sort());
  });

  it("does not depend on @megasaver/core", () => {
    expect(Object.keys(packageJson.dependencies ?? {})).not.toContain("@megasaver/core");
  });

  it("does not depend on @megasaver/content-store (decoupled via ChunkDeletePort)", () => {
    expect(Object.keys(packageJson.dependencies ?? {})).not.toContain("@megasaver/content-store");
  });

  it("does not pull @megasaver/core via devDependencies", () => {
    expect(Object.keys(packageJson.devDependencies ?? {})).not.toContain("@megasaver/core");
  });

  it("declares no @megasaver workspace package or connector outside the allow-list (incl. dev)", () => {
    const all = [
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
    ].filter((name) => name.startsWith("@megasaver/"));
    for (const dep of all) {
      expect(ALLOWED_DEPENDENCIES).toContain(dep);
    }
  });
});
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "@megasaver/evidence-ledger",
  "version": "0.1.0",
  "private": true,
  "description": "Canonical evidence ledger: schema, retention, revocation, and audit trail for Mega Saver context + save.",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "sideEffects": false,
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -b --noEmit",
    "clean": "rm -rf dist .turbo"
  },
  "dependencies": {
    "@megasaver/shared": "workspace:*",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/node": "^22.19.17"
  }
}
```

- [ ] **Step 3: Create the tsconfig + build/test configs** (copy content-store verbatim)

`tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist", "incremental": false, "composite": false },
  "include": ["src/**/*"],
  "exclude": ["test", "dist", "node_modules", ".turbo"]
}
```

`tsconfig.test.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "rootDir": ".", "noEmit": true, "composite": false, "declaration": false, "declarationMap": false },
  "include": ["src/**/*", "test/**/*"]
}
```

`tsconfig.test-d.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "noEmit": true,
    "composite": false,
    "declaration": false,
    "declarationMap": false,
    "noPropertyAccessFromIndexSignature": false
  },
  "include": ["src/**/*", "test/**/*.test-d.ts"],
  "exclude": ["dist", "node_modules", ".turbo"]
}
```

`tsup.config.ts`:
```typescript
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2023",
});
```

`vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ["test/**/*.test.ts", "test/**/*.test-d.ts"],
    typecheck: {
      enabled: true,
      include: ["test/**/*.test-d.ts"],
      tsconfig: "./tsconfig.test-d.json",
    },
  },
});
```

`CHANGELOG.md`:
```markdown
# @megasaver/evidence-ledger
```

- [ ] **Step 4: Create placeholder `src/index.ts`**

```typescript
export {};
```

- [ ] **Step 5: Install + run the dependency-graph test**

Run: `pnpm install && pnpm --filter @megasaver/evidence-ledger test`
Expected: PASS (5/5).

- [ ] **Step 6: Commit**

```bash
git add packages/evidence-ledger pnpm-lock.yaml
git commit -m "feat(evidence-ledger): scaffold leaf package + dependency guard"
```

---

## Task 2: Enum schemas

**Files:** Create `src/enums.ts`; Test `test/enums.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import {
  evidenceStatusSchema,
  retentionClassSchema,
  revocationReasonSchema,
  sourceKindSchema,
  transitionKindSchema,
} from "../src/enums.js";

describe("evidence-ledger enums", () => {
  it("sourceKind accepts the seven canonical kinds", () => {
    for (const k of ["file", "command", "grep", "fetch", "hook", "manual", "agent_request"]) {
      expect(sourceKindSchema.safeParse(k).success).toBe(true);
    }
    expect(sourceKindSchema.safeParse("socket").success).toBe(false);
  });

  it("retentionClass accepts the four classes", () => {
    for (const c of ["transient", "session", "pinned", "manual_hold"]) {
      expect(retentionClassSchema.safeParse(c).success).toBe(true);
    }
    expect(retentionClassSchema.safeParse("forever").success).toBe(false);
  });

  it("status accepts the three states", () => {
    for (const s of ["available", "retained_metadata_only", "revoked"]) {
      expect(evidenceStatusSchema.safeParse(s).success).toBe(true);
    }
    expect(evidenceStatusSchema.safeParse("deleted").success).toBe(false);
  });

  it("revocationReason is revoked-only and excludes retention_gc", () => {
    for (const r of ["secret_false_negative", "user_requested_purge", "policy_change"]) {
      expect(revocationReasonSchema.safeParse(r).success).toBe(true);
    }
    expect(revocationReasonSchema.safeParse("retention_gc").success).toBe(false);
  });

  it("transitionKind covers the lifecycle events", () => {
    for (const t of ["created", "pinned", "unpinned", "revoked", "raw_gc"]) {
      expect(transitionKindSchema.safeParse(t).success).toBe(true);
    }
    expect(transitionKindSchema.safeParse("approved").success).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`../src/enums.js` unresolved)

Run: `pnpm --filter @megasaver/evidence-ledger test enums`

- [ ] **Step 3: Create `src/enums.ts`**

```typescript
import { z } from "zod";

export const sourceKindSchema = z.enum([
  "file",
  "command",
  "grep",
  "fetch",
  "hook",
  "manual",
  "agent_request",
]);
export type SourceKind = z.infer<typeof sourceKindSchema>;

export const retentionClassSchema = z.enum(["transient", "session", "pinned", "manual_hold"]);
export type RetentionClass = z.infer<typeof retentionClassSchema>;

export const evidenceStatusSchema = z.enum(["available", "retained_metadata_only", "revoked"]);
export type EvidenceStatus = z.infer<typeof evidenceStatusSchema>;

// Revoked-only. GC produces `retained_metadata_only` WITHOUT a revocationReason,
// so `retention_gc` is intentionally NOT a member (spec §3 invariant).
export const revocationReasonSchema = z.enum([
  "secret_false_negative",
  "user_requested_purge",
  "policy_change",
]);
export type RevocationReason = z.infer<typeof revocationReasonSchema>;

export const transitionKindSchema = z.enum(["created", "pinned", "unpinned", "revoked", "raw_gc"]);
export type TransitionKind = z.infer<typeof transitionKindSchema>;
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @megasaver/evidence-ledger test enums`

- [ ] **Step 5: Commit**

```bash
git add packages/evidence-ledger/src/enums.ts packages/evidence-ledger/test/enums.test.ts
git commit -m "feat(evidence-ledger): canonical enums"
```

---

## Task 3: Sub-schemas (sourceRef, scrubbed form, sessionRef, redactionReport, returnedChunkRef, transition)

**Files:** Create `src/sub-schemas.ts`; Test `test/schema.test.ts` (first block)

- [ ] **Step 1: Write the failing test** — new `test/schema.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  isScrubbedSourceRef,
  redactionReportSchema,
  returnedChunkRefSchema,
  scrubSourceRef,
  sessionRefSchema,
  sourceRefSchema,
  transitionSchema,
} from "../src/sub-schemas.js";

describe("evidence-ledger sub-schemas", () => {
  it("sourceRef accepts a partial structured label and rejects unknown keys", () => {
    expect(sourceRefSchema.safeParse({ path: "src/a.ts" }).success).toBe(true);
    expect(sourceRefSchema.safeParse({ command: "git", args: ["log"] }).success).toBe(true);
    expect(sourceRefSchema.safeParse({ hookTool: "Bash" }).success).toBe(true);
    expect(sourceRefSchema.safeParse({ bogus: 1 }).success).toBe(false);
  });

  it("scrubSourceRef drops secret-bearing fields and keeps only a label", () => {
    const scrubbed = scrubSourceRef({
      command: "curl -H 'Authorization: Bearer sk-live-XYZ' https://api/x",
      args: ["--secret", "abc"],
      url: "https://h/cb?token=SECRET",
      path: "/etc/shadow",
      query: "password=hunter2",
      label: "git-log",
    });
    expect(scrubbed).toEqual({ label: "redacted" });
    expect(isScrubbedSourceRef(scrubbed)).toBe(true);
  });

  it("isScrubbedSourceRef rejects a ref that still carries secret-bearing fields", () => {
    expect(isScrubbedSourceRef({ command: "git log" })).toBe(false);
    expect(isScrubbedSourceRef({ url: "https://x" })).toBe(false);
    expect(isScrubbedSourceRef({ label: "ok" })).toBe(true);
    expect(isScrubbedSourceRef({})).toBe(true);
  });

  it("sessionRef is a kind+id pair or null", () => {
    expect(sessionRefSchema.safeParse(null).success).toBe(true);
    expect(sessionRefSchema.safeParse({ kind: "durable", id: "s-1" }).success).toBe(true);
    expect(sessionRefSchema.safeParse({ kind: "other", id: "x" }).success).toBe(false);
    expect(sessionRefSchema.safeParse({ kind: "live", id: "" }).success).toBe(false);
  });

  it("redactionReport tracks unresolved high-risk findings", () => {
    expect(
      redactionReportSchema.safeParse({ redacted: true, highRiskFindings: 0, unresolvedHighRisk: false })
        .success,
    ).toBe(true);
    expect(
      redactionReportSchema.safeParse({ redacted: true, highRiskFindings: -1, unresolvedHighRisk: false })
        .success,
    ).toBe(false);
  });

  it("returnedChunkRef requires both ids", () => {
    expect(returnedChunkRefSchema.safeParse({ chunkSetId: "cs-1", chunkId: "0" }).success).toBe(true);
    expect(returnedChunkRefSchema.safeParse({ chunkSetId: "cs-1" }).success).toBe(false);
  });

  it("transition records an auditable event with an optional memoryId", () => {
    expect(
      transitionSchema.safeParse({ at: "2026-06-16T12:00:00.000Z", kind: "created", actor: "system" })
        .success,
    ).toBe(true);
    expect(
      transitionSchema.safeParse({
        at: "2026-06-16T12:00:00.000Z",
        kind: "pinned",
        actor: "system",
        memoryId: "00000000-0000-4000-8000-0000000000a1",
      }).success,
    ).toBe(true);
    expect(transitionSchema.safeParse({ at: "not-a-date", kind: "created" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`../src/sub-schemas.js` unresolved)

Run: `pnpm --filter @megasaver/evidence-ledger test schema`

- [ ] **Step 3: Create `src/sub-schemas.ts`**

```typescript
import { memoryEntryIdSchema } from "@megasaver/shared";
import { z } from "zod";
import { transitionKindSchema } from "./enums.js";

// Secret-bearing fields: command, args, url, query, path. `label` is a
// non-reversible human tag and is the only field allowed to survive a scrub.
export const sourceRefSchema = z
  .object({
    path: z.string().min(1),
    command: z.string().min(1),
    args: z.array(z.string()),
    query: z.string().min(1),
    url: z.string().min(1),
    hookTool: z.string().min(1),
    label: z.string().min(1),
  })
  .partial()
  .strict();
export type SourceRef = z.infer<typeof sourceRefSchema>;

const SECRET_BEARING_KEYS = ["path", "command", "args", "query", "url", "hookTool"] as const;

// A scrubbed sourceRef carries NONE of the secret-bearing fields (spec §4).
export function isScrubbedSourceRef(ref: SourceRef): boolean {
  return SECRET_BEARING_KEYS.every((k) => ref[k] === undefined);
}

export function scrubSourceRef(_ref: SourceRef): SourceRef {
  // Drop every secret-bearing field; keep a fixed non-reversible label.
  return { label: "redacted" };
}

export const sessionRefSchema = z
  .object({ kind: z.enum(["durable", "live"]), id: z.string().min(1) })
  .strict()
  .nullable();
export type SessionRef = z.infer<typeof sessionRefSchema>;

export const redactionReportSchema = z
  .object({
    redacted: z.boolean(),
    highRiskFindings: z.number().int().nonnegative(),
    unresolvedHighRisk: z.boolean(),
  })
  .strict();
export type RedactionReport = z.infer<typeof redactionReportSchema>;

export const returnedChunkRefSchema = z
  .object({ chunkSetId: z.string().min(1), chunkId: z.string().min(1) })
  .strict();
export type ReturnedChunkRef = z.infer<typeof returnedChunkRefSchema>;

export const transitionSchema = z
  .object({
    at: z.string().datetime({ offset: true }),
    kind: transitionKindSchema,
    actor: z.enum(["system", "human"]).optional(),
    reason: z.string().min(1).optional(),
    memoryId: memoryEntryIdSchema.optional(),
  })
  .strict();
export type Transition = z.infer<typeof transitionSchema>;
```

- [ ] **Step 4: Run — expect PASS** (sub-schema block)

Run: `pnpm --filter @megasaver/evidence-ledger test schema`

- [ ] **Step 5: Commit**

```bash
git add packages/evidence-ledger/src/sub-schemas.ts packages/evidence-ledger/test/schema.test.ts
git commit -m "feat(evidence-ledger): sub-schemas + sourceRef scrub helpers"
```

---

## Task 4: Evidence record schema + invariants + input type

**Files:** Create `src/schema.ts`; extend `test/schema.test.ts`

- [ ] **Step 1: Write the failing test** — append to `test/schema.test.ts`:

```typescript
import { randomUUID } from "node:crypto";
import { type EvidenceRecord, evidenceRecordSchema } from "../src/schema.js";

function validRecord(over: Partial<EvidenceRecord> = {}): unknown {
  return {
    evidenceId: randomUUID(),
    workspaceKey: "0123456789abcdef",
    sessionRef: { kind: "durable", id: "s-1" },
    sourceKind: "command",
    sourceRef: { command: "git", args: ["log", "-p"] },
    classification: "generic_shell",
    redactionReport: { redacted: true, highRiskFindings: 0, unresolvedHighRisk: false },
    rawDigest: "a".repeat(64),
    returnedDigest: "b".repeat(64),
    redactedRawChunkSetId: "cs-1",
    returnedChunkRefs: [{ chunkSetId: "cs-1", chunkId: "0" }],
    createdAt: "2026-06-16T12:00:00.000Z",
    expiresAt: null,
    retentionClass: "session",
    pinnedByMemoryIds: [],
    status: "available",
    revokedAt: null,
    revocationReason: null,
    policyVersion: "1",
    pipelineVersion: "1",
    transitions: [{ at: "2026-06-16T12:00:00.000Z", kind: "created", actor: "system" }],
    ...over,
  };
}

describe("evidenceRecordSchema", () => {
  it("parses a well-formed available record", () => {
    expect(() => evidenceRecordSchema.parse(validRecord())).not.toThrow();
  });

  it("rejects unknown keys (.strict)", () => {
    expect(evidenceRecordSchema.safeParse({ ...(validRecord() as object), x: 1 }).success).toBe(false);
  });

  it("rejects an uppercase evidenceId (lowercase-uuid contract)", () => {
    expect(
      evidenceRecordSchema.safeParse(validRecord({ evidenceId: randomUUID().toUpperCase() as never })).success,
    ).toBe(false);
  });

  it("rejects a non-hex rawDigest", () => {
    expect(evidenceRecordSchema.safeParse(validRecord({ rawDigest: "xyz" as never })).success).toBe(false);
  });

  it("INVARIANT available => redactedRawChunkSetId present + digests present", () => {
    expect(
      evidenceRecordSchema.safeParse(validRecord({ status: "available", redactedRawChunkSetId: null })).success,
    ).toBe(false);
    expect(
      evidenceRecordSchema.safeParse(validRecord({ status: "available", rawDigest: null as never })).success,
    ).toBe(false);
  });

  it("INVARIANT retained_metadata_only => no raw chunk", () => {
    expect(
      evidenceRecordSchema.safeParse(
        validRecord({ status: "retained_metadata_only", redactedRawChunkSetId: null }),
      ).success,
    ).toBe(true);
    expect(
      evidenceRecordSchema.safeParse(
        validRecord({ status: "retained_metadata_only", redactedRawChunkSetId: "cs-1" }),
      ).success,
    ).toBe(false);
  });

  it("INVARIANT revoked => revokedAt + reason set, digests null, chunk null, sourceRef scrubbed, no pins", () => {
    const revoked = validRecord({
      status: "revoked",
      revokedAt: "2026-06-16T13:00:00.000Z",
      revocationReason: "secret_false_negative",
      rawDigest: null as never,
      returnedDigest: null as never,
      redactedRawChunkSetId: null,
      sourceRef: { label: "redacted" },
      pinnedByMemoryIds: [],
      retentionClass: "session",
    });
    expect(evidenceRecordSchema.safeParse(revoked).success).toBe(true);
    // revoked but sourceRef still carries a command → reject
    expect(
      evidenceRecordSchema.safeParse({
        ...(revoked as object),
        sourceRef: { command: "git log" },
      }).success,
    ).toBe(false);
    // revoked but rawDigest not nulled → reject
    expect(
      evidenceRecordSchema.safeParse({ ...(revoked as object), rawDigest: "a".repeat(64) }).success,
    ).toBe(false);
    // non-revoked but revocationReason set → reject
    expect(evidenceRecordSchema.safeParse(validRecord({ revocationReason: "policy_change" as never })).success).toBe(
      false,
    );
  });

  it("INVARIANT pinned => status available AND pinnedByMemoryIds non-empty", () => {
    const MEM = "00000000-0000-4000-8000-0000000000a1";
    expect(
      evidenceRecordSchema.safeParse(validRecord({ retentionClass: "pinned", pinnedByMemoryIds: [MEM] })).success,
    ).toBe(true);
    expect(
      evidenceRecordSchema.safeParse(validRecord({ retentionClass: "pinned", pinnedByMemoryIds: [] })).success,
    ).toBe(false);
    expect(
      evidenceRecordSchema.safeParse(
        validRecord({
          retentionClass: "pinned",
          pinnedByMemoryIds: [MEM],
          status: "retained_metadata_only",
          redactedRawChunkSetId: null,
        }),
      ).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`../src/schema.js` unresolved)

Run: `pnpm --filter @megasaver/evidence-ledger test schema`

- [ ] **Step 3: Create `src/schema.ts`**

```typescript
import { memoryEntryIdSchema, workspaceKeySchema } from "@megasaver/shared";
import { z } from "zod";
import {
  evidenceStatusSchema,
  retentionClassSchema,
  revocationReasonSchema,
  sourceKindSchema,
} from "./enums.js";
import {
  isScrubbedSourceRef,
  redactionReportSchema,
  returnedChunkRefSchema,
  sessionRefSchema,
  sourceRefSchema,
  transitionSchema,
} from "./sub-schemas.js";

const lowercaseUuid = z
  .string()
  .uuid()
  .refine((v) => v === v.toLowerCase(), "id must be lowercase");

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, "must be lowercase sha256 hex");

export const evidenceRecordSchema = z
  .object({
    evidenceId: lowercaseUuid,
    workspaceKey: workspaceKeySchema,
    sessionRef: sessionRefSchema,
    sourceKind: sourceKindSchema,
    sourceRef: sourceRefSchema,
    classification: z.string().min(1),
    redactionReport: redactionReportSchema,
    rawDigest: sha256Hex.nullable(),
    returnedDigest: sha256Hex.nullable(),
    redactedRawChunkSetId: z.string().min(1).nullable(),
    returnedChunkRefs: z.array(returnedChunkRefSchema),
    createdAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }).nullable(),
    retentionClass: retentionClassSchema,
    pinnedByMemoryIds: z.array(memoryEntryIdSchema),
    status: evidenceStatusSchema,
    revokedAt: z.string().datetime({ offset: true }).nullable(),
    revocationReason: revocationReasonSchema.nullable(),
    policyVersion: z.string().min(1),
    pipelineVersion: z.string().min(1),
    transitions: z.array(transitionSchema).min(1),
  })
  .strict()
  .superRefine((rec, ctx) => {
    const issue = (message: string, path: (string | number)[]): void => {
      ctx.addIssue({ code: "custom", message, path });
    };

    if (rec.status === "available") {
      if (rec.redactedRawChunkSetId === null) {
        issue("available evidence must reference a raw chunk set.", ["redactedRawChunkSetId"]);
      }
      if (rec.rawDigest === null || rec.returnedDigest === null) {
        issue("available evidence must carry both digests.", ["rawDigest"]);
      }
    }

    if (rec.status === "retained_metadata_only" && rec.redactedRawChunkSetId !== null) {
      issue("metadata-only evidence must not retain a raw chunk set reference.", ["redactedRawChunkSetId"]);
    }

    const isRevoked = rec.status === "revoked";
    if (isRevoked) {
      if (rec.revokedAt === null || rec.revocationReason === null) {
        issue("revoked evidence requires revokedAt and revocationReason.", ["revokedAt"]);
      }
      if (rec.rawDigest !== null || rec.returnedDigest !== null) {
        issue("revoked evidence must null both digests.", ["rawDigest"]);
      }
      if (rec.redactedRawChunkSetId !== null) {
        issue("revoked evidence must null the raw chunk reference.", ["redactedRawChunkSetId"]);
      }
      if (!isScrubbedSourceRef(rec.sourceRef)) {
        issue("revoked evidence must carry a scrubbed sourceRef.", ["sourceRef"]);
      }
      if (rec.pinnedByMemoryIds.length > 0 || rec.retentionClass === "pinned") {
        issue("revoked evidence must not be pinned.", ["retentionClass"]);
      }
    } else if (rec.revokedAt !== null || rec.revocationReason !== null) {
      issue("only revoked evidence may set revokedAt/revocationReason.", ["revocationReason"]);
    }

    if (rec.retentionClass === "pinned") {
      if (rec.status !== "available") {
        issue("pinned retention requires status available.", ["retentionClass"]);
      }
      if (rec.pinnedByMemoryIds.length === 0) {
        issue("pinned retention requires at least one pinnedByMemoryIds entry.", ["pinnedByMemoryIds"]);
      }
    }
  });

export type EvidenceRecord = z.infer<typeof evidenceRecordSchema>;

// Input accepted by appendEvidence. The caller supplies the POST-REDACTION
// content (the ledger computes digests over it — callers never pass digests),
// already-redacted sourceRef, and the chunk-set id it persisted to content-store.
// The ledger stamps status/transitions/lifecycle.
export type EvidenceRecordInput = Omit<
  EvidenceRecord,
  | "rawDigest"
  | "returnedDigest"
  | "status"
  | "revokedAt"
  | "revocationReason"
  | "transitions"
  | "pinnedByMemoryIds"
> & {
  redactedRawContent: string;
  redactedReturnedContent: string;
};
```

- [ ] **Step 4: Run — expect PASS** (all invariant cases)

Run: `pnpm --filter @megasaver/evidence-ledger test schema`

- [ ] **Step 5: Commit**

```bash
git add packages/evidence-ledger/src/schema.ts packages/evidence-ledger/test/schema.test.ts
git commit -m "feat(evidence-ledger): evidence record schema + revoke/pin invariants"
```

---

## Task 5: Backfill at the read boundary

**Files:** Create `src/backfill.ts`; Test `test/backfill.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { backfillEvidenceRecord } from "../src/backfill.js";
import { evidenceRecordSchema } from "../src/schema.js";

function preLifecycleRow(): Record<string, unknown> {
  return {
    evidenceId: randomUUID(),
    workspaceKey: "0123456789abcdef",
    sessionRef: null,
    sourceKind: "file",
    sourceRef: { path: "src/a.ts" },
    classification: "file",
    redactionReport: { redacted: true, highRiskFindings: 0, unresolvedHighRisk: false },
    rawDigest: "a".repeat(64),
    returnedDigest: "b".repeat(64),
    redactedRawChunkSetId: "cs-1",
    returnedChunkRefs: [],
    createdAt: "2026-06-16T12:00:00.000Z",
    expiresAt: null,
    retentionClass: "session",
    policyVersion: "1",
    pipelineVersion: "1",
  };
}

describe("backfillEvidenceRecord", () => {
  it("defaults lifecycle fields so a pre-lifecycle row loads as available", () => {
    const upgraded = evidenceRecordSchema.parse(backfillEvidenceRecord(preLifecycleRow()));
    expect(upgraded).toMatchObject({ status: "available", revokedAt: null, revocationReason: null, pinnedByMemoryIds: [] });
    expect(upgraded.transitions[0]).toMatchObject({ kind: "created", actor: "system" });
  });

  it("is idempotent for an already-complete record", () => {
    const full = backfillEvidenceRecord(preLifecycleRow());
    expect(backfillEvidenceRecord(full)).toEqual(full);
  });

  it("passes non-objects through unchanged", () => {
    expect(backfillEvidenceRecord(null)).toBe(null);
    expect(backfillEvidenceRecord(42)).toBe(42);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @megasaver/evidence-ledger test backfill`

- [ ] **Step 3: Create `src/backfill.ts`**

```typescript
// Read-boundary upgrade: rows written before the lifecycle fields existed get
// neutral defaults so existing on-disk evidence keeps loading. Mirrors the
// `backfillMemoryEntry` pattern in @megasaver/core.
export function backfillEvidenceRecord(raw: unknown): unknown {
  if (raw === null || typeof raw !== "object") {
    return raw;
  }
  const rec = raw as Record<string, unknown>;
  if ("status" in rec && "transitions" in rec && "pinnedByMemoryIds" in rec) {
    return rec;
  }
  const createdAt = typeof rec.createdAt === "string" ? rec.createdAt : undefined;
  return {
    ...rec,
    status: rec.status ?? "available",
    revokedAt: rec.revokedAt ?? null,
    revocationReason: rec.revocationReason ?? null,
    pinnedByMemoryIds: rec.pinnedByMemoryIds ?? [],
    transitions: rec.transitions ?? (createdAt ? [{ at: createdAt, kind: "created", actor: "system" }] : []),
  };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @megasaver/evidence-ledger test backfill`

- [ ] **Step 5: Commit**

```bash
git add packages/evidence-ledger/src/backfill.ts packages/evidence-ledger/test/backfill.test.ts
git commit -m "feat(evidence-ledger): read-boundary backfill"
```

---

## Task 6: Errors, digest helper, ChunkDeletePort

**Files:** Create `src/errors.ts`, `src/digest.ts`, `src/ports.ts`; Test `test/digest.test.ts`

- [ ] **Step 1: Write the failing test** (`test/digest.test.ts`)

```typescript
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { digestContent } from "../src/digest.js";

describe("digestContent", () => {
  it("produces lowercase sha256 hex over the given post-redaction text", () => {
    const text = "redacted output";
    expect(digestContent(text)).toBe(createHash("sha256").update(text, "utf8").digest("hex"));
    expect(digestContent(text)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    expect(digestContent("x")).toBe(digestContent("x"));
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @megasaver/evidence-ledger test digest`

- [ ] **Step 3: Create the three files**

`src/digest.ts`:
```typescript
import { createHash } from "node:crypto";

// The LEDGER computes digests over POST-REDACTION content (spec §3). Callers
// pass the redacted content via appendEvidence; they never supply a raw digest.
// Pre-redaction hashes are forbidden: they become equality/presence oracles.
export function digestContent(postRedactionText: string): string {
  return createHash("sha256").update(postRedactionText, "utf8").digest("hex");
}
```

`src/errors.ts`:
```typescript
import { z } from "zod";

export const evidenceLedgerErrorCodeSchema = z.enum([
  "not_found",
  "schema_invalid",
  "store_corrupt",
  "write_failed",
  "already_exists",
  "invalid_transition",
  "workspace_mismatch",
]);
export type EvidenceLedgerErrorCode = z.infer<typeof evidenceLedgerErrorCodeSchema>;

export class EvidenceLedgerError extends Error {
  readonly code: EvidenceLedgerErrorCode;
  constructor(code: EvidenceLedgerErrorCode, message?: string, options?: { cause?: unknown }) {
    super(message ?? code, options);
    this.name = "EvidenceLedgerError";
    this.code = code;
  }
}
```

`src/ports.ts`:
```typescript
// The ledger never imports @megasaver/content-store. Raw-chunk deletion is
// injected by the composer (core/context-gate), wired to content-store.deleteChunkSet.
// Best-effort: a missing chunk is not an error.
export type ChunkDeletePort = (chunkSetId: string) => Promise<void>;
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @megasaver/evidence-ledger test digest`

- [ ] **Step 5: Commit**

```bash
git add packages/evidence-ledger/src/errors.ts packages/evidence-ledger/src/digest.ts packages/evidence-ledger/src/ports.ts packages/evidence-ledger/test/digest.test.ts
git commit -m "feat(evidence-ledger): errors, ledger digest, chunk-delete port"
```

---

## Task 7: Paths + atomic write (no events sidecar)

**Files:** Create `src/atomic-write.ts`, `src/paths.ts`

- [ ] **Step 1: Copy `atomic-write.ts` from content-store, retargeting the error type**

`src/atomic-write.ts`:
```typescript
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { EvidenceLedgerError } from "./errors.js";

const IS_WIN32 = process.platform === "win32";

export function atomicWriteFile(filePath: string, content: string): void {
  const parentDir = dirname(filePath);
  const tempPath = join(parentDir, `.${randomUUID()}.tmp`);
  try {
    if (existsSync(parentDir) && lstatSync(parentDir).isSymbolicLink()) {
      throw new EvidenceLedgerError("write_failed", "Ledger write failed.");
    }
    mkdirSync(parentDir, { recursive: true });
    writeFileSync(tempPath, content);
    const tempFd = openSync(tempPath, "r+");
    try {
      fsyncSync(tempFd);
    } finally {
      closeSync(tempFd);
    }
    renameSync(tempPath, filePath);
    if (!IS_WIN32) {
      const dirFd = openSync(parentDir, "r");
      try {
        fsyncSync(dirFd);
      } finally {
        closeSync(dirFd);
      }
    }
  } catch (error) {
    try {
      rmSync(tempPath, { force: true });
    } catch {
      // Ignore cleanup failure; surface the original write error.
    }
    if (error instanceof EvidenceLedgerError) throw error;
    throw new EvidenceLedgerError("write_failed", "Ledger write failed.", { cause: error });
  }
}
```

- [ ] **Step 2: Create `src/paths.ts`** (records only — NO events path; `workspaceKey` is a plain string validated here)

```typescript
import { join } from "node:path";
import { workspaceKeySchema } from "@megasaver/shared";
import { EvidenceLedgerError } from "./errors.js";

export function assertSafeSegment(segment: string): void {
  if (
    segment.length === 0 ||
    segment === "." ||
    segment === ".." ||
    segment.includes("/") ||
    segment.includes("\\")
  ) {
    throw new EvidenceLedgerError("write_failed", `Unsafe path segment: ${segment}`);
  }
}

// Parse the workspaceKey at the IO boundary (spec §6): rejects anything that is
// not a 16-hex key, independent of TypeScript branding.
export function parseWorkspaceKey(workspaceKey: string): string {
  const result = workspaceKeySchema.safeParse(workspaceKey);
  if (!result.success) {
    throw new EvidenceLedgerError("schema_invalid", `Invalid workspaceKey: ${workspaceKey}`);
  }
  return result.data;
}

export function workspaceDir(storeRoot: string, workspaceKey: string): string {
  const key = parseWorkspaceKey(workspaceKey);
  assertSafeSegment(key);
  return join(storeRoot, "evidence", key);
}

export function recordPath(storeRoot: string, workspaceKey: string, evidenceId: string): string {
  assertSafeSegment(evidenceId);
  return join(workspaceDir(storeRoot, workspaceKey), `${evidenceId}.json`);
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @megasaver/evidence-ledger typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/evidence-ledger/src/atomic-write.ts packages/evidence-ledger/src/paths.ts
git commit -m "feat(evidence-ledger): record paths + boundary workspaceKey parse + atomic write"
```

---

## Task 8: appendEvidence (ledger-computed digests) + load + getEvidenceStatus

**Files:** Create `src/store.ts`; Test `test/store.test.ts`

- [ ] **Step 1: Write the failing test** (`test/store.test.ts`)

```typescript
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { digestContent } from "../src/digest.js";
import type { EvidenceRecordInput } from "../src/schema.js";
import { appendEvidence, getEvidenceStatus, loadEvidence } from "../src/store.js";

let storeRoot: string;
const workspaceKey = "0123456789abcdef";

function input(over: Partial<EvidenceRecordInput> = {}): EvidenceRecordInput {
  return {
    evidenceId: randomUUID(),
    workspaceKey,
    sessionRef: { kind: "durable", id: "s-1" },
    sourceKind: "command",
    sourceRef: { command: "git", args: ["log"] },
    classification: "generic_shell",
    redactionReport: { redacted: true, highRiskFindings: 0, unresolvedHighRisk: false },
    redactedRawContent: "redacted raw text",
    redactedReturnedContent: "redacted returned text",
    redactedRawChunkSetId: "cs-1",
    returnedChunkRefs: [{ chunkSetId: "cs-1", chunkId: "0" }],
    createdAt: "2026-06-16T12:00:00.000Z",
    expiresAt: null,
    retentionClass: "session",
    policyVersion: "1",
    pipelineVersion: "1",
    ...over,
  };
}

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "evidence-ledger-"));
});
afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

describe("appendEvidence / loadEvidence", () => {
  it("computes digests from the passed post-redaction content (caller supplies none)", async () => {
    const rec = input();
    await appendEvidence({ storeRoot, record: rec });
    const loaded = await loadEvidence({ storeRoot, workspaceKey, evidenceId: rec.evidenceId });
    expect(loaded.rawDigest).toBe(digestContent("redacted raw text"));
    expect(loaded.returnedDigest).toBe(digestContent("redacted returned text"));
    expect(loaded.status).toBe("available");
    expect(loaded.transitions).toHaveLength(1);
    expect(loaded.transitions[0]).toMatchObject({ kind: "created" });
  });

  it("getEvidenceStatus returns the current status", async () => {
    const rec = input();
    await appendEvidence({ storeRoot, record: rec });
    expect(await getEvidenceStatus({ storeRoot, workspaceKey, evidenceId: rec.evidenceId })).toBe("available");
  });

  it("append-only: appending the same evidenceId twice throws already_exists", async () => {
    const rec = input();
    await appendEvidence({ storeRoot, record: rec });
    await expect(appendEvidence({ storeRoot, record: rec })).rejects.toMatchObject({ code: "already_exists" });
  });

  it("rejects a retentionClass of pinned at append (pin only via pinEvidence)", async () => {
    await expect(
      appendEvidence({ storeRoot, record: input({ retentionClass: "pinned" }) }),
    ).rejects.toMatchObject({ code: "schema_invalid" });
  });

  it("rejects input whose redactionReport has unresolved high-risk findings", async () => {
    await expect(
      appendEvidence({
        storeRoot,
        record: input({ redactionReport: { redacted: true, highRiskFindings: 1, unresolvedHighRisk: true } }),
      }),
    ).rejects.toMatchObject({ code: "schema_invalid" });
  });

  it("loadEvidence on a missing id throws not_found", async () => {
    await expect(loadEvidence({ storeRoot, workspaceKey, evidenceId: randomUUID() })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("read asserts the loaded record's workspaceKey matches the requested one", async () => {
    const rec = input();
    await appendEvidence({ storeRoot, record: rec });
    // Reading the same id under a different (valid) workspace key must not return it.
    await expect(
      loadEvidence({ storeRoot, workspaceKey: "ffffffffffffffff", evidenceId: rec.evidenceId }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`../src/store.js` unresolved)

Run: `pnpm --filter @megasaver/evidence-ledger test store`

- [ ] **Step 3: Create `src/store.ts`** (single top-of-file import group)

```typescript
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { atomicWriteFile } from "./atomic-write.js";
import { backfillEvidenceRecord } from "./backfill.js";
import { digestContent } from "./digest.js";
import type { EvidenceStatus, RetentionClass, RevocationReason } from "./enums.js";
import { EvidenceLedgerError } from "./errors.js";
import { parseWorkspaceKey, recordPath } from "./paths.js";
import { type EvidenceRecord, type EvidenceRecordInput, evidenceRecordSchema } from "./schema.js";
import type { Transition } from "./sub-schemas.js";

function readRecord(storeRoot: string, workspaceKey: string, evidenceId: string): EvidenceRecord {
  const key = parseWorkspaceKey(workspaceKey);
  const path = recordPath(storeRoot, key, evidenceId);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new EvidenceLedgerError("not_found", "Evidence not found.");
  }
  let parsed: unknown;
  try {
    parsed = backfillEvidenceRecord(JSON.parse(text));
  } catch (cause) {
    throw new EvidenceLedgerError("store_corrupt", "Evidence record is corrupt.", { cause });
  }
  const result = evidenceRecordSchema.safeParse(parsed);
  if (!result.success) {
    throw new EvidenceLedgerError("store_corrupt", "Evidence record failed schema.", { cause: result.error });
  }
  // Cross-workspace confusion guard (spec §6): the path encodes the key, but a
  // misplaced record must never be served under the wrong workspace.
  if (result.data.workspaceKey !== key) {
    throw new EvidenceLedgerError("workspace_mismatch", "Record workspaceKey does not match path.");
  }
  return result.data;
}

function writeRecord(storeRoot: string, rec: EvidenceRecord): void {
  atomicWriteFile(recordPath(storeRoot, rec.workspaceKey, rec.evidenceId), JSON.stringify(rec, null, 2));
}

export async function appendEvidence(args: { storeRoot: string; record: EvidenceRecordInput }): Promise<void> {
  const { redactedRawContent, redactedReturnedContent, ...rest } = args.record;
  const created: Transition = { at: rest.createdAt, kind: "created", actor: "system" };
  const full: unknown = {
    ...rest,
    rawDigest: digestContent(redactedRawContent),
    returnedDigest: digestContent(redactedReturnedContent),
    status: "available",
    revokedAt: null,
    revocationReason: null,
    pinnedByMemoryIds: [],
    transitions: [created],
  };
  const result = evidenceRecordSchema.safeParse(full);
  if (!result.success) {
    throw new EvidenceLedgerError("schema_invalid", "Evidence input failed schema.", { cause: result.error });
  }
  // Fail closed: never persist evidence whose redaction left an unresolved
  // high-risk finding (the secret may still be present in chunk/sourceRef).
  if (result.data.redactionReport.unresolvedHighRisk) {
    throw new EvidenceLedgerError("schema_invalid", "Cannot persist evidence with unresolved high-risk findings.");
  }
  const path = recordPath(args.storeRoot, result.data.workspaceKey, result.data.evidenceId);
  if (existsSync(path)) {
    throw new EvidenceLedgerError("already_exists", "Evidence already exists (append-only).");
  }
  writeRecord(args.storeRoot, result.data);
}

export async function loadEvidence(args: {
  storeRoot: string;
  workspaceKey: string;
  evidenceId: string;
}): Promise<EvidenceRecord> {
  return readRecord(args.storeRoot, args.workspaceKey, args.evidenceId);
}

export async function getEvidenceStatus(args: {
  storeRoot: string;
  workspaceKey: string;
  evidenceId: string;
}): Promise<EvidenceStatus> {
  return (await loadEvidence(args)).status;
}
```

> Note: imports `readdirSync`, `RetentionClass`, `RevocationReason`, `Transition` are pulled in now (single group) so Tasks 9–12 add code, not imports.

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @megasaver/evidence-ledger test store`

- [ ] **Step 5: Commit**

```bash
git add packages/evidence-ledger/src/store.ts packages/evidence-ledger/test/store.test.ts
git commit -m "feat(evidence-ledger): append-only store, ledger-computed digests, workspace guard"
```

---

## Task 9: listEvidenceByWorkspace + filters

**Files:** Modify `src/store.ts`; extend `test/store.test.ts`

- [ ] **Step 1: Write the failing test** — append:

```typescript
import { listEvidenceByWorkspace } from "../src/store.js";

describe("listEvidenceByWorkspace", () => {
  it("lists newest-first and filters by status", async () => {
    const a = input({ createdAt: "2026-06-16T12:00:00.000Z" });
    const b = input({ createdAt: "2026-06-16T13:00:00.000Z" });
    await appendEvidence({ storeRoot, record: a });
    await appendEvidence({ storeRoot, record: b });
    const all = await listEvidenceByWorkspace({ storeRoot, workspaceKey });
    expect(all.map((r) => r.evidenceId)).toEqual([b.evidenceId, a.evidenceId]);
    expect(await listEvidenceByWorkspace({ storeRoot, workspaceKey, filters: { status: "available" } })).toHaveLength(2);
    expect(await listEvidenceByWorkspace({ storeRoot, workspaceKey, filters: { status: "revoked" } })).toHaveLength(0);
  });

  it("returns an empty array for an unknown workspace", async () => {
    expect(await listEvidenceByWorkspace({ storeRoot, workspaceKey: "ffffffffffffffff" })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`listEvidenceByWorkspace` not exported)

Run: `pnpm --filter @megasaver/evidence-ledger test store`

- [ ] **Step 3: Add to `src/store.ts`** (uses already-imported `readdirSync`, `workspaceDir`)

Add `workspaceDir` to the existing `./paths.js` import, then:
```typescript
export interface EvidenceFilters {
  status?: EvidenceStatus;
  retentionClass?: RetentionClass;
}

export async function listEvidenceByWorkspace(args: {
  storeRoot: string;
  workspaceKey: string;
  filters?: EvidenceFilters;
}): Promise<readonly EvidenceRecord[]> {
  const key = parseWorkspaceKey(args.workspaceKey);
  const dir = workspaceDir(args.storeRoot, key);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const records: EvidenceRecord[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const rec = readRecord(args.storeRoot, key, name.slice(0, -".json".length));
    if (args.filters?.status && rec.status !== args.filters.status) continue;
    if (args.filters?.retentionClass && rec.retentionClass !== args.filters.retentionClass) continue;
    records.push(rec);
  }
  records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return records;
}
```

(Update the `./paths.js` import line to: `import { parseWorkspaceKey, recordPath, workspaceDir } from "./paths.js";`)

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @megasaver/evidence-ledger test store`

- [ ] **Step 5: Commit**

```bash
git add packages/evidence-ledger/src/store.ts packages/evidence-ledger/test/store.test.ts
git commit -m "feat(evidence-ledger): list evidence by workspace with filters"
```

---

## Task 10: pinEvidence / unpinEvidence (session ⇄ pinned round-trip)

**Files:** Modify `src/store.ts`; extend `test/store.test.ts`

- [ ] **Step 1: Write the failing test** — append:

```typescript
import { memoryEntryIdSchema } from "@megasaver/shared";
import { pinEvidence, unpinEvidence } from "../src/store.js";

const MEM_ID = memoryEntryIdSchema.parse("00000000-0000-4000-8000-0000000000a1");

describe("pin / unpin (session <-> pinned)", () => {
  it("pin from session sets pinned + records memoryId on the transition", async () => {
    const rec = input();
    await appendEvidence({ storeRoot, record: rec });
    await pinEvidence({ storeRoot, workspaceKey, evidenceId: rec.evidenceId, memoryId: MEM_ID });
    const loaded = await loadEvidence({ storeRoot, workspaceKey, evidenceId: rec.evidenceId });
    expect(loaded.retentionClass).toBe("pinned");
    expect(loaded.pinnedByMemoryIds).toEqual([MEM_ID]);
    const last = loaded.transitions.at(-1);
    expect(last).toMatchObject({ kind: "pinned", memoryId: MEM_ID });
  });

  it("pin is idempotent for the same memory id", async () => {
    const rec = input();
    await appendEvidence({ storeRoot, record: rec });
    await pinEvidence({ storeRoot, workspaceKey, evidenceId: rec.evidenceId, memoryId: MEM_ID });
    await pinEvidence({ storeRoot, workspaceKey, evidenceId: rec.evidenceId, memoryId: MEM_ID });
    expect((await loadEvidence({ storeRoot, workspaceKey, evidenceId: rec.evidenceId })).pinnedByMemoryIds).toEqual([
      MEM_ID,
    ]);
  });

  it("unpin of the last memory returns retentionClass to session", async () => {
    const rec = input();
    await appendEvidence({ storeRoot, record: rec });
    await pinEvidence({ storeRoot, workspaceKey, evidenceId: rec.evidenceId, memoryId: MEM_ID });
    await unpinEvidence({ storeRoot, workspaceKey, evidenceId: rec.evidenceId, memoryId: MEM_ID });
    const loaded = await loadEvidence({ storeRoot, workspaceKey, evidenceId: rec.evidenceId });
    expect(loaded.pinnedByMemoryIds).toEqual([]);
    expect(loaded.retentionClass).toBe("session");
  });

  it("rejects pinning a non-session record (manual_hold)", async () => {
    const rec = input({ retentionClass: "manual_hold" });
    await appendEvidence({ storeRoot, record: rec });
    await expect(
      pinEvidence({ storeRoot, workspaceKey, evidenceId: rec.evidenceId, memoryId: MEM_ID }),
    ).rejects.toMatchObject({ code: "invalid_transition" });
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`pinEvidence`/`unpinEvidence` not exported)

Run: `pnpm --filter @megasaver/evidence-ledger test store`

- [ ] **Step 3: Add to `src/store.ts`** (add `MemoryEntryId` to the `@megasaver/shared` import — there is none yet, so add `import type { MemoryEntryId } from "@megasaver/shared";` to the top group)

```typescript
// Build the object once with conditional spread — assigning to an optional
// property after construction violates `exactOptionalPropertyTypes` (TS2412).
function nowTransition(
  kind: Transition["kind"],
  extra: { memoryId?: MemoryEntryId; reason?: string } = {},
): Transition {
  return {
    at: new Date().toISOString(),
    kind,
    actor: "system",
    ...(extra.memoryId !== undefined ? { memoryId: extra.memoryId } : {}),
    ...(extra.reason !== undefined ? { reason: extra.reason } : {}),
  };
}

export async function pinEvidence(args: {
  storeRoot: string;
  workspaceKey: string;
  evidenceId: string;
  memoryId: MemoryEntryId;
}): Promise<void> {
  const rec = await loadEvidence(args);
  if (rec.pinnedByMemoryIds.includes(args.memoryId)) return;
  // Pin is legal only from session (spec §5): keeps pin/unpin a clean round-trip.
  if (rec.retentionClass !== "session" || rec.status !== "available") {
    throw new EvidenceLedgerError("invalid_transition", "Pin is only legal from an available session record.");
  }
  const next = evidenceRecordSchema.parse({
    ...rec,
    retentionClass: "pinned",
    pinnedByMemoryIds: [...rec.pinnedByMemoryIds, args.memoryId],
    transitions: [...rec.transitions, nowTransition("pinned", { memoryId: args.memoryId })],
  });
  writeRecord(args.storeRoot, next);
}

export async function unpinEvidence(args: {
  storeRoot: string;
  workspaceKey: string;
  evidenceId: string;
  memoryId: MemoryEntryId;
}): Promise<void> {
  const rec = await loadEvidence(args);
  if (!rec.pinnedByMemoryIds.includes(args.memoryId)) return;
  const remaining = rec.pinnedByMemoryIds.filter((id) => id !== args.memoryId);
  const next = evidenceRecordSchema.parse({
    ...rec,
    retentionClass: remaining.length > 0 ? "pinned" : "session",
    pinnedByMemoryIds: remaining,
    transitions: [...rec.transitions, nowTransition("unpinned", { memoryId: args.memoryId })],
  });
  writeRecord(args.storeRoot, next);
}
```

> **WHY `new Date().toISOString()`:** transition timestamps are runtime audit stamps, not deterministic fixtures; tests assert `kind`/`memoryId`, not `at`. For the GC/revoke paths a logical clock is threaded in (Tasks 11–12) so the audit `at` equals the decision time.

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @megasaver/evidence-ledger test store`

- [ ] **Step 5: Commit**

```bash
git add packages/evidence-ledger/src/store.ts packages/evidence-ledger/test/store.test.ts
git commit -m "feat(evidence-ledger): pin/unpin session round-trip with audit transitions"
```

---

## Task 11: revokeEvidence (tombstone-before-delete, scrub, null digests) + explainEvidence

**Files:** Modify `src/store.ts`; extend `test/store.test.ts`

- [ ] **Step 1: Write the failing test** — append. **These tests prove the package's reason to exist: a planted secret is gone after revoke.**

```typescript
import { explainEvidence, revokeEvidence } from "../src/store.js";

describe("revoke / explain (secret purge)", () => {
  it("PURGES a planted secret from sourceRef, nulls digests, drops the chunk ref, calls delete port", async () => {
    const rec = input({
      sourceRef: { command: "curl -H 'Authorization: Bearer sk-live-SECRET' https://api/x", url: "https://h?token=SECRET" },
      redactedRawChunkSetId: "cs-9",
    });
    await appendEvidence({ storeRoot, record: rec });
    const deleted: string[] = [];
    await revokeEvidence({
      storeRoot,
      workspaceKey,
      evidenceId: rec.evidenceId,
      reason: "secret_false_negative",
      deleteChunk: async (id) => {
        deleted.push(id);
      },
      now: new Date("2026-06-16T13:00:00.000Z"),
    });
    const loaded = await loadEvidence({ storeRoot, workspaceKey, evidenceId: rec.evidenceId });
    expect(loaded.status).toBe("revoked");
    expect(loaded.revocationReason).toBe("secret_false_negative");
    expect(loaded.revokedAt).toBe("2026-06-16T13:00:00.000Z");
    expect(loaded.rawDigest).toBeNull();
    expect(loaded.returnedDigest).toBeNull();
    expect(loaded.redactedRawChunkSetId).toBeNull();
    // The secret is GONE from the on-disk record entirely.
    expect(loaded.sourceRef).toEqual({ label: "redacted" });
    expect(JSON.stringify(loaded)).not.toContain("SECRET");
    expect(deleted).toEqual(["cs-9"]);
    expect(loaded.transitions.at(-1)).toMatchObject({ kind: "revoked" });
  });

  it("revoke of a pinned record clears pins and resets retentionClass off pinned", async () => {
    const rec = input();
    await appendEvidence({ storeRoot, record: rec });
    await pinEvidence({ storeRoot, workspaceKey, evidenceId: rec.evidenceId, memoryId: MEM_ID });
    await revokeEvidence({
      storeRoot,
      workspaceKey,
      evidenceId: rec.evidenceId,
      reason: "user_requested_purge",
      deleteChunk: async () => {},
      now: new Date("2026-06-16T14:00:00.000Z"),
    });
    const loaded = await loadEvidence({ storeRoot, workspaceKey, evidenceId: rec.evidenceId });
    expect(loaded.pinnedByMemoryIds).toEqual([]);
    expect(loaded.retentionClass).not.toBe("pinned");
  });

  it("swallows a failing delete port (best-effort) but still tombstones", async () => {
    const rec = input({ redactedRawChunkSetId: "cs-9" });
    await appendEvidence({ storeRoot, record: rec });
    await revokeEvidence({
      storeRoot,
      workspaceKey,
      evidenceId: rec.evidenceId,
      reason: "user_requested_purge",
      deleteChunk: async () => {
        throw new Error("disk gone");
      },
      now: new Date("2026-06-16T14:00:00.000Z"),
    });
    expect(await getEvidenceStatus({ storeRoot, workspaceKey, evidenceId: rec.evidenceId })).toBe("revoked");
  });

  it("revoke is idempotent", async () => {
    const rec = input();
    await appendEvidence({ storeRoot, record: rec });
    const run = () =>
      revokeEvidence({
        storeRoot,
        workspaceKey,
        evidenceId: rec.evidenceId,
        reason: "policy_change",
        deleteChunk: async () => {},
        now: new Date("2026-06-16T14:00:00.000Z"),
      });
    await run();
    await run();
    expect((await loadEvidence({ storeRoot, workspaceKey, evidenceId: rec.evidenceId })).status).toBe("revoked");
  });

  it("explain reports raw availability before and after revoke", async () => {
    const rec = input();
    await appendEvidence({ storeRoot, record: rec });
    expect(await explainEvidence({ storeRoot, workspaceKey, evidenceId: rec.evidenceId })).toMatchObject({
      status: "available",
      rawExpandable: true,
    });
    await revokeEvidence({
      storeRoot,
      workspaceKey,
      evidenceId: rec.evidenceId,
      reason: "secret_false_negative",
      deleteChunk: async () => {},
      now: new Date("2026-06-16T15:00:00.000Z"),
    });
    expect(await explainEvidence({ storeRoot, workspaceKey, evidenceId: rec.evidenceId })).toMatchObject({
      status: "revoked",
      rawExpandable: false,
      revocationReason: "secret_false_negative",
    });
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`revokeEvidence`/`explainEvidence` not exported)

Run: `pnpm --filter @megasaver/evidence-ledger test store`

- [ ] **Step 3: Add to `src/store.ts`** (add to the existing top imports: `scrubSourceRef` from `./sub-schemas.js`; `ChunkDeletePort` type from `./ports.js`)

```typescript
export async function revokeEvidence(args: {
  storeRoot: string;
  workspaceKey: string;
  evidenceId: string;
  reason: RevocationReason;
  deleteChunk: ChunkDeletePort;
  now: Date;
}): Promise<void> {
  const rec = await loadEvidence(args);
  if (rec.status === "revoked") return;
  const at = args.now.toISOString();
  // 1) Atomically tombstone FIRST (spec §4): null digests + chunk ref, scrub
  //    sourceRef, clear pins, reset retention off pinned. Fail-closed: worst
  //    case after this point is "revoked record, lingering chunk" (safe).
  const tombstone = evidenceRecordSchema.parse({
    ...rec,
    status: "revoked",
    rawDigest: null,
    returnedDigest: null,
    redactedRawChunkSetId: null,
    sourceRef: scrubSourceRef(rec.sourceRef),
    pinnedByMemoryIds: [],
    retentionClass: rec.retentionClass === "pinned" ? "session" : rec.retentionClass,
    revokedAt: at,
    revocationReason: args.reason,
    transitions: [...rec.transitions, { at, kind: "revoked", actor: "system", reason: args.reason }],
  });
  writeRecord(args.storeRoot, tombstone);
  // 2) Best-effort raw delete AFTER the tombstone is durable.
  if (rec.redactedRawChunkSetId !== null) {
    try {
      await args.deleteChunk(rec.redactedRawChunkSetId);
    } catch {
      // Best-effort; the tombstone already records the revocation.
    }
  }
}

export interface EvidenceExplanation {
  evidenceId: string;
  status: EvidenceStatus;
  rawExpandable: boolean;
  revocationReason: RevocationReason | null;
  policyVersion: string;
  pipelineVersion: string;
  createdAt: string;
}

export async function explainEvidence(args: {
  storeRoot: string;
  workspaceKey: string;
  evidenceId: string;
}): Promise<EvidenceExplanation> {
  const rec = await loadEvidence(args);
  return {
    evidenceId: rec.evidenceId,
    status: rec.status,
    rawExpandable: rec.status === "available" && rec.redactedRawChunkSetId !== null,
    revocationReason: rec.revocationReason,
    policyVersion: rec.policyVersion,
    pipelineVersion: rec.pipelineVersion,
    createdAt: rec.createdAt,
  };
}
```

- [ ] **Step 4: Run — expect PASS** (full store file, incl. the secret-purge assertions)

Run: `pnpm --filter @megasaver/evidence-ledger test store`

- [ ] **Step 5: Commit**

```bash
git add packages/evidence-ledger/src/store.ts packages/evidence-ledger/test/store.test.ts
git commit -m "feat(evidence-ledger): revoke tombstone-before-delete, scrub sourceRef, null digests"
```

---

## Task 12: gcEvidence (skip pinned + manual_hold; degrade to metadata-only)

**Files:** Modify `src/store.ts`; extend `test/store.test.ts`

- [ ] **Step 1: Write the failing test** — append:

```typescript
import { gcEvidence } from "../src/store.js";

describe("gcEvidence", () => {
  it("degrades expired transient/session available evidence to retained_metadata_only and deletes its chunk", async () => {
    const rec = input({ expiresAt: "2026-06-16T12:30:00.000Z", redactedRawChunkSetId: "cs-7" });
    await appendEvidence({ storeRoot, record: rec });
    const deleted: string[] = [];
    const res = await gcEvidence({
      storeRoot,
      workspaceKey,
      now: new Date("2026-06-16T13:00:00.000Z"),
      deleteChunk: async (id) => {
        deleted.push(id);
      },
    });
    expect(res.degraded).toBe(1);
    const loaded = await loadEvidence({ storeRoot, workspaceKey, evidenceId: rec.evidenceId });
    expect(loaded.status).toBe("retained_metadata_only");
    expect(loaded.redactedRawChunkSetId).toBeNull();
    expect(loaded.revocationReason).toBeNull(); // GC is NOT a revocation
    expect(loaded.transitions.at(-1)).toMatchObject({ kind: "raw_gc" });
    expect(deleted).toEqual(["cs-7"]);
  });

  it("pinned evidence survives ordinary GC", async () => {
    const rec = input({ expiresAt: "2026-06-16T12:30:00.000Z" });
    await appendEvidence({ storeRoot, record: rec });
    await pinEvidence({ storeRoot, workspaceKey, evidenceId: rec.evidenceId, memoryId: MEM_ID });
    const res = await gcEvidence({ storeRoot, workspaceKey, now: new Date("2026-06-16T13:00:00.000Z"), deleteChunk: async () => {} });
    expect(res.degraded).toBe(0);
    expect(await getEvidenceStatus({ storeRoot, workspaceKey, evidenceId: rec.evidenceId })).toBe("available");
  });

  it("manual_hold evidence survives ordinary GC", async () => {
    const rec = input({ retentionClass: "manual_hold", expiresAt: "2026-06-16T12:30:00.000Z" });
    await appendEvidence({ storeRoot, record: rec });
    const res = await gcEvidence({ storeRoot, workspaceKey, now: new Date("2026-06-16T13:00:00.000Z"), deleteChunk: async () => {} });
    expect(res.degraded).toBe(0);
    expect(await getEvidenceStatus({ storeRoot, workspaceKey, evidenceId: rec.evidenceId })).toBe("available");
  });

  it("not-yet-expired and null-expiry evidence is left intact", async () => {
    await appendEvidence({ storeRoot, record: input({ expiresAt: null }) });
    await appendEvidence({ storeRoot, record: input({ expiresAt: "2026-06-16T23:59:00.000Z" }) });
    const res = await gcEvidence({ storeRoot, workspaceKey, now: new Date("2026-06-16T13:00:00.000Z"), deleteChunk: async () => {} });
    expect(res.degraded).toBe(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`gcEvidence` not exported)

Run: `pnpm --filter @megasaver/evidence-ledger test store`

- [ ] **Step 3: Add to `src/store.ts`**

```typescript
export async function gcEvidence(args: {
  storeRoot: string;
  workspaceKey: string;
  now: Date;
  deleteChunk: ChunkDeletePort;
}): Promise<{ degraded: number }> {
  const all = await listEvidenceByWorkspace({ storeRoot: args.storeRoot, workspaceKey: args.workspaceKey });
  const at = args.now.toISOString();
  let degraded = 0;
  for (const rec of all) {
    if (rec.status !== "available") continue;
    // GC exemptions (spec §5): pinned and manual_hold survive ordinary GC.
    if (rec.retentionClass === "pinned" || rec.retentionClass === "manual_hold") continue;
    if (rec.expiresAt === null) continue;
    if (new Date(rec.expiresAt).getTime() > args.now.getTime()) continue;
    if (rec.redactedRawChunkSetId !== null) {
      try {
        await args.deleteChunk(rec.redactedRawChunkSetId);
      } catch {
        // Best-effort; still degrade the metadata below.
      }
    }
    const next = evidenceRecordSchema.parse({
      ...rec,
      status: "retained_metadata_only",
      redactedRawChunkSetId: null,
      transitions: [...rec.transitions, { at, kind: "raw_gc", actor: "system" }],
    });
    writeRecord(args.storeRoot, next);
    degraded += 1;
  }
  return { degraded };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @megasaver/evidence-ledger test store`

- [ ] **Step 5: Commit**

```bash
git add packages/evidence-ledger/src/store.ts packages/evidence-ledger/test/store.test.ts
git commit -m "feat(evidence-ledger): retention GC degrades to metadata-only, pins + manual_hold survive"
```

---

## Task 13: Public surface, changeset, full verify

**Files:** Modify `src/index.ts`; Create `test/index.test-d.ts`, `.changeset/evidence-ledger-init.md`

- [ ] **Step 1: Write the failing type-level surface test** (`test/index.test-d.ts`)

```typescript
import { expectTypeOf } from "vitest";
import * as ledger from "../src/index.js";
import type { EvidenceRecord, EvidenceRecordInput } from "../src/index.js";

expectTypeOf(ledger.appendEvidence).toBeFunction();
expectTypeOf(ledger.loadEvidence).toBeFunction();
expectTypeOf(ledger.getEvidenceStatus).toBeFunction();
expectTypeOf(ledger.listEvidenceByWorkspace).toBeFunction();
expectTypeOf(ledger.pinEvidence).toBeFunction();
expectTypeOf(ledger.unpinEvidence).toBeFunction();
expectTypeOf(ledger.revokeEvidence).toBeFunction();
expectTypeOf(ledger.explainEvidence).toBeFunction();
expectTypeOf(ledger.gcEvidence).toBeFunction();
expectTypeOf(ledger.evidenceRecordSchema).not.toBeNever();
expectTypeOf<EvidenceRecord>().toHaveProperty("evidenceId");
// The input type has NO digest fields — callers cannot supply digests (spec §3).
expectTypeOf<EvidenceRecordInput>().not.toHaveProperty("rawDigest");
expectTypeOf<EvidenceRecordInput>().toHaveProperty("redactedRawContent");
```

- [ ] **Step 2: Run typecheck — expect FAIL** (`src/index.ts` still `export {}`)

Run: `pnpm --filter @megasaver/evidence-ledger test`

- [ ] **Step 3: Replace `src/index.ts`**

```typescript
export {
  sourceKindSchema,
  retentionClassSchema,
  evidenceStatusSchema,
  revocationReasonSchema,
  transitionKindSchema,
  type SourceKind,
  type RetentionClass,
  type EvidenceStatus,
  type RevocationReason,
  type TransitionKind,
} from "./enums.js";

export {
  sourceRefSchema,
  sessionRefSchema,
  redactionReportSchema,
  returnedChunkRefSchema,
  transitionSchema,
  scrubSourceRef,
  isScrubbedSourceRef,
  type SourceRef,
  type SessionRef,
  type RedactionReport,
  type ReturnedChunkRef,
  type Transition,
} from "./sub-schemas.js";

export { evidenceRecordSchema, type EvidenceRecord, type EvidenceRecordInput } from "./schema.js";
export { backfillEvidenceRecord } from "./backfill.js";
export { digestContent } from "./digest.js";
export {
  EvidenceLedgerError,
  evidenceLedgerErrorCodeSchema,
  type EvidenceLedgerErrorCode,
} from "./errors.js";
export type { ChunkDeletePort } from "./ports.js";

export {
  appendEvidence,
  loadEvidence,
  getEvidenceStatus,
  listEvidenceByWorkspace,
  pinEvidence,
  unpinEvidence,
  revokeEvidence,
  explainEvidence,
  gcEvidence,
  type EvidenceFilters,
  type EvidenceExplanation,
} from "./store.js";
```

- [ ] **Step 4: Create the changeset** (`.changeset/evidence-ledger-init.md`)

```markdown
---
"@megasaver/evidence-ledger": minor
---

Add @megasaver/evidence-ledger: canonical evidence schema with revoke/pin
invariants, append-only store with in-record audit transitions, ledger-computed
post-redaction digests, pin/unpin session round-trip, best-effort revocation
(tombstone-before-delete: null digests + null chunk ref + scrubbed sourceRef +
cleared pins, then ChunkDeletePort delete), and retention GC that degrades to
metadata-only while exempting pinned + manual_hold. No @megasaver/core or
content-store dependency.
```

- [ ] **Step 5: Package verify**

Run: `pnpm --filter @megasaver/evidence-ledger build && pnpm --filter @megasaver/evidence-ledger test && pnpm --filter @megasaver/evidence-ledger typecheck`
Expected: build emits `dist/`, all tests PASS, typecheck clean.

- [ ] **Step 6: Repo-wide gate**

Run: `pnpm verify`
Expected: PASS — lint (biome) + typecheck + test (incl. dependency-graph guard) + conventions:check. If biome flags formatting, run `pnpm lint:fix` and re-commit.

- [ ] **Step 7: Commit**

```bash
git add packages/evidence-ledger/src/index.ts packages/evidence-ledger/test/index.test-d.ts .changeset/evidence-ledger-init.md
git commit -m "feat(evidence-ledger): public surface + changeset"
```

---

## Self-Review (against interface spec cd6b634)

**Spec coverage:**
- §2 Package Boundary → Task 1 (deps `{shared, zod}`; dep-graph test forbids core + content-store + connectors). ✓
- §3 Canonical Schema → Tasks 2–4. Digests ledger-computed + nullable; `sourceRef` redaction is the caller's at append (boundary), ledger validates `redactionReport` and rejects unresolved high-risk; invariants (pinned⟹available+non-empty pins, revoked⟹nulls+scrub+no pins, revocationReason revoked-only). ✓
- §4 Revocation → Task 11. Tombstone BEFORE delete; null both digests; null chunk ref; scrub `sourceRef`; clear pins; reset retention; `transitions[]` only (no events sidecar). Secret-purge test asserts `JSON.stringify(record)` no longer contains the planted secret. ✓
- §5 Retention → Task 12. GC skips pinned + manual_hold; degrades only transient/session available; `raw_gc` transition, no revocationReason. Pin only from session; unpin → session (Task 10). ✓
- §6 API → Tasks 8–12 implement all eight functions. Boundary `workspaceKey` parse + record-match guard in `readRecord`. ✓
- §7 Atomicity → per-record atomic write; cross-store revoke ordered tombstone-first so the failure mode is safe. The two-step sidecar/approval protocol stays a consumer concern (noted). ✓
- §8 Testing → every listed test present: schema pins; digest computed + caller cannot supply (type test); append-time `sourceRef` redaction validated via redactionReport rejection; revoke purges planted secret + nulls digests; best-effort delete; GC metadata-only; pinned survives; manual_hold survives; revoke-of-pinned resets class; pin/unpin round-trip; dep-graph forbids core/connectors. ✓

**Placeholder scan:** none.

**Type consistency:** `EvidenceRecord`/`EvidenceRecordInput`, `ChunkDeletePort`, `RevocationReason`, `EvidenceStatus`, `Transition`, `MemoryEntryId` consistent across tasks. `workspaceKey` params are plain `string` everywhere (no branded mismatch). `appendEvidence` strips `redactedRawContent`/`redactedReturnedContent`, computes digests, stamps lifecycle — matches the `EvidenceRecordInput` type. Single top-of-file import group in `store.ts` (every later task adds code, not new import statements — explicit per-task import notes prevent scatter).

**Carried notes for later plans (not blockers):**
1. `ChunkDeletePort` → `content-store.deleteChunkSet` wiring is the ContextGate/core plan's job.
2. `appendEvidence` uses `existsSync` then write (check-then-act): low-risk for single-dev UUID ids; a future `wx`-exclusive create would harden it.
3. `sourceRef` redaction correctness ultimately rests on the caller's detector (the ledger has no policy dep by design); the ledger enforces the contract via `redactionReport` rejection + the revoke-time scrub.

---

## Execution Handoff

Plan revised and saved to `docs/superpowers/plans/2026-06-16-evidence-ledger.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review between tasks.

**2. Inline Execution** — `superpowers:executing-plans`, batch execution with checkpoints.

Which approach?
