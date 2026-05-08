# Core Hardening (M3 + M4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add stale-lock detection (M3) and Unicode NFC normalization (M4) to `@megasaver/core`. Two cohesive correctness fixes shipped together: PID-in-lock-file recovery for `withDirLock`, plus parse-time `.transform(s => s.normalize("NFC"))` on `Project.name` and `Session.title`.

**Architecture:** All changes are inside `@megasaver/core`. M3 modifies `withDirLock` in `json-directory-registry.ts` and adds a private `isLockHolderAlive` helper. M4 adds `.transform()` to two existing Zod schemas. No new files created in `src/`. New test file added for registry-level migration coverage. Test count rises from 96 to 106.

**Tech Stack:** Node 22 LTS built-ins (`node:fs`, `node:process`), Zod string normalization (`String.prototype.normalize`), Vitest. No new external deps.

**Spec:** `docs/superpowers/specs/2026-05-08-core-hardening-m3-m4-design.md` (HIGH risk).

**Branch / worktree:** `feat/core-hardening-m3-m4` at `.worktrees/core-hardening-m3-m4`.

---

## Pre-flight

CWD for all commands: `/Users/halitozger/Desktop/MegaSaver/.worktrees/core-hardening-m3-m4`.

Per-package commands:
- test: `pnpm --filter @megasaver/core test`
- typecheck: `pnpm --filter @megasaver/core typecheck`
- workspace lint: `pnpm exec biome check`
- DoD gate: `pnpm verify`

---

## Task 1: M3 — Stale-lock detection

**Files:**
- Modify: `packages/core/src/json-directory-registry.ts:1-66` (extend `withDirLock` + add `isLockHolderAlive` private helper)
- Modify: `packages/core/test/json-directory-registry-lock.test.ts` (extend with 3 new cases — currently has 2 cases from PR #9 M1)

- [ ] **Step 1: Inspect current state**

```bash
grep -n "withDirLock\|isLockHolderAlive" packages/core/src/json-directory-registry.ts
wc -l packages/core/test/json-directory-registry-lock.test.ts
```

Expected: `withDirLock` defined; no `isLockHolderAlive` exists yet. Test file has 2 existing cases ("acquires + releases the .projects.lock", "surfaces store_write_failed when lock cannot be acquired").

- [ ] **Step 2: Write 3 failing tests**

Append to the existing `describe("createJsonDirectoryCoreRegistry — lock", ...)` block in `packages/core/test/json-directory-registry-lock.test.ts`:

```ts
it("recovers when a stale lock contains a dead PID", async () => {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(rootDir, ".projects.lock"), "99999999", "utf8");
  const registry = createJsonDirectoryCoreRegistry({ rootDir });
  const project = {
    id: projectIdSchema.parse("44444444-4444-4444-8444-444444444444"),
    name: "stale-recovery",
    rootPath: "/tmp/demo",
    createdAt: "2026-05-08T12:00:00.000Z",
    updatedAt: "2026-05-08T12:00:00.000Z",
  };
  const start = Date.now();
  registry.createProject(project);
  const elapsed = Date.now() - start;
  expect(elapsed).toBeLessThan(2000); // recovery is fast, well under the 5s timeout
  const { existsSync } = await import("node:fs");
  expect(existsSync(join(rootDir, ".projects.lock"))).toBe(false);
});

it("times out when the lock holder PID is alive", async () => {
  const { writeFile } = await import("node:fs/promises");
  // Current process is always alive; kill(0) succeeds.
  await writeFile(join(rootDir, ".projects.lock"), String(process.pid), "utf8");
  const registry = createJsonDirectoryCoreRegistry({ rootDir });
  const project = {
    id: projectIdSchema.parse("55555555-5555-4555-8555-555555555555"),
    name: "live-pid-block",
    rootPath: "/tmp/demo",
    createdAt: "2026-05-08T12:00:00.000Z",
    updatedAt: "2026-05-08T12:00:00.000Z",
  };
  const start = Date.now();
  let err: unknown;
  try {
    registry.createProject(project);
  } catch (e) {
    err = e;
  }
  const elapsed = Date.now() - start;
  expect(err).toBeDefined();
  expect((err as Error).constructor.name).toBe("CorePersistenceError");
  expect(elapsed).toBeGreaterThanOrEqual(4500); // approximate 5s timeout
}, 10000);

it("recovers when a stale lock has malformed payload", async () => {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(rootDir, ".projects.lock"), "not-a-number", "utf8");
  const registry = createJsonDirectoryCoreRegistry({ rootDir });
  const project = {
    id: projectIdSchema.parse("66666666-6666-4666-8666-666666666666"),
    name: "malformed-recovery",
    rootPath: "/tmp/demo",
    createdAt: "2026-05-08T12:00:00.000Z",
    updatedAt: "2026-05-08T12:00:00.000Z",
  };
  const start = Date.now();
  registry.createProject(project);
  const elapsed = Date.now() - start;
  expect(elapsed).toBeLessThan(2000);
});
```

If `projectIdSchema` and `createJsonDirectoryCoreRegistry` and `join` are not already imported in this test file, add them at the top:

```ts
import { join } from "node:path";
import { createJsonDirectoryCoreRegistry } from "../src/index.js";
import { projectIdSchema } from "@megasaver/shared";
```

(Verify against the existing imports before adding — they may already be present.)

- [ ] **Step 3: Run tests, expect 2 failures (the 2 new recovery tests)**

```bash
pnpm --filter @megasaver/core test -- json-directory-registry-lock
```

Expected: "recovers when a stale lock contains a dead PID" hits the 5s timeout (because current code does not detect dead PIDs). "recovers when a stale lock has malformed payload" same. "times out when the lock holder PID is alive" already passes (current behavior). The pre-existing 2 lock tests stay green.

- [ ] **Step 4: Implement PID write + isLockHolderAlive**

Edit `packages/core/src/json-directory-registry.ts`. First, extend the `node:fs` imports at the top of the file:

```ts
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
```

Replace the existing `withDirLock` function body. The whole function becomes:

```ts
function isLockHolderAlive(lockPath: string): boolean {
  let raw: string;
  try {
    raw = readFileSync(lockPath, "utf8");
  } catch {
    // Lock file vanished between EEXIST and read — treat as gone.
    return false;
  }
  const pid = Number.parseInt(raw.trim(), 10);
  if (!Number.isInteger(pid) || pid <= 0) {
    // Malformed payload — treat as stale.
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      return false; // confirmed dead
    }
    // EPERM (process exists but signal blocked) and other errors:
    // conservative "alive" — fall back to existing 5s timeout path.
    return true;
  }
}

// Single-developer scale: a .lock file in rootDir acts as a mutex for
// create operations that follow a read-check-write pattern (TOCTOU).
// PID is written into the lock file; a stale holder (crashed process)
// is detected via process.kill(pid, 0) and the lock is reclaimed.
function withDirLock<T>(rootDir: string, fn: () => T): T {
  const lockPath = path.join(rootDir, ".projects.lock");
  mkdirSync(rootDir, { recursive: true });
  const deadline = Date.now() + 5000; // 5s acquire timeout
  let fd: number | undefined;
  while (Date.now() < deadline) {
    try {
      fd = openSync(lockPath, "wx");
      writeSync(fd, String(process.pid));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw new CorePersistenceError("store_write_failed", "Failed to acquire registry lock.", {
          cause: error,
          filePath: lockPath,
        });
      }
      if (!isLockHolderAlive(lockPath)) {
        try {
          rmSync(lockPath, { force: true });
        } catch {}
        continue; // immediate retry, skip backoff
      }
      // Brief sync wait to avoid tight-spinning while lock is held.
      const buf = new Int32Array(new SharedArrayBuffer(4));
      Atomics.wait(buf, 0, 0, 50);
    }
  }
  if (fd === undefined) {
    throw new CorePersistenceError("store_write_failed", "Timed out acquiring registry lock.", {
      filePath: lockPath,
    });
  }
  try {
    return fn();
  } finally {
    try {
      closeSync(fd);
    } catch {}
    try {
      rmSync(lockPath, { force: true });
    } catch {}
  }
}
```

- [ ] **Step 5: Run tests, expect 5/5 lock tests pass**

```bash
pnpm --filter @megasaver/core test -- json-directory-registry-lock
```

Expected: 5 tests pass. The 3 new tests (stale PID recovery <2s, live-PID 5s timeout, malformed payload <2s) plus the 2 pre-existing tests.

- [ ] **Step 6: Run full core suite + typecheck**

```bash
pnpm --filter @megasaver/core test
pnpm --filter @megasaver/core typecheck
```

Expected: 99 tests pass (96 pre-existing + 3 new). Typecheck clean.

- [ ] **Step 7: Commit**

```bash
git -C /Users/halitozger/Desktop/MegaSaver/.worktrees/core-hardening-m3-m4 add packages/core/src/json-directory-registry.ts packages/core/test/json-directory-registry-lock.test.ts
git -C /Users/halitozger/Desktop/MegaSaver/.worktrees/core-hardening-m3-m4 commit -m "feat(core): detect stale .projects.lock holders"
```

Subject is 47 chars — fits ≤50.

---

## Task 2: M4 — `Project.name` NFC normalization

**Files:**
- Modify: `packages/core/src/project.ts:1-15` (add `.transform()` to `name`)
- Modify: `packages/core/test/project.test.ts` (extend with 3 new cases)

- [ ] **Step 1: Inspect current state**

```bash
cat packages/core/src/project.ts
grep -c "^  it(" packages/core/test/project.test.ts
```

Expected: schema has `name: z.string().trim().min(1)` with no transform. Test file has the existing project tests.

- [ ] **Step 2: Write 3 failing tests**

Append to the existing project schema describe block in `packages/core/test/project.test.ts`:

```ts
it("normalizes name to NFC form", () => {
  const NOW = "2026-05-08T12:00:00.000Z";
  const id = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
  // Input is NFD: "cafe" + combining acute (U+0301)
  const parsed = projectSchema.parse({
    id,
    name: "café",
    rootPath: "/tmp/demo",
    createdAt: NOW,
    updatedAt: NOW,
  });
  // Output is NFC: "café" with precomposed U+00E9
  expect(parsed.name).toBe("café");
  expect(parsed.name.length).toBe(4);
});

it("is idempotent on already-NFC names", () => {
  const NOW = "2026-05-08T12:00:00.000Z";
  const id = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
  const first = projectSchema.parse({
    id,
    name: "café",
    rootPath: "/tmp/demo",
    createdAt: NOW,
    updatedAt: NOW,
  });
  const second = projectSchema.parse(first);
  expect(second.name).toBe(first.name);
  expect(second.name).toBe("café");
});

it("does not normalize rootPath", () => {
  const NOW = "2026-05-08T12:00:00.000Z";
  const id = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
  const rootPath = "/tmp/café"; // NFD bytes
  const parsed = projectSchema.parse({
    id,
    name: "demo",
    rootPath,
    createdAt: NOW,
    updatedAt: NOW,
  });
  expect(parsed.rootPath).toBe(rootPath); // preserved byte-equal
});
```

If `projectIdSchema` is not imported, add at top of file:

```ts
import { projectIdSchema } from "@megasaver/shared";
```

(Verify against existing imports first.)

- [ ] **Step 3: Run tests, expect 2 failures (the normalize and rootPath tests)**

```bash
pnpm --filter @megasaver/core test -- project.test
```

Expected: "normalizes name to NFC form" fails (output is still NFD). "is idempotent on already-NFC names" passes coincidentally (NFC stays NFC even without transform). "does not normalize rootPath" passes (no transform anywhere yet). The crucial failure is the first test.

- [ ] **Step 4: Implement schema transform**

Edit `packages/core/src/project.ts`. Replace the entire file with:

```ts
import { projectIdSchema } from "@megasaver/shared";
import { z } from "zod";

export const projectSchema = z
  .object({
    id: projectIdSchema,
    name: z
      .string()
      .trim()
      .min(1)
      .transform((value) => value.normalize("NFC")),
    rootPath: z.string().trim().min(1),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type Project = z.infer<typeof projectSchema>;
```

- [ ] **Step 5: Run tests, expect 3/3 new tests pass**

```bash
pnpm --filter @megasaver/core test -- project.test
pnpm --filter @megasaver/core typecheck
```

Expected: all project tests pass. Typecheck clean.

- [ ] **Step 6: Commit**

```bash
git -C /Users/halitozger/Desktop/MegaSaver/.worktrees/core-hardening-m3-m4 add packages/core/src/project.ts packages/core/test/project.test.ts
git -C /Users/halitozger/Desktop/MegaSaver/.worktrees/core-hardening-m3-m4 commit -m "feat(core): NFC normalize Project.name"
```

Subject is 38 chars — fits.

---

## Task 3: M4 — `Session.title` NFC normalization

**Files:**
- Modify: `packages/core/src/session.ts:1-22` (add `.transform()` to `title` before `.nullable()`)
- Modify: `packages/core/test/session.test.ts` (extend with 2 new cases)

- [ ] **Step 1: Write 2 failing tests**

Append to the session schema describe block in `packages/core/test/session.test.ts`:

```ts
it("normalizes title to NFC form", () => {
  const NOW = "2026-05-08T12:00:00.000Z";
  const projectId = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
  const id = sessionIdSchema.parse("22222222-2222-4222-8222-222222222222");
  const parsed = sessionSchema.parse({
    id,
    projectId,
    agentId: "claude-code",
    riskLevel: "medium",
    title: "café", // NFD
    startedAt: NOW,
    endedAt: null,
  });
  expect(parsed.title).toBe("café"); // NFC
  expect(parsed.title?.length).toBe(4);
});

it("preserves null title without normalization", () => {
  const NOW = "2026-05-08T12:00:00.000Z";
  const projectId = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
  const id = sessionIdSchema.parse("22222222-2222-4222-8222-222222222222");
  const parsed = sessionSchema.parse({
    id,
    projectId,
    agentId: "claude-code",
    riskLevel: "medium",
    title: null,
    startedAt: NOW,
    endedAt: null,
  });
  expect(parsed.title).toBeNull();
});
```

Verify imports include `projectIdSchema` and `sessionIdSchema`; add if missing.

- [ ] **Step 2: Run tests, expect 1 failure (the NFC normalize test)**

```bash
pnpm --filter @megasaver/core test -- session.test
```

Expected: "normalizes title to NFC form" fails. "preserves null title without normalization" passes (no transform applied to null path).

- [ ] **Step 3: Implement schema transform**

Edit `packages/core/src/session.ts`. Replace the entire file with:

```ts
import {
  agentIdSchema,
  projectIdSchema,
  riskLevelSchema,
  sessionIdSchema,
} from "@megasaver/shared";
import { z } from "zod";

export const sessionSchema = z
  .object({
    id: sessionIdSchema,
    projectId: projectIdSchema,
    agentId: agentIdSchema,
    riskLevel: riskLevelSchema,
    title: z
      .string()
      .trim()
      .min(1)
      .transform((value) => value.normalize("NFC"))
      .nullable(),
    startedAt: z.string().datetime({ offset: true }),
    endedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

export type Session = z.infer<typeof sessionSchema>;
```

- [ ] **Step 4: Run tests, expect 2/2 new tests pass**

```bash
pnpm --filter @megasaver/core test -- session.test
pnpm --filter @megasaver/core typecheck
```

Expected: all session tests pass. Typecheck clean.

- [ ] **Step 5: Commit**

```bash
git -C /Users/halitozger/Desktop/MegaSaver/.worktrees/core-hardening-m3-m4 add packages/core/src/session.ts packages/core/test/session.test.ts
git -C /Users/halitozger/Desktop/MegaSaver/.worktrees/core-hardening-m3-m4 commit -m "feat(core): NFC normalize Session.title"
```

Subject is 39 chars — fits.

---

## Task 4: M4 — Registry-level migration tests

**Files:**
- Create: `packages/core/test/json-directory-registry-normalization.test.ts`

These tests assert that the schema-level transforms produce the right end-to-end behaviour at the JSON-directory persistence boundary. No source change is needed — Tasks 2 and 3 already wired the transforms; these tests verify the registry inherits them.

- [ ] **Step 1: Write 2 failing tests** (they will actually pass on first run since Tasks 2+3 wired the schema; this Task is verification, but TDD-write-test-first discipline still applies — write them BEFORE running them)

Create `packages/core/test/json-directory-registry-normalization.test.ts`:

```ts
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectIdSchema } from "@megasaver/shared";
import { createJsonDirectoryCoreRegistry } from "../src/index.js";

describe("createJsonDirectoryCoreRegistry — name normalization", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "megasaver-core-norm-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("listProjects returns NFC names for NFD entries already on disk", async () => {
    const id = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
    const NOW = "2026-05-08T12:00:00.000Z";
    // Bypass the schema and write NFD bytes directly into projects.json.
    // This simulates an entry written by an older version (or by hand).
    await writeFile(
      join(rootDir, "projects.json"),
      JSON.stringify([
        {
          id,
          name: "café", // NFD
          rootPath: "/tmp/demo",
          createdAt: NOW,
          updatedAt: NOW,
        },
      ]),
      "utf8",
    );
    const registry = createJsonDirectoryCoreRegistry({ rootDir });
    const projects = registry.listProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0]?.name).toBe("café"); // NFC
  });

  it("createProject persists NFC name to disk when caller passes NFD", async () => {
    const id = projectIdSchema.parse("22222222-2222-4222-8222-222222222222");
    const NOW = "2026-05-08T12:00:00.000Z";
    const registry = createJsonDirectoryCoreRegistry({ rootDir });
    registry.createProject({
      id,
      name: "café", // NFD input
      rootPath: "/tmp/demo",
      createdAt: NOW,
      updatedAt: NOW,
    });
    const raw = await readFile(join(rootDir, "projects.json"), "utf8");
    const parsed = JSON.parse(raw) as Array<{ name: string }>;
    expect(parsed[0]?.name).toBe("café"); // NFC on disk
  });
});
```

- [ ] **Step 2: Run tests, expect both pass on first run**

```bash
pnpm --filter @megasaver/core test -- json-directory-registry-normalization
```

Expected: both tests pass. They effectively verify the end-to-end migration semantics from §3 of the spec (lazy NFD-to-NFC migration on read, NFC on write).

If they FAIL, the schema transforms in Tasks 2+3 are wired wrong — debug there, do not modify the test.

- [ ] **Step 3: Run full core suite + typecheck**

```bash
pnpm --filter @megasaver/core test
pnpm --filter @megasaver/core typecheck
```

Expected: 106 tests pass total (96 pre + 3 M3 + 3 project + 2 session + 2 normalization). Typecheck clean.

- [ ] **Step 4: Commit**

```bash
git -C /Users/halitozger/Desktop/MegaSaver/.worktrees/core-hardening-m3-m4 add packages/core/test/json-directory-registry-normalization.test.ts
git -C /Users/halitozger/Desktop/MegaSaver/.worktrees/core-hardening-m3-m4 commit -m "test(core): cover NFD-to-NFC migration"
```

Subject is 39 chars — fits.

---

## Task 5: Add changeset

**Files:**
- Create: `.changeset/core-m3-m4-hardening.md`

- [ ] **Step 1: Write the changeset**

Create `.changeset/core-m3-m4-hardening.md`:

```md
---
"@megasaver/core": patch
---

Two cohesive correctness fixes:

- M3: stale-lock detection. `withDirLock` writes the holding PID
  into `.projects.lock` and uses `process.kill(pid, 0)` to detect
  dead holders. Crashed-process recovery now happens immediately
  rather than waiting the full 5s acquire timeout.
- M4: Unicode NFC normalization. `Project.name` and `Session.title`
  Zod schemas now normalize to NFC at parse time. NFD inputs are
  observably equal to their NFC equivalents post-parse. Migration
  is lazy: existing on-disk NFD entries are returned as NFC on
  read; subsequent writes persist NFC.

Public API output type is unchanged (`string` stays `string`),
but a literal NFD input no longer round-trips byte-equal — it
becomes its NFC equivalent. Callers comparing literal byte-strings
against parser output should normalize their fixtures to NFC.
```

- [ ] **Step 2: Commit**

```bash
git -C /Users/halitozger/Desktop/MegaSaver/.worktrees/core-hardening-m3-m4 add .changeset/core-m3-m4-hardening.md
git -C /Users/halitozger/Desktop/MegaSaver/.worktrees/core-hardening-m3-m4 commit -m "chore: changeset for core M3+M4"
```

Subject is 32 chars — fits.

---

## Task 6: Final verification

**Files:** none (gate)

- [ ] **Step 1: Run full workspace verify**

```bash
pnpm verify
```

Expected:
- lint clean
- typecheck across all 6 packages (`shared`, `core`, `cli`, `connectors-shared`, `connector-claude-code`, `connector-generic-cli`)
- test 12/12 turbo tasks all pass
- core: 106 tests
- shared / cli / connectors-shared / claude-code / generic-cli: unchanged from main

If any step fails, fix and re-run. No proceed without green.

- [ ] **Step 2: Capture smoke evidence**

M3 stale-lock smoke:

```bash
mkdir -p /tmp/mega-m3-smoke
echo "99999999" > /tmp/mega-m3-smoke/.projects.lock
node --input-type=module -e '
import { createJsonDirectoryCoreRegistry } from "./packages/core/dist/index.js";
import { projectIdSchema } from "./packages/shared/dist/index.js";
const r = createJsonDirectoryCoreRegistry({ rootDir: "/tmp/mega-m3-smoke" });
const start = Date.now();
const NOW = new Date().toISOString();
r.createProject({
  id: projectIdSchema.parse("11111111-1111-4111-8111-111111111111"),
  name: "smoke",
  rootPath: "/tmp",
  createdAt: NOW,
  updatedAt: NOW,
});
console.log("elapsed_ms:", Date.now() - start);
'
rm -rf /tmp/mega-m3-smoke
```

Expected: `elapsed_ms` < 100. (Build first if dist is stale: `pnpm --filter @megasaver/core build && pnpm --filter @megasaver/shared build`.)

M4 NFC parse smoke:

```bash
node --input-type=module -e '
import { projectSchema } from "./packages/core/dist/index.js";
import { projectIdSchema } from "./packages/shared/dist/index.js";
const id = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
const NOW = new Date().toISOString();
const result = projectSchema.parse({
  id,
  name: "café",
  rootPath: "/tmp",
  createdAt: NOW,
  updatedAt: NOW,
});
console.log("nfc_equal:", result.name === "café");
console.log("len:", result.name.length);
'
```

Expected: `nfc_equal: true`, `len: 4`.

Save evidence to a scratch note for the PR body. Do not commit the scratch note.

- [ ] **Step 3: No commit needed.**

---

## Task 7: Wiki updates

**Files:**
- Modify: `wiki/entities/core.md` (M3 + M4 deltas, 106 tests, new PR ref)
- Modify: `wiki/log.md` (append PR merge entry)

- [ ] **Step 1: Update `wiki/entities/core.md`**

Replace the existing "Implementation status" section to read:

```md
## Implementation status

Foundation + JSON persistence: PR <https://github.com/haJ1t/MegaSaver/pull/4> (`0656114`). `initStore` + cli project CRUD consumer: PR <https://github.com/haJ1t/MegaSaver/pull/5> (`9003968`). M1 lock + M2 failure-mode tests: PR <https://github.com/haJ1t/MegaSaver/pull/9> (`0dc2e29`). M3 stale-lock detection + M4 NFC normalization: PR #10 (TBD merge SHA). All on `origin/main`. 106 tests across 13 files.
```

(Replace the `TBD merge SHA` token with the actual merge commit hash after PR #10 merges. This sub-step is performed during the post-merge sync, not within this branch.)

Update the synchronization details paragraph:

```md
All methods are **synchronous** (return value, not Promise). Registry implementations may do file I/O internally but the surface stays sync. JSON-directory registry serialises create-style mutations (`createProject`, `createSession`, `createMemoryEntry`) via a sync `.projects.lock` file (5s acquire timeout, `Atomics.wait` 50ms backoff, `process.kill(pid, 0)` stale-holder detection). `Project.name` and `Session.title` are NFC-normalized at parse time so identity strings have a single canonical byte representation; lazy migration on read for any pre-existing NFD entries on disk.
```

Update the front-matter `updated:` date to `2026-05-08`.

- [ ] **Step 2: Append `wiki/log.md` entry**

Append at end of file (after the last entry):

```md
## [2026-05-08] schema | core M3 stale-lock + M4 NFC normalization implemented

Shipped on `feat/core-hardening-m3-m4`: M3 PID-in-`.projects.lock` plus `process.kill(pid, 0)` stale-holder detection (crashed-process recovery now <100ms instead of 5s timeout), and M4 NFC normalization via Zod `.transform()` on `Project.name` and `Session.title` (NFD inputs round-trip to NFC post-parse). Registry interface stays sync. No new external deps. Tests: core 96 → 106 (+3 lock recovery + 5 schema NFC + 2 registry-level migration). `pnpm verify` green across 6 packages, 12/12 turbo tasks. Smoke evidence: stale PID 99999999 lock recovers in <100ms; NFD `café` parses to NFC `café` (length 4). Tracked follow-ups: cross-host (NFS) lock semantics with hostname check, eager NFD-to-NFC migration command (`mega project compact`), `MemoryEntry.content` and `Project.rootPath` normalization scope expansion.
```

- [ ] **Step 3: Commit**

```bash
git -C /Users/halitozger/Desktop/MegaSaver/.worktrees/core-hardening-m3-m4 add wiki/
git -C /Users/halitozger/Desktop/MegaSaver/.worktrees/core-hardening-m3-m4 commit -m "docs(wiki): record core M3+M4 hardening"
```

Subject is 41 chars — fits.

---

## Task 8: Push + open draft PR + dispatch reviewers

**Files:** none (process)

- [ ] **Step 1: Push branch**

```bash
git -C /Users/halitozger/Desktop/MegaSaver/.worktrees/core-hardening-m3-m4 push -u origin feat/core-hardening-m3-m4
```

- [ ] **Step 2: Open draft PR**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/core-hardening-m3-m4
gh pr create --draft \
  --base main \
  --title "feat(core): M3 stale-lock detection + M4 NFC normalization" \
  --body "$(cat <<'EOF'
## Summary
Two cohesive correctness fixes for `@megasaver/core`, shipped together. Both were tracked v0.1 residual risks (M3 from PR #5 follow-ups, M4 from PR #5 unicode-policy gap).

- **M3** — `withDirLock` writes the current PID into `.projects.lock` and uses `process.kill(pid, 0)` to detect dead holders. Crashed-process recovery now happens in <100ms instead of waiting the full 5s acquire timeout.
- **M4** — `Project.name` and `Session.title` Zod schemas gain a parse-time `.transform(s => s.normalize("NFC"))`. NFD inputs become their NFC equivalents post-parse; identity strings have a single canonical byte representation. Migration is lazy: existing on-disk NFD entries return NFC on read; subsequent writes persist NFC.

## Spec / Plan
- Spec: `docs/superpowers/specs/2026-05-08-core-hardening-m3-m4-design.md`
- Plan: `docs/superpowers/plans/2026-05-08-core-hardening-m3-m4-plan.md`

## Verification
- `pnpm verify` green: lint clean, typecheck 6/6 packages, test 12/12 turbo tasks.
- Core: 106 tests (was 96, +3 lock recovery + 5 schema NFC + 2 registry migration).
- All other packages: unchanged.

## Smoke evidence
- M3: stale PID 99999999 lock recovers in <100 ms.
- M4: `projectSchema.parse({ name: "café", ... }).name` equals `"café"` (length 4).

## Risk
HIGH (CLAUDE.md §12). Worktree used. Two-stage external review (`code-reviewer` + `critic`) required before merge.

## Public API note
M4 input/output literal-equality changes for NFD inputs. Output type is unchanged (`string` stays `string`); v0.0.0 private package with no external consumers, so no semver impact in practice. Changeset is `patch`.

## Residual risks (deferred)
- Cross-host (NFS) lock semantics with hostname check.
- Eager NFD-to-NFC migration command (`mega project compact`).
- `MemoryEntry.content` and `Project.rootPath` normalization scope.
- PID reuse race on dead holder (fail-safe; same outcome as pre-M3).
- Lock-write atomicity (`openSync(wx)` + `writeSync(pid)` separate syscalls; sub-ms window).
EOF
)"
```

- [ ] **Step 3: Dispatch reviewers (separate active context)**

Per `CLAUDE.md` §9: author and reviewer agents must NEVER share an active context. From a fresh session/agent:

- `Agent({ subagent_type: "superpowers:code-reviewer", model: "opus", prompt: "Review feat/core-hardening-m3-m4 at HEAD against spec. Check withDirLock changes (no double-acquire, race-window analysis correct), schema transforms (idempotent, output type unchanged), test coverage of all branches in isLockHolderAlive." })`
- `Agent({ subagent_type: "oh-my-claudecode:critic", model: "opus", prompt: "Adversarial review of feat/core-hardening-m3-m4. Probe: PID-write race (openSync→writeSync window), schema-output-equality breakage for downstream callers, NFD migration sequencing on listProjects→createProject ordering, sentinel-substring-check interaction with NFC transform." })`

Wait for both to return Approved. If changes-requested, fix and re-dispatch on the new HEAD.

- [ ] **Step 4: Mark PR ready, merge**

After both reviewers approve and any feedback is addressed:

```bash
gh pr ready
gh pr merge --squash --delete-branch
```

(Or use the GitHub UI if user prefers manual merge.)

- [ ] **Step 5: Local cleanup**

```bash
cd /Users/halitozger/Desktop/MegaSaver
git pull --ff-only
git worktree remove .worktrees/core-hardening-m3-m4
git branch -D feat/core-hardening-m3-m4
```

- [ ] **Step 6: Append final log entry**

In `wiki/log.md` on `main`, append:

```md
## [2026-05-08] schema | core M3+M4 pushed to main

PR #10 (link) merged into `main` (merge commit <sha>). `@megasaver/core` now has stale-lock detection (PID-in-`.projects.lock` + `kill(0)` check) and NFC normalization on `Project.name` + `Session.title`. Local `main` synced via `git pull --ff-only`; worktree `.worktrees/core-hardening-m3-m4` removed; local + remote `feat/core-hardening-m3-m4` branch deleted. Tracked follow-ups: cross-host lock semantics (R1), eager NFD compact command (R4), normalization scope expansion to `rootPath` / `content` (R5).
```

Commit on main with `docs(wiki): record core M3+M4 merge` and push.

---

## Self-review

After writing all tasks, verify against the spec:

**Spec coverage:**
- §1 goal/scope — Tasks 1–7 collectively realise it (M3 in Task 1; M4 in Tasks 2-4; changeset in Task 5; verify in Task 6; wiki in Task 7; gate in Task 8).
- §2 M3 detail — Task 1 covers all three test scenarios (stale PID, malformed payload, live-PID conservative wait) plus the `isLockHolderAlive` private helper.
- §3 M4 detail — Tasks 2 (project) + 3 (session) + 4 (registry-level migration) cover all 7 spec test cases.
- §4 packaging — Tasks 1-4 mirror the spec's per-file breakdown.
- §5 risk / residual / changeset — Task 5 (changeset), Task 6 (verify), Task 8 (review gate).

**Placeholder scan:** No "TBD" / "TODO" / "fill in" remain except one intentional `TBD merge SHA` token in Task 7 step 1 — explicitly flagged for post-merge replacement, not a planning gap.

**Type consistency:** `Project.name` and `Session.title` schema shapes match between Tasks 2 and 3 (same `.string().trim().min(1).transform(...)` pattern, with `.nullable()` only on title). `isLockHolderAlive` signature matches across spec §2 and Task 1 implementation. `withDirLock` signature unchanged. Test fixture project IDs use distinct UUIDs (`44444444-...` for stale recovery, `55555555-...` for live PID, `66666666-...` for malformed) to avoid duplicate-name collisions within the test suite.

**Commit subject lengths verified:** 47, 38, 39, 39, 32, 41 chars — all ≤50.
