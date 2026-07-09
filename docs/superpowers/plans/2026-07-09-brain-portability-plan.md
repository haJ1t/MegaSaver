# Brain Portability (E5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `mega brain export <project>` writes the knowledge layer (approved project-scoped memories, rules, failed attempts) to an integrity-hashed 2-line `.megabrain` file; `mega brain import <project> <file>` merges it with `approval="suggested"`.

**Architecture:** Core-owned module (`packages/core/src/brain-{bundle,export,import}.ts`) + thin gate-first CLI group (`apps/cli/src/commands/brain/`). Bundle = line 1 manifest JSON, line 2 payload JSON; `payloadSha256` = SHA-256 of raw payload-line bytes. Import goes only through `CoreRegistry` create APIs (json-directory-store is not public).

**Tech Stack:** TypeScript strict ESM, Zod 3, Vitest, citty, node:crypto.

**Spec:** `docs/superpowers/specs/2026-07-09-brain-portability-design.md` (risk HIGH — work in an isolated worktree, never on `main`).

---

### Task 0: Worktree

- [ ] **Step 1:** Use the `superpowers:using-git-worktrees` skill to create branch `feat/brain-portability` in an isolated worktree. All following tasks run there.

---

### Task 1: Entitlement key `brain-portability`

**Files:**
- Modify: `packages/entitlement/src/entitlement.ts:6`

The feature param is compile-time only (`checkEntitlement(_feature, ...)` ignores it at runtime), so this is a type-union widening; `pnpm typecheck` is the verification. No test file.

- [ ] **Step 1: Widen the union**

In `packages/entitlement/src/entitlement.ts` replace line 6:

```ts
export type ProFeature = "savings-analytics";
```

with:

```ts
export type ProFeature = "savings-analytics" | "brain-portability";
```

- [ ] **Step 2: Verify**

Run: `pnpm --filter @megasaver/entitlement typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add packages/entitlement/src/entitlement.ts
git commit -m "feat(entitlement): add brain-portability feature key"
```

---

### Task 2: `brain-bundle.ts` — schemas, serialize, parse, hash

**Files:**
- Create: `packages/core/src/brain-bundle.ts`
- Test: `packages/core/test/brain-bundle.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/test/brain-bundle.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { FailedAttempt } from "../src/failed-attempt.js";
import type { MemoryEntry } from "../src/memory-entry.js";
import type { ProjectRule } from "../src/project-rule.js";
import {
  BrainBundleError,
  type BrainManifest,
  type BrainPayload,
  parseBrainBundle,
  serializeBrainBundle,
} from "../src/brain-bundle.js";

const NOW = "2026-07-09T12:00:00.000Z";
const PROJECT_ID = "0f0e0d0c-0b0a-4900-8807-060504030201";

const memory: MemoryEntry = {
  id: "11111111-1111-4111-8111-111111111111",
  projectId: PROJECT_ID,
  sessionId: null,
  scope: "project",
  type: "decision",
  title: "Use NDJSON bundles",
  content: "Two-line NDJSON keeps payload hashing byte-exact.",
  keywords: ["ndjson"],
  confidence: "high",
  source: "manual",
  approval: "approved",
  stale: false,
  createdAt: NOW,
  updatedAt: NOW,
} as MemoryEntry;

const rule: ProjectRule = {
  id: "22222222-2222-4222-8222-222222222222",
  projectId: PROJECT_ID,
  title: "No raw logs",
  rule: "Never paste raw build logs into context.",
  appliesTo: [],
  evidence: [],
  severity: "warning",
  confidence: "high",
  createdFrom: "manual",
  createdAt: NOW,
  updatedAt: NOW,
} as ProjectRule;

const failure: FailedAttempt = {
  id: "33333333-3333-4333-8333-333333333333",
  projectId: PROJECT_ID,
  sessionId: null,
  task: "bundle import",
  failedStep: "hash check",
  relatedFiles: [],
  convertedToRule: false,
  createdAt: NOW,
} as FailedAttempt;

const payload: BrainPayload = { memories: [memory], rules: [rule], failures: [failure] };

function manifestFor(text: string): BrainManifest {
  return JSON.parse(text.slice(0, text.indexOf("\n"))) as BrainManifest;
}

describe("serializeBrainBundle", () => {
  it("produces two lines: manifest then payload", () => {
    const text = serializeBrainBundle({
      sourceProject: { id: PROJECT_ID, name: "alpha" },
      createdAt: NOW,
      redactionFindings: 0,
      payload,
    });
    const idx = text.indexOf("\n");
    expect(idx).toBeGreaterThan(0);
    const manifest = manifestFor(text);
    expect(manifest.schemaVersion).toBe("1");
    expect(manifest.kind).toBe("megabrain");
    expect(manifest.counts).toEqual({ memories: 1, rules: 1, failures: 1 });
    expect(manifest.payloadSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(text.slice(idx + 1))).toEqual(JSON.parse(JSON.stringify(payload)));
  });
});

describe("parseBrainBundle", () => {
  const text = serializeBrainBundle({
    sourceProject: { id: PROJECT_ID, name: "alpha" },
    createdAt: NOW,
    redactionFindings: 2,
    payload,
  });

  it("roundtrips a serialized bundle", () => {
    const parsed = parseBrainBundle(text);
    expect(parsed.manifest.sourceProject.name).toBe("alpha");
    expect(parsed.manifest.redactionFindings).toBe(2);
    expect(parsed.payload.memories[0]?.title).toBe("Use NDJSON bundles");
  });

  it("rejects a tampered payload byte with hash_mismatch", () => {
    const tampered = text.replace("byte-exact", "byte-exalt");
    expect(() => parseBrainBundle(tampered)).toThrowError(BrainBundleError);
    try {
      parseBrainBundle(tampered);
    } catch (error) {
      expect((error as BrainBundleError).code).toBe("hash_mismatch");
    }
  });

  it("rejects a missing newline with malformed", () => {
    try {
      parseBrainBundle("{}");
      expect.unreachable();
    } catch (error) {
      expect((error as BrainBundleError).code).toBe("malformed");
    }
  });

  it("rejects non-JSON manifest with malformed", () => {
    try {
      parseBrainBundle("not-json\n{}");
      expect.unreachable();
    } catch (error) {
      expect((error as BrainBundleError).code).toBe("malformed");
    }
  });

  it("rejects unknown schemaVersion with unsupported_version before schema errors", () => {
    const manifest = manifestFor(text);
    const future = { ...manifest, schemaVersion: "2", extraFutureField: true };
    const idx = text.indexOf("\n");
    try {
      parseBrainBundle(`${JSON.stringify(future)}\n${text.slice(idx + 1)}`);
      expect.unreachable();
    } catch (error) {
      expect((error as BrainBundleError).code).toBe("unsupported_version");
    }
  });

  it("rejects a manifest failing schema with malformed", () => {
    const manifest = manifestFor(text);
    const bad = { ...manifest, payloadSha256: "zzz" };
    const idx = text.indexOf("\n");
    try {
      parseBrainBundle(`${JSON.stringify(bad)}\n${text.slice(idx + 1)}`);
      expect.unreachable();
    } catch (error) {
      expect((error as BrainBundleError).code).toBe("malformed");
    }
  });

  it("rejects payload that fails entity schemas with malformed", () => {
    const rawPayload = JSON.stringify({ memories: [{ nope: true }], rules: [], failures: [] });
    const { createHash } = require("node:crypto") as typeof import("node:crypto");
    const sha = createHash("sha256").update(rawPayload, "utf8").digest("hex");
    const manifest = { ...manifestFor(text), payloadSha256: sha, counts: { memories: 1, rules: 0, failures: 0 } };
    try {
      parseBrainBundle(`${JSON.stringify(manifest)}\n${rawPayload}`);
      expect.unreachable();
    } catch (error) {
      expect((error as BrainBundleError).code).toBe("malformed");
    }
  });
});
```

- [ ] **Step 2: Run tests, verify FAIL**

Run: `pnpm --filter @megasaver/core exec vitest run test/brain-bundle.test.ts`
Expected: FAIL — `Cannot find module '../src/brain-bundle.js'`.

- [ ] **Step 3: Implement `packages/core/src/brain-bundle.ts`**

```ts
import { createHash } from "node:crypto";
import { z } from "zod";
import { failedAttemptSchema } from "./failed-attempt.js";
import { memoryEntrySchema } from "./memory-entry.js";
import { projectRuleSchema } from "./project-rule.js";

export const BRAIN_SCHEMA_VERSION = "1";

export type BrainBundleErrorCode = "malformed" | "hash_mismatch" | "unsupported_version";

export class BrainBundleError extends Error {
  readonly code: BrainBundleErrorCode;

  constructor(code: BrainBundleErrorCode, message: string) {
    super(message);
    this.name = "BrainBundleError";
    this.code = code;
  }
}

export const brainManifestSchema = z
  .object({
    schemaVersion: z.literal(BRAIN_SCHEMA_VERSION),
    kind: z.literal("megabrain"),
    sourceProject: z.object({ id: z.string().uuid(), name: z.string().trim().min(1) }).strict(),
    createdAt: z.string().datetime({ offset: true }),
    counts: z
      .object({
        memories: z.number().int().nonnegative(),
        rules: z.number().int().nonnegative(),
        failures: z.number().int().nonnegative(),
      })
      .strict(),
    payloadSha256: z.string().regex(/^[0-9a-f]{64}$/),
    redactionFindings: z.number().int().nonnegative(),
  })
  .strict();
export type BrainManifest = z.infer<typeof brainManifestSchema>;

export const brainPayloadSchema = z
  .object({
    memories: z.array(memoryEntrySchema),
    rules: z.array(projectRuleSchema),
    failures: z.array(failedAttemptSchema),
  })
  .strict();
export type BrainPayload = z.infer<typeof brainPayloadSchema>;

export type BrainBundle = { manifest: BrainManifest; payload: BrainPayload };

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function serializeBrainBundle(input: {
  sourceProject: { id: string; name: string };
  createdAt: string;
  redactionFindings: number;
  payload: BrainPayload;
}): string {
  const payloadRaw = JSON.stringify(input.payload);
  const manifest: BrainManifest = brainManifestSchema.parse({
    schemaVersion: BRAIN_SCHEMA_VERSION,
    kind: "megabrain",
    sourceProject: input.sourceProject,
    createdAt: input.createdAt,
    counts: {
      memories: input.payload.memories.length,
      rules: input.payload.rules.length,
      failures: input.payload.failures.length,
    },
    payloadSha256: sha256Hex(payloadRaw),
    redactionFindings: input.redactionFindings,
  });
  return `${JSON.stringify(manifest)}\n${payloadRaw}`;
}

export function parseBrainBundle(text: string): BrainBundle {
  const idx = text.indexOf("\n");
  if (idx === -1) {
    throw new BrainBundleError("malformed", "Bundle must contain a manifest line and a payload line.");
  }
  const manifestRaw = text.slice(0, idx);
  const payloadRaw = text.slice(idx + 1);

  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(manifestRaw);
  } catch {
    throw new BrainBundleError("malformed", "Bundle manifest is not valid JSON.");
  }
  const version = (manifestJson as { schemaVersion?: unknown }).schemaVersion;
  if (version !== BRAIN_SCHEMA_VERSION) {
    throw new BrainBundleError(
      "unsupported_version",
      `Bundle schemaVersion ${String(version)} is not supported; this build reads version ${BRAIN_SCHEMA_VERSION}. Upgrade mega.`,
    );
  }
  const manifestResult = brainManifestSchema.safeParse(manifestJson);
  if (!manifestResult.success) {
    throw new BrainBundleError("malformed", "Bundle manifest failed schema validation.");
  }
  const manifest = manifestResult.data;

  if (sha256Hex(payloadRaw) !== manifest.payloadSha256) {
    throw new BrainBundleError("hash_mismatch", "Bundle payload hash mismatch — file is corrupted or tampered.");
  }

  let payloadJson: unknown;
  try {
    payloadJson = JSON.parse(payloadRaw);
  } catch {
    throw new BrainBundleError("malformed", "Bundle payload is not valid JSON.");
  }
  const payloadResult = brainPayloadSchema.safeParse(payloadJson);
  if (!payloadResult.success) {
    throw new BrainBundleError("malformed", "Bundle payload failed schema validation.");
  }
  return { manifest, payload: payloadResult.data };
}
```

- [ ] **Step 4: Run tests, verify PASS**

Run: `pnpm --filter @megasaver/core exec vitest run test/brain-bundle.test.ts`
Expected: PASS (7 tests). Note: the `require("node:crypto")` in the payload-schema test needs `createRequire` in ESM — if it errors, replace those two lines with a top-level `import { createHash } from "node:crypto";` in the test file and use it directly.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/brain-bundle.ts packages/core/test/brain-bundle.test.ts
git commit -m "feat(core): brain bundle schema, serialize, parse"
```

---

### Task 3: `brain-export.ts` — assemble + redact

**Files:**
- Create: `packages/core/src/brain-export.ts`
- Test: `packages/core/test/brain-export.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/test/brain-export.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseBrainBundle } from "../src/brain-bundle.js";
import { exportBrain } from "../src/brain-export.js";
import type { MemoryEntry } from "../src/memory-entry.js";
import { createInMemoryCoreRegistry } from "../src/registry.js";

const NOW = "2026-07-09T12:00:00.000Z";

function seed() {
  const registry = createInMemoryCoreRegistry();
  const project = registry.createProject({
    id: "0f0e0d0c-0b0a-4900-8807-060504030201",
    name: "alpha",
    rootPath: "/tmp/alpha",
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
  const session = registry.createSession({
    id: "44444444-4444-4444-8444-444444444444",
    projectId: project.id,
    name: "s1",
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
  const base: Omit<MemoryEntry, "id" | "approval" | "scope" | "sessionId"> = {
    projectId: project.id,
    type: "decision",
    title: "t",
    content: "plain knowledge",
    keywords: [],
    confidence: "high",
    source: "manual",
    stale: false,
    createdAt: NOW,
    updatedAt: NOW,
  } as never;
  registry.createMemoryEntry({
    ...base,
    id: "11111111-1111-4111-8111-111111111111",
    scope: "project",
    sessionId: null,
    approval: "approved",
  } as MemoryEntry);
  registry.createMemoryEntry({
    ...base,
    id: "11111111-1111-4111-8111-111111111112",
    scope: "project",
    sessionId: null,
    approval: "suggested",
    content: "unreviewed knowledge",
  } as MemoryEntry);
  registry.createMemoryEntry({
    ...base,
    id: "11111111-1111-4111-8111-111111111113",
    scope: "session",
    sessionId: session.id,
    approval: "approved",
    content: "session-tied knowledge",
  } as MemoryEntry);
  registry.createMemoryEntry({
    ...base,
    id: "11111111-1111-4111-8111-111111111114",
    scope: "project",
    sessionId: null,
    approval: "approved",
    content: "token sk-ant-api03-abcdefghij0123456789 leaked here",
  } as MemoryEntry);
  return { registry, project };
}

describe("exportBrain", () => {
  it("exports approved project-scoped memories only", () => {
    const { registry, project } = seed();
    const text = exportBrain({ registry, projectId: project.id, createdAt: NOW });
    const { manifest, payload } = parseBrainBundle(text);
    expect(manifest.counts.memories).toBe(2);
    const contents = payload.memories.map((m) => m.content);
    expect(contents.some((c) => c.includes("unreviewed"))).toBe(false);
    expect(contents.some((c) => c.includes("session-tied"))).toBe(false);
  });

  it("redacts secrets in content and counts findings in the manifest", () => {
    const { registry, project } = seed();
    const text = exportBrain({ registry, projectId: project.id, createdAt: NOW });
    const { manifest, payload } = parseBrainBundle(text);
    expect(text.includes("sk-ant-api03-abcdefghij0123456789")).toBe(false);
    expect(manifest.redactionFindings).toBeGreaterThan(0);
    expect(payload.memories.every((m) => m.content.length > 0)).toBe(true);
  });

  it("names the source project in the manifest", () => {
    const { registry, project } = seed();
    const { manifest } = parseBrainBundle(
      exportBrain({ registry, projectId: project.id, createdAt: NOW }),
    );
    expect(manifest.sourceProject).toEqual({ id: project.id, name: "alpha" });
  });

  it("exports empty knowledge as empty arrays, not an error", () => {
    const registry = createInMemoryCoreRegistry();
    const project = registry.createProject({
      id: "0f0e0d0c-0b0a-4900-8807-060504030202",
      name: "empty",
      rootPath: "/tmp/empty",
      createdAt: NOW,
      updatedAt: NOW,
    } as never);
    const { manifest } = parseBrainBundle(
      exportBrain({ registry, projectId: project.id, createdAt: NOW }),
    );
    expect(manifest.counts).toEqual({ memories: 0, rules: 0, failures: 0 });
  });
});
```

Adjust the `sk-ant-...` fixture if the policy secret detectors use a different trigger pattern — pick any string `redactWithFindings` provably masks (check `packages/policy/src/redact.ts` detector list; a `-----BEGIN PRIVATE KEY-----` block is a safe fallback).

- [ ] **Step 2: Run tests, verify FAIL**

Run: `pnpm --filter @megasaver/core exec vitest run test/brain-export.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/core/src/brain-export.ts`**

```ts
import { redactWithFindings } from "@megasaver/policy";
import { type BrainPayload, serializeBrainBundle } from "./brain-bundle.js";
import type { FailedAttempt } from "./failed-attempt.js";
import type { MemoryEntry } from "./memory-entry.js";
import type { ProjectRule } from "./project-rule.js";
import type { CoreRegistry } from "./registry.js";
import type { ProjectId } from "@megasaver/shared";

export type ExportBrainInput = {
  registry: CoreRegistry;
  projectId: ProjectId;
  createdAt: string;
};

type Redactor = { total: number; text(value: string): string };

function makeRedactor(): Redactor {
  return {
    total: 0,
    text(value: string): string {
      const result = redactWithFindings(value);
      this.total += result.count;
      return result.redacted;
    },
  };
}

function redactMemory(entry: MemoryEntry, r: Redactor): MemoryEntry {
  return {
    ...entry,
    title: r.text(entry.title),
    content: r.text(entry.content),
    ...(entry.reason === undefined ? {} : { reason: r.text(entry.reason) }),
    ...(entry.goal === undefined ? {} : { goal: r.text(entry.goal) }),
    ...(entry.evidence === undefined ? {} : { evidence: entry.evidence.map((e) => r.text(e)) }),
  };
}

function redactRule(rule: ProjectRule, r: Redactor): ProjectRule {
  return {
    ...rule,
    title: r.text(rule.title),
    rule: r.text(rule.rule),
    evidence: rule.evidence.map((e) => r.text(e)),
  };
}

function redactFailure(failure: FailedAttempt, r: Redactor): FailedAttempt {
  return {
    ...failure,
    task: r.text(failure.task),
    failedStep: r.text(failure.failedStep),
    ...(failure.errorOutput === undefined ? {} : { errorOutput: r.text(failure.errorOutput) }),
    ...(failure.suspectedCause === undefined ? {} : { suspectedCause: r.text(failure.suspectedCause) }),
    ...(failure.resolution === undefined ? {} : { resolution: r.text(failure.resolution) }),
  };
}

export function exportBrain(input: ExportBrainInput): string {
  const project = input.registry.getProject(input.projectId);
  if (project === null) {
    throw new Error(`Project not found: ${input.projectId}`);
  }
  const r = makeRedactor();
  const payload: BrainPayload = {
    memories: input.registry
      .listMemoryEntries(input.projectId)
      .filter((m) => m.approval === "approved" && m.scope === "project")
      .map((m) => redactMemory(m, r)),
    rules: input.registry.listProjectRules(input.projectId).map((rule) => redactRule(rule, r)),
    failures: input.registry.listFailedAttempts(input.projectId).map((f) => redactFailure(f, r)),
  };
  return serializeBrainBundle({
    sourceProject: { id: project.id, name: project.name },
    createdAt: input.createdAt,
    redactionFindings: r.total,
    payload,
  });
}
```

- [ ] **Step 4: Run tests, verify PASS**

Run: `pnpm --filter @megasaver/core exec vitest run test/brain-export.test.ts`
Expected: PASS (4 tests). If the redaction fixture isn't masked, swap the fixture per Step 1 note — do NOT weaken the assertion.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/brain-export.ts packages/core/test/brain-export.test.ts
git commit -m "feat(core): exportBrain assembles redacted knowledge bundle"
```

---

### Task 4: `brain-import.ts` — verify + merge as suggested

**Files:**
- Create: `packages/core/src/brain-import.ts`
- Test: `packages/core/test/brain-import.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/test/brain-import.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { exportBrain } from "../src/brain-export.js";
import { importBrain } from "../src/brain-import.js";
import type { MemoryEntry } from "../src/memory-entry.js";
import { createInMemoryCoreRegistry, type CoreRegistry } from "../src/registry.js";

const NOW = "2026-07-09T12:00:00.000Z";
let seq = 0;
const newId = () => `aaaaaaaa-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

function makeProject(registry: CoreRegistry, id: string, name: string) {
  return registry.createProject({
    id,
    name,
    rootPath: `/tmp/${name}`,
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
}

function seedSource() {
  const registry = createInMemoryCoreRegistry();
  const project = makeProject(registry, "0f0e0d0c-0b0a-4900-8807-060504030201", "alpha");
  registry.createMemoryEntry({
    id: "11111111-1111-4111-8111-111111111111",
    projectId: project.id,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "t",
    content: "ndjson bundles",
    keywords: [],
    confidence: "high",
    source: "agent",
    approval: "approved",
    stale: false,
    createdAt: NOW,
    updatedAt: NOW,
    supersedesId: "11111111-1111-4111-8111-111111111110",
  } as MemoryEntry);
  registry.createProjectRule({
    id: "22222222-2222-4222-8222-222222222222",
    projectId: project.id,
    title: "no raw logs",
    rule: "Never paste raw build logs.",
    appliesTo: [],
    evidence: [],
    severity: "warning",
    confidence: "high",
    createdFrom: "manual",
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
  registry.createFailedAttempt({
    id: "33333333-3333-4333-8333-333333333333",
    projectId: project.id,
    sessionId: null,
    task: "import",
    failedStep: "hash",
    relatedFiles: [],
    convertedToRule: false,
    createdAt: NOW,
  } as never);
  return exportBrain({ registry, projectId: project.id, createdAt: NOW });
}

function targetRegistry() {
  const registry = createInMemoryCoreRegistry();
  const project = makeProject(registry, "0f0e0d0c-0b0a-4900-8807-060504030299", "beta");
  return { registry, project };
}

describe("importBrain", () => {
  it("imports memories as suggested with new ids, target projectId, provenance evidence, no supersedesId", () => {
    const bundleText = seedSource();
    const { registry, project } = targetRegistry();
    const report = importBrain({ registry, projectId: project.id, bundleText, newId });
    expect(report.imported).toEqual({ memories: 1, rules: 1, failures: 1 });
    const [m] = registry.listMemoryEntries(project.id);
    expect(m?.approval).toBe("suggested");
    expect(m?.projectId).toBe(project.id);
    expect(m?.id).not.toBe("11111111-1111-4111-8111-111111111111");
    expect(m?.source).toBe("agent");
    expect(m?.evidence).toContain("brain-import:alpha");
    expect(m?.supersedesId).toBeUndefined();
    const [rule] = registry.listProjectRules(project.id);
    expect(rule?.projectId).toBe(project.id);
    const [f] = registry.listFailedAttempts(project.id);
    expect(f?.sessionId).toBeNull();
  });

  it("skips exact duplicates and counts them", () => {
    const bundleText = seedSource();
    const { registry, project } = targetRegistry();
    importBrain({ registry, projectId: project.id, bundleText, newId });
    const report = importBrain({ registry, projectId: project.id, bundleText, newId });
    expect(report.imported).toEqual({ memories: 0, rules: 0, failures: 0 });
    expect(report.skipped).toEqual({ memories: 1, rules: 1, failures: 1 });
    expect(registry.listMemoryEntries(project.id)).toHaveLength(1);
  });

  it("propagates BrainBundleError on tampered payload without writing anything", () => {
    const bundleText = seedSource().replace("ndjson bundles", "ndjson bundlez");
    const { registry, project } = targetRegistry();
    expect(() => importBrain({ registry, projectId: project.id, bundleText, newId })).toThrowError(
      /hash mismatch|corrupted/i,
    );
    expect(registry.listMemoryEntries(project.id)).toHaveLength(0);
  });

  it("throws on unknown target project", () => {
    const bundleText = seedSource();
    const registry = createInMemoryCoreRegistry();
    expect(() =>
      importBrain({
        registry,
        projectId: "0f0e0d0c-0b0a-4900-8807-060504039999" as never,
        bundleText,
        newId,
      }),
    ).toThrowError(/not found/i);
  });
});
```

- [ ] **Step 2: Run tests, verify FAIL**

Run: `pnpm --filter @megasaver/core exec vitest run test/brain-import.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/core/src/brain-import.ts`**

```ts
import { failedAttemptIdSchema, memoryEntryIdSchema, projectRuleIdSchema } from "@megasaver/shared";
import type { ProjectId } from "@megasaver/shared";
import { type BrainBundle, parseBrainBundle } from "./brain-bundle.js";
import type { CoreRegistry } from "./registry.js";

export type ImportCounts = { memories: number; rules: number; failures: number };

export type ImportBrainReport = {
  sourceProject: { id: string; name: string };
  imported: ImportCounts;
  skipped: ImportCounts;
};

export type ImportBrainInput = {
  registry: CoreRegistry;
  projectId: ProjectId;
  bundleText: string;
  newId: () => string;
};

export function importBrain(input: ImportBrainInput): ImportBrainReport {
  const project = input.registry.getProject(input.projectId);
  if (project === null) {
    throw new Error(`Project not found: ${input.projectId}`);
  }
  const bundle: BrainBundle = parseBrainBundle(input.bundleText);
  const provenance = `brain-import:${bundle.manifest.sourceProject.name}`;

  const existingMemories = input.registry.listMemoryEntries(input.projectId);
  const existingRules = input.registry.listProjectRules(input.projectId);
  const existingFailures = input.registry.listFailedAttempts(input.projectId);
  const memoryKeys = new Set(existingMemories.map((m) => m.content));
  const ruleKeys = new Set(existingRules.map((r) => r.rule));
  const failureKeys = new Set(existingFailures.map((f) => `${f.task} ${f.failedStep}`));

  const imported: ImportCounts = { memories: 0, rules: 0, failures: 0 };
  const skipped: ImportCounts = { memories: 0, rules: 0, failures: 0 };

  for (const entry of bundle.payload.memories) {
    if (memoryKeys.has(entry.content)) {
      skipped.memories += 1;
      continue;
    }
    const { supersedesId: _dropped, ...rest } = entry;
    input.registry.createMemoryEntry({
      ...rest,
      id: memoryEntryIdSchema.parse(input.newId()),
      projectId: input.projectId,
      sessionId: null,
      scope: "project",
      approval: "suggested",
      evidence: [...(entry.evidence ?? []), provenance],
    });
    memoryKeys.add(entry.content);
    imported.memories += 1;
  }

  for (const rule of bundle.payload.rules) {
    if (ruleKeys.has(rule.rule)) {
      skipped.rules += 1;
      continue;
    }
    input.registry.createProjectRule({
      ...rule,
      id: projectRuleIdSchema.parse(input.newId()),
      projectId: input.projectId,
    });
    ruleKeys.add(rule.rule);
    imported.rules += 1;
  }

  for (const failure of bundle.payload.failures) {
    const key = `${failure.task} ${failure.failedStep}`;
    if (failureKeys.has(key)) {
      skipped.failures += 1;
      continue;
    }
    input.registry.createFailedAttempt({
      ...failure,
      id: failedAttemptIdSchema.parse(input.newId()),
      projectId: input.projectId,
      sessionId: null,
    });
    failureKeys.add(key);
    imported.failures += 1;
  }

  return { sourceProject: bundle.manifest.sourceProject, imported, skipped };
}
```

Note: bundle memories are project-scoped by construction (export filters), but a hand-crafted bundle could carry session scope — the remap above forces `scope: "project"`, `sessionId: null`, so the FK check cannot fire. If `memoryEntrySchema` in the bundle already rejected inconsistent scope/sessionId pairs, this is belt only, not belt-and-suspenders logic — keep it, it is the boundary.

- [ ] **Step 4: Run tests, verify PASS**

Run: `pnpm --filter @megasaver/core exec vitest run test/brain-import.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/brain-import.ts packages/core/test/brain-import.test.ts
git commit -m "feat(core): importBrain merges bundle as suggested entries"
```

---

### Task 5: Core public surface + full core suite

**Files:**
- Modify: `packages/core/src/index.ts` (append)

- [ ] **Step 1: Re-export**

Append to `packages/core/src/index.ts`:

```ts
export {
  BRAIN_SCHEMA_VERSION,
  BrainBundleError,
  type BrainBundle,
  type BrainBundleErrorCode,
  type BrainManifest,
  type BrainPayload,
  brainManifestSchema,
  brainPayloadSchema,
  parseBrainBundle,
  serializeBrainBundle,
} from "./brain-bundle.js";
export { type ExportBrainInput, exportBrain } from "./brain-export.js";
export {
  type ImportBrainInput,
  type ImportBrainReport,
  type ImportCounts,
  importBrain,
} from "./brain-import.js";
```

- [ ] **Step 2: Verify package green**

Run: `pnpm --filter @megasaver/core build && pnpm --filter @megasaver/core typecheck && pnpm --filter @megasaver/core test`
Expected: all exit 0, no existing test broken.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat(core): export brain portability public surface"
```

---

### Task 6: CLI `mega brain export`

**Files:**
- Create: `apps/cli/src/commands/brain/export.ts`
- Test: `apps/cli/test/commands/brain-export.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/cli/test/commands/brain-export.test.ts` (mirrors `alerts.test.ts` harness):

```ts
import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activateLicense } from "@megasaver/entitlement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BRAIN_EXPORT_UPSELL, runBrainExport } from "../../src/commands/brain/export.js";

type Payload = { v: number; tier: string; id: string; iat: number; exp: number | null };
const b64url = (buf: Buffer): string => buf.toString("base64url");
function signTestLicense(privateKey: KeyObject, payload: Payload): string {
  const bytes = Buffer.from(JSON.stringify(payload));
  return `msp_${b64url(bytes)}.${b64url(sign(null, bytes, privateKey))}`;
}

const NOW_MS = Date.UTC(2026, 6, 15, 12, 0, 0);
const now = () => NOW_MS;

let root: string;
let outDir: string;
let keys: ReturnType<typeof generateKeyPairSync>;
let out: string[];
let err: string[];
const stdout = (l: string) => out.push(l);
const stderr = (l: string) => err.push(l);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-cli-brain-"));
  outDir = mkdtempSync(join(tmpdir(), "megasaver-brain-out-"));
  keys = generateKeyPairSync("ed25519");
  out = [];
  err = [];
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outDir, { recursive: true, force: true });
});

function activatePro(): void {
  const key = signTestLicense(keys.privateKey, { v: 1, tier: "pro", id: "c1", iat: 0, exp: null });
  expect(activateLicense(root, key, { publicKey: keys.publicKey, now }).ok).toBe(true);
}

async function seedProject(name: string): Promise<void> {
  const { ensureStoreReady } = await import("../../src/store.js");
  const { registry } = await ensureStoreReady(root);
  registry.createProject({
    id: "0f0e0d0c-0b0a-4900-8807-060504030201",
    name,
    rootPath: "/tmp/alpha",
    createdAt: "2026-07-09T12:00:00.000Z",
    updatedAt: "2026-07-09T12:00:00.000Z",
  } as never);
}

function run(over: { project?: string; outPath?: string; json?: boolean } = {}) {
  const ensureStore = vi.fn(async () => {
    const { ensureStoreReady } = await import("../../src/store.js");
    return ensureStoreReady(root);
  });
  const code = runBrainExport({
    storeRoot: root,
    now,
    publicKey: keys.publicKey,
    projectName: over.project ?? "alpha",
    ...(over.outPath === undefined ? {} : { outPath: over.outPath }),
    json: over.json ?? false,
    ensureStore,
    stdout,
    stderr,
  });
  return { code, ensureStore };
}

describe("runBrainExport — gating", () => {
  it("free tier: upsell, exit 0, store never opened", async () => {
    const { code, ensureStore } = run();
    expect(await code).toBe(0);
    expect(out.join("\n")).toBe(BRAIN_EXPORT_UPSELL);
    expect(ensureStore).not.toHaveBeenCalled();
  });
});

describe("runBrainExport — entitled", () => {
  it("unknown project → stderr + exit 1", async () => {
    activatePro();
    const { code } = run({ project: "nope" });
    expect(await code).toBe(1);
    expect(err.join("\n")).toContain('project "nope" not found');
  });

  it("writes a parseable bundle to --out and reports counts", async () => {
    activatePro();
    await seedProject("alpha");
    const outPath = join(outDir, "alpha.megabrain");
    const { code } = run({ outPath });
    expect(await code).toBe(0);
    const text = readFileSync(outPath, "utf8");
    const { parseBrainBundle } = await import("@megasaver/core");
    const { manifest } = parseBrainBundle(text);
    expect(manifest.sourceProject.name).toBe("alpha");
    expect(out.join("\n")).toContain(outPath);
  });

  it("--json emits a stable object", async () => {
    activatePro();
    await seedProject("alpha");
    const outPath = join(outDir, "alpha.megabrain");
    const { code } = run({ outPath, json: true });
    expect(await code).toBe(0);
    const report = JSON.parse(out[0] as string);
    expect(report.status).toBe("exported");
    expect(report.path).toBe(outPath);
    expect(report.counts).toEqual({ memories: 0, rules: 0, failures: 0 });
  });

  it("default filename is <project>-<YYYYMMDD>.megabrain under cwd", async () => {
    activatePro();
    await seedProject("alpha");
    const { code } = run();
    expect(await code).toBe(0);
    expect(out.join("\n")).toContain("alpha-20260715.megabrain");
    rmSync(join(process.cwd(), "alpha-20260715.megabrain"), { force: true });
  });
});
```

- [ ] **Step 2: Run tests, verify FAIL**

Run: `pnpm --filter @megasaver/cli exec vitest run test/commands/brain-export.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `apps/cli/src/commands/brain/export.ts`**

```ts
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { KeyObject } from "node:crypto";
import type { EnsureStoreReadyResult } from "../../store.js";
import { checkEntitlement } from "@megasaver/entitlement";
import { defineCommand } from "citty";
import { projectNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { PRO_ANALYTICS_URL } from "../savings/index.js";

export const BRAIN_EXPORT_UPSELL = `Brain export is a Mega Saver Pro feature. Activate a key: mega license activate <key>. Learn more: ${PRO_ANALYTICS_URL}.`;

export type RunBrainExportInput = {
  storeRoot: string;
  now: () => number;
  publicKey?: KeyObject | string;
  projectName: string;
  outPath?: string;
  json: boolean;
  ensureStore: () => Promise<EnsureStoreReadyResult>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

function defaultFileName(projectName: string, nowMs: number): string {
  const d = new Date(nowMs);
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  return `${projectName}-${ymd}.megabrain`;
}

export async function runBrainExport(input: RunBrainExportInput): Promise<0 | 1> {
  const ent = checkEntitlement("brain-portability", {
    storeRoot: input.storeRoot,
    now: input.now,
    ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
  });
  if (!ent.entitled) {
    input.stdout(BRAIN_EXPORT_UPSELL);
    return 0;
  }

  // Lazy import after the gate: never load core on the free path.
  const { exportBrain, parseBrainBundle } = await import("@megasaver/core");
  const { registry } = await input.ensureStore();
  const project = registry.listProjects().find((p) => p.name === input.projectName);
  if (project === undefined) {
    const { message, exitCode } = projectNotFoundMessage(input.projectName);
    input.stderr(message);
    return exitCode as 1;
  }

  const text = exportBrain({
    registry,
    projectId: project.id,
    createdAt: new Date(input.now()).toISOString(),
  });
  const path = resolve(input.outPath ?? defaultFileName(input.projectName, input.now()));
  writeFileSync(path, text);
  const { manifest } = parseBrainBundle(text);

  if (input.json) {
    input.stdout(
      JSON.stringify({
        status: "exported",
        path,
        counts: manifest.counts,
        redactionFindings: manifest.redactionFindings,
      }),
    );
    return 0;
  }
  input.stdout(`exported ${path}`);
  input.stdout(
    `memories ${manifest.counts.memories} | rules ${manifest.counts.rules} | failures ${manifest.counts.failures} | redactions ${manifest.redactionFindings}`,
  );
  return 0;
}

export const brainExportCommand = defineCommand({
  meta: {
    name: "export",
    description: "Export the project knowledge layer to a .megabrain bundle (Mega Saver Pro).",
  },
  args: {
    projectName: { type: "positional", required: true, description: "Project name." },
    out: { type: "string", description: "Output file path (default <project>-<YYYYMMDD>.megabrain)." },
    json: { type: "boolean", default: false, description: "Emit the export report as JSON." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const storeInput = readStoreEnv(typeof args.store === "string" ? args.store : undefined);
    const storeRoot = resolveStorePath(storeInput);
    const code = await runBrainExport({
      storeRoot,
      now: () => Date.now(),
      projectName: String(args.projectName),
      ...(typeof args.out === "string" ? { outPath: args.out } : {}),
      json: !!args.json,
      ensureStore: () => ensureStoreReady(storeRoot),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

If `projectNotFoundMessage`'s `CliMessage` shape differs (check `apps/cli/src/errors.ts:50`), destructure accordingly — the contract is stderr line + exit 1.

- [ ] **Step 4: Run tests, verify PASS**

Run: `pnpm --filter @megasaver/cli exec vitest run test/commands/brain-export.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/brain/export.ts apps/cli/test/commands/brain-export.test.ts
git commit -m "feat(cli): mega brain export — gated bundle writer"
```

---

### Task 7: CLI `mega brain import`

**Files:**
- Create: `apps/cli/src/commands/brain/import.ts`
- Test: `apps/cli/test/commands/brain-import.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/cli/test/commands/brain-import.test.ts` (same harness as Task 6; new parts shown in full):

```ts
import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activateLicense } from "@megasaver/entitlement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BRAIN_IMPORT_UPSELL, runBrainImport } from "../../src/commands/brain/import.js";

type Payload = { v: number; tier: string; id: string; iat: number; exp: number | null };
const b64url = (buf: Buffer): string => buf.toString("base64url");
function signTestLicense(privateKey: KeyObject, payload: Payload): string {
  const bytes = Buffer.from(JSON.stringify(payload));
  return `msp_${b64url(bytes)}.${b64url(sign(null, bytes, privateKey))}`;
}
const NOW_MS = Date.UTC(2026, 6, 15, 12, 0, 0);
const now = () => NOW_MS;

let root: string;
let dir: string;
let keys: ReturnType<typeof generateKeyPairSync>;
let out: string[];
let err: string[];
const stdout = (l: string) => out.push(l);
const stderr = (l: string) => err.push(l);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-cli-brainimp-"));
  dir = mkdtempSync(join(tmpdir(), "megasaver-brainimp-files-"));
  keys = generateKeyPairSync("ed25519");
  out = [];
  err = [];
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

function activatePro(): void {
  const key = signTestLicense(keys.privateKey, { v: 1, tier: "pro", id: "c1", iat: 0, exp: null });
  expect(activateLicense(root, key, { publicKey: keys.publicKey, now }).ok).toBe(true);
}

async function seedTargetAndBundle(): Promise<string> {
  const { ensureStoreReady } = await import("../../src/store.js");
  const { exportBrain } = await import("@megasaver/core");
  const { registry } = await ensureStoreReady(root);
  const source = registry.createProject({
    id: "0f0e0d0c-0b0a-4900-8807-060504030201",
    name: "alpha",
    rootPath: "/tmp/alpha",
    createdAt: "2026-07-09T12:00:00.000Z",
    updatedAt: "2026-07-09T12:00:00.000Z",
  } as never);
  registry.createProject({
    id: "0f0e0d0c-0b0a-4900-8807-060504030299",
    name: "beta",
    rootPath: "/tmp/beta",
    createdAt: "2026-07-09T12:00:00.000Z",
    updatedAt: "2026-07-09T12:00:00.000Z",
  } as never);
  registry.createMemoryEntry({
    id: "11111111-1111-4111-8111-111111111111",
    projectId: source.id,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "t",
    content: "knowledge travels",
    keywords: [],
    confidence: "high",
    source: "manual",
    approval: "approved",
    stale: false,
    createdAt: "2026-07-09T12:00:00.000Z",
    updatedAt: "2026-07-09T12:00:00.000Z",
  } as never);
  const text = exportBrain({ registry, projectId: source.id, createdAt: "2026-07-09T12:00:00.000Z" });
  const file = join(dir, "alpha.megabrain");
  writeFileSync(file, text);
  return file;
}

function run(over: { project?: string; file: string; json?: boolean }) {
  const ensureStore = vi.fn(async () => {
    const { ensureStoreReady } = await import("../../src/store.js");
    return ensureStoreReady(root);
  });
  const code = runBrainImport({
    storeRoot: root,
    now,
    publicKey: keys.publicKey,
    projectName: over.project ?? "beta",
    filePath: over.file,
    json: over.json ?? false,
    ensureStore,
    stdout,
    stderr,
  });
  return { code, ensureStore };
}

describe("runBrainImport — gating", () => {
  it("free tier: upsell, exit 0, store never opened, file never read", async () => {
    const file = join(dir, "whatever.megabrain");
    const { code, ensureStore } = run({ file });
    expect(await code).toBe(0);
    expect(out.join("\n")).toBe(BRAIN_IMPORT_UPSELL);
    expect(ensureStore).not.toHaveBeenCalled();
  });
});

describe("runBrainImport — entitled", () => {
  it("imports a bundle and reports suggested-gate hint", async () => {
    activatePro();
    const file = await seedTargetAndBundle();
    const { code } = run({ file });
    expect(await code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("imported");
    expect(text).toContain("mega memory approve");
    const { ensureStoreReady } = await import("../../src/store.js");
    const { registry } = await ensureStoreReady(root);
    const beta = registry.listProjects().find((p) => p.name === "beta");
    const entries = registry.listMemoryEntries(beta?.id as never);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.approval).toBe("suggested");
  });

  it("--json emits imported/skipped counts", async () => {
    activatePro();
    const file = await seedTargetAndBundle();
    const { code } = run({ file, json: true });
    expect(await code).toBe(0);
    const report = JSON.parse(out[0] as string);
    expect(report.status).toBe("imported");
    expect(report.imported).toEqual({ memories: 1, rules: 0, failures: 0 });
    expect(report.skipped).toEqual({ memories: 0, rules: 0, failures: 0 });
  });

  it("tampered bundle → stderr corrupted + exit 1, nothing written", async () => {
    activatePro();
    const file = await seedTargetAndBundle();
    writeFileSync(file, readFileSync(file, "utf8").replace("knowledge travels", "knowledge travelz"));
    const { code } = run({ file });
    expect(await code).toBe(1);
    expect(err.join("\n")).toMatch(/corrupted or tampered/);
  });

  it("unsupported schemaVersion → stderr upgrade hint + exit 1", async () => {
    activatePro();
    const file = await seedTargetAndBundle();
    const text = readFileSync(file, "utf8");
    const idx = text.indexOf("\n");
    const manifest = JSON.parse(text.slice(0, idx));
    manifest.schemaVersion = "9";
    writeFileSync(file, `${JSON.stringify(manifest)}\n${text.slice(idx + 1)}`);
    const { code } = run({ file });
    expect(await code).toBe(1);
    expect(err.join("\n")).toMatch(/not supported.*Upgrade/);
  });

  it("missing file → stderr + exit 1", async () => {
    activatePro();
    const { code } = run({ file: join(dir, "absent.megabrain") });
    expect(await code).toBe(1);
    expect(err.join("\n")).toContain("cannot read bundle");
  });

  it("unknown project → stderr + exit 1", async () => {
    activatePro();
    const file = await seedTargetAndBundle();
    const { code } = run({ file, project: "nope" });
    expect(await code).toBe(1);
    expect(err.join("\n")).toContain('project "nope" not found');
  });
});
```

- [ ] **Step 2: Run tests, verify FAIL**

Run: `pnpm --filter @megasaver/cli exec vitest run test/commands/brain-import.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `apps/cli/src/commands/brain/import.ts`**

```ts
import { readFileSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { KeyObject } from "node:crypto";
import type { EnsureStoreReadyResult } from "../../store.js";
import { checkEntitlement } from "@megasaver/entitlement";
import { defineCommand } from "citty";
import { projectNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { PRO_ANALYTICS_URL } from "../savings/index.js";

export const BRAIN_IMPORT_UPSELL = `Brain import is a Mega Saver Pro feature. Activate a key: mega license activate <key>. Learn more: ${PRO_ANALYTICS_URL}.`;

const MAX_BUNDLE_BYTES = 100 * 1024 * 1024;

export type RunBrainImportInput = {
  storeRoot: string;
  now: () => number;
  publicKey?: KeyObject | string;
  projectName: string;
  filePath: string;
  json: boolean;
  /** Override for tests; defaults to crypto.randomUUID. */
  newId?: () => string;
  ensureStore: () => Promise<EnsureStoreReadyResult>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runBrainImport(input: RunBrainImportInput): Promise<0 | 1> {
  const ent = checkEntitlement("brain-portability", {
    storeRoot: input.storeRoot,
    now: input.now,
    ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
  });
  if (!ent.entitled) {
    input.stdout(BRAIN_IMPORT_UPSELL);
    return 0;
  }

  let bundleText: string;
  try {
    if (statSync(input.filePath).size > MAX_BUNDLE_BYTES) {
      input.stderr(`error: bundle exceeds ${MAX_BUNDLE_BYTES} bytes`);
      return 1;
    }
    bundleText = readFileSync(input.filePath, "utf8");
  } catch {
    input.stderr(`error: cannot read bundle at ${input.filePath}`);
    return 1;
  }

  // Lazy import after the gate.
  const { BrainBundleError, importBrain } = await import("@megasaver/core");
  const { registry } = await input.ensureStore();
  const project = registry.listProjects().find((p) => p.name === input.projectName);
  if (project === undefined) {
    const { message, exitCode } = projectNotFoundMessage(input.projectName);
    input.stderr(message);
    return exitCode as 1;
  }

  try {
    const report = importBrain({
      registry,
      projectId: project.id,
      bundleText,
      newId: input.newId ?? randomUUID,
    });
    if (input.json) {
      input.stdout(JSON.stringify({ status: "imported", ...report }));
      return 0;
    }
    input.stdout(
      `imported memories ${report.imported.memories} | rules ${report.imported.rules} | failures ${report.imported.failures} (skipped ${report.skipped.memories}/${report.skipped.rules}/${report.skipped.failures}) from ${report.sourceProject.name}`,
    );
    input.stdout("imported memories are suggested — run: mega memory approve");
    return 0;
  } catch (error) {
    if (error instanceof BrainBundleError) {
      input.stderr(`error: ${error.message}`);
      return 1;
    }
    throw error;
  }
}

export const brainImportCommand = defineCommand({
  meta: {
    name: "import",
    description: "Import a .megabrain bundle as suggested knowledge (Mega Saver Pro).",
  },
  args: {
    projectName: { type: "positional", required: true, description: "Target project name." },
    file: { type: "positional", required: true, description: "Path to the .megabrain bundle." },
    json: { type: "boolean", default: false, description: "Emit the import report as JSON." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const storeInput = readStoreEnv(typeof args.store === "string" ? args.store : undefined);
    const storeRoot = resolveStorePath(storeInput);
    const code = await runBrainImport({
      storeRoot,
      now: () => Date.now(),
      projectName: String(args.projectName),
      filePath: String(args.file),
      json: !!args.json,
      ensureStore: () => ensureStoreReady(storeRoot),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

- [ ] **Step 4: Run tests, verify PASS**

Run: `pnpm --filter @megasaver/cli exec vitest run test/commands/brain-import.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/brain/import.ts apps/cli/test/commands/brain-import.test.ts
git commit -m "feat(cli): mega brain import — gated suggested-merge"
```

---

### Task 8: `brain` group registration

**Files:**
- Create: `apps/cli/src/commands/brain/index.ts`
- Modify: `apps/cli/src/main.ts` (imports block + `subCommands`)
- Test: extend `apps/cli/test/commands/brain-export.test.ts` is NOT needed; registration is covered by the main help smoke below.

- [ ] **Step 1: Create `apps/cli/src/commands/brain/index.ts`**

```ts
import { defineCommand } from "citty";
import { brainExportCommand } from "./export.js";
import { brainImportCommand } from "./import.js";

export {
  BRAIN_EXPORT_UPSELL,
  type RunBrainExportInput,
  brainExportCommand,
  runBrainExport,
} from "./export.js";
export {
  BRAIN_IMPORT_UPSELL,
  type RunBrainImportInput,
  brainImportCommand,
  runBrainImport,
} from "./import.js";

export const brainCommand = defineCommand({
  meta: {
    name: "brain",
    description: "Portable project brain — export/import the knowledge layer (Mega Saver Pro).",
  },
  subCommands: {
    export: brainExportCommand,
    import: brainImportCommand,
  },
});
```

- [ ] **Step 2: Register in `apps/cli/src/main.ts`**

Add import (alphabetical near `benchCommand`):

```ts
import { brainCommand } from "./commands/brain/index.js";
```

Add to `subCommands` (after `bench:`):

```ts
    brain: brainCommand,
```

- [ ] **Step 3: Smoke-verify registration**

Run: `pnpm --filter @megasaver/cli build && node apps/cli/dist/main.js brain --help`
Expected: help text listing `export` and `import` subcommands, exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/commands/brain/index.ts apps/cli/src/main.ts
git commit -m "feat(cli): register mega brain command group"
```

---

### Task 9: Changeset, wiki, full verify, smoke evidence

**Files:**
- Create: `.changeset/brain-portability.md`
- Modify: `wiki/entities/cli.md`, `wiki/entities/core.md`, `wiki/syntheses/pro-differentiation-portfolio.md`, `wiki/index.md`, `wiki/log.md`

- [ ] **Step 1: Changeset**

Create `.changeset/brain-portability.md`:

```md
---
"@megasaver/cli": major
"@megasaver/core": minor
"@megasaver/entitlement": patch
---

`mega brain export <project>` / `mega brain import <project> <file>` — the
portable project brain (Mega Saver Pro). Export writes the knowledge layer
(approved project-scoped memories, rules, failed-attempt lessons) to a
2-line `.megabrain` bundle with a SHA-256 payload integrity hash and
firewall redaction (findings counted in the manifest). Import verifies the
hash, then merges everything as NEW entries with `approval: "suggested"` —
nothing activates until `mega memory approve`; exact duplicates are skipped
and counted. Core gains `exportBrain` / `importBrain` /
`parseBrainBundle` / `serializeBrainBundle`.
```

(`major` on cli = the 2.0 release trigger per the locked program.)

- [ ] **Step 2: Full verify**

Run: `pnpm verify`
Expected: lint + typecheck + all tests green. Fix anything red before proceeding (systematic-debugging skill on failures).

- [ ] **Step 3: Smoke evidence (capture terminal output)**

```bash
STORE=$(mktemp -d)
node apps/cli/dist/main.js project create alpha --store "$STORE"
node apps/cli/dist/main.js memory create alpha --content "prefer NDJSON bundles" --type decision --store "$STORE"
node apps/cli/dist/main.js brain export alpha --store "$STORE" --out /tmp/alpha.megabrain
node apps/cli/dist/main.js project create beta --store "$STORE"
node apps/cli/dist/main.js brain import beta /tmp/alpha.megabrain --store "$STORE"
node apps/cli/dist/main.js memory list beta --store "$STORE"
```

Expected: export prints counts; import prints `imported memories 1 ...` + approve hint; list shows the suggested entry. NOTE: without a Pro license in `$STORE` both brain commands print the upsell — activate a test license first or capture the upsell as the free-path evidence and run the entitled path through the vitest integration test output. Check exact `memory create`/`project create` flags with `--help` before running; adjust invocation, not expectations.

- [ ] **Step 4: Wiki updates**

Per §0: update `wiki/entities/cli.md` (brain group), `wiki/entities/core.md` (exportBrain/importBrain/bundle schema), `wiki/syntheses/pro-differentiation-portfolio.md` (E5 → shipped-in-progress status), `wiki/index.md` if cataloging changes, and append a timestamped `wiki/log.md` entry describing the feature + evidence.

- [ ] **Step 5: Commit**

```bash
git add .changeset/brain-portability.md wiki/
git commit -m "chore(release): brain portability changeset + wiki"
```

---

### Task 10: Review gates (HIGH risk — both reviewers)

- [ ] **Step 1:** `superpowers:requesting-code-review` — dispatch `code-reviewer` agent (fresh context) over the branch diff.
- [ ] **Step 2:** Dispatch `critic` agent (separate fresh context) — adversarial pass; mutation-test the dedupe keys, hash check, and gate-first invariants.
- [ ] **Step 3:** Address findings via `superpowers:receiving-code-review`; re-run `pnpm verify`.
- [ ] **Step 4:** `superpowers:finishing-a-development-branch` — PR to `main`, CI green, rebase-merge.

---

## Self-review notes (done at plan time)

- Spec coverage: §1 bundle → Task 2; §2 export → Tasks 3, 6; §3 import → Tasks 4, 7; §4 errors → Tasks 2, 4, 7 tests; §5 testing → every task + Task 9; entitlement → Task 1; registration → Task 8; changeset/wiki → Task 9; HIGH-risk reviews → Tasks 0, 10.
- Known soft spots an implementer must verify against reality (grounded from scouts, but double-check on first touch): `CliMessage` shape in `errors.ts:50`; the redaction fixture pattern actually caught by `packages/policy/src/redact.ts` detectors; `createSession` required fields in the Task 3 seed; `memory create` CLI flags in the Task 9 smoke. Adjust invocations, never expectations.
- Type consistency: `runBrainExport`/`runBrainImport` return `Promise<0 | 1>`; `ensureStore` returns `EnsureStoreReadyResult`; `newId` optional with `randomUUID` default — used consistently across Tasks 6-8.
