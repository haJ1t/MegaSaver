import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  MemoryEntryView,
  OrchestratorRegistry,
  SessionFailureRecord,
} from "../src/registry-port.js";
import { runOutputExecCommand } from "../src/run-command.js";
import type { RunCommandSpawn } from "../src/run-command.js";
import { buildSessionHints, extractFailureSignatures } from "../src/session-hints.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const SESSION_ID = "22222222-2222-4222-8222-222222222222" as SessionId;

function failure(errorOutput: string): SessionFailureRecord {
  return {
    id: "33333333-3333-4333-8333-333333333333" as SessionFailureRecord["id"],
    projectId: PROJECT_ID,
    sessionId: SESSION_ID,
    command: "pnpm test",
    errorOutput,
    source: "proxy-classifier",
    createdAt: "2026-07-01T00:00:00.000Z",
  };
}

// A realistic multi-line tsc-style failure blob. The signatures the extractor
// must surface are the file path (with and without :line) and the TS2322 code.
const TSC_FAILURE = [
  "src/auth.ts:42:10 - error TS2322: Type 'string | undefined' is not assignable to type 'string'.",
  "",
  "42   const token: string = readToken();",
  "              ~~~~~",
  "",
  "Found 1 error in src/auth.ts:42",
].join("\n");

describe("extractFailureSignatures", () => {
  it("pulls short file-path and error-code signatures from a multi-line blob", () => {
    const sigs = extractFailureSignatures(TSC_FAILURE);

    expect(sigs).toContain("TS2322");
    expect(sigs).toContain("src/auth.ts");
    expect(sigs).toContain("src/auth.ts:42");
    // Every emitted signature is a SHORT token a later chunk could contain —
    // never the whole blob, and never a sub-4-char fragment.
    for (const s of sigs) {
      expect(s.length).toBeGreaterThanOrEqual(4);
      expect(s).not.toContain("\n");
    }
    // Deduped and capped.
    expect(new Set(sigs).size).toBe(sigs.length);
    expect(sigs.length).toBeLessThanOrEqual(12);
  });

  it("returns [] for empty or benign output with no signatures", () => {
    expect(extractFailureSignatures("")).toEqual([]);
    expect(extractFailureSignatures("all good, nothing to report here")).toEqual([]);
  });

  it("drops dot-tokens whose extension is not a code/config extension", () => {
    expect(extractFailureSignatures("see README.md for details")).toEqual([]);
    expect(extractFailureSignatures("fetch failed for example.com")).toEqual([]);
    expect(extractFailureSignatures("weird token a.b in output")).toEqual([]);
  });

  it("keeps code and config paths, stripping :line for the bare form", () => {
    const sigs = extractFailureSignatures("error at src/auth.ts:42 while loading config.yml");

    expect(sigs).toContain("src/auth.ts:42");
    expect(sigs).toContain("src/auth.ts");
    expect(sigs).toContain("config.yml");
  });

  it("matches 5-char code extensions like swift", () => {
    expect(extractFailureSignatures("crash in Sources/App.swift")).toContain("Sources/App.swift");
    expect(extractFailureSignatures("resolving host.local failed")).toEqual([]);
  });

  it("matches mts and cts module extensions", () => {
    const sigs = extractFailureSignatures("error at src/x.mts:3");
    expect(sigs).toContain("src/x.mts:3");
    expect(sigs).toContain("src/x.mts");
    expect(extractFailureSignatures("error at src/y.cts:7")).toContain("src/y.cts");
  });
});

function hintRegistry(over: {
  failures?: SessionFailureRecord[];
  memory?: MemoryEntryView[];
  rules?: { appliesTo: string[] }[];
}) {
  return {
    listSessionFailures: () => over.failures ?? [],
    listMemoryEntries: () => over.memory ?? [],
    listProjectRules: () => over.rules ?? [],
  };
}

describe("buildSessionHints", () => {
  it("maps each failure's errorOutput into short signatures, not the whole blob", () => {
    const registry = {
      listSessionFailures: (projectId: ProjectId, sessionId: SessionId) => {
        expect(projectId).toBe(PROJECT_ID);
        expect(sessionId).toBe(SESSION_ID);
        return [failure(TSC_FAILURE)];
      },
      listMemoryEntries: (projectId: ProjectId) => {
        expect(projectId).toBe(PROJECT_ID);
        return [];
      },
      listProjectRules: (projectId: ProjectId) => {
        expect(projectId).toBe(PROJECT_ID);
        return [];
      },
    };

    const hints = buildSessionHints(registry, PROJECT_ID, SESSION_ID);

    expect(hints.recentFailures).toContain("TS2322");
    expect(hints.recentFailures).toContain("src/auth.ts");
    // The whole blob must NOT leak in as a hint item — that is the dead-boost bug.
    expect(hints.recentFailures).not.toContain(TSC_FAILURE);
    expect(hints.recentMemory).toEqual([]);
    expect(hints.projectConventions).toEqual([]);
    expect(hints.recentFiles).toBeUndefined();
  });

  it("contributes nothing for a benign failure that yields no signature", () => {
    const registry = hintRegistry({
      failures: [failure("process exited"), failure(TSC_FAILURE)],
    });

    const hints = buildSessionHints(registry, PROJECT_ID, SESSION_ID);

    // Only the tsc blob's signatures survive; the benign one adds nothing.
    expect(hints.recentFailures).toContain("TS2322");
    expect(hints.recentFailures).toContain("src/auth.ts");
  });

  it("returns an empty recentFailures list when there are no failures", () => {
    const hints = buildSessionHints(hintRegistry({}), PROJECT_ID, SESSION_ID);

    expect(hints.recentFailures).toEqual([]);
  });

  it("flattens approved memory relatedFiles + relatedSymbols into recentMemory, deduped, newest entry first", () => {
    const registry = hintRegistry({
      memory: [
        {
          approval: "approved",
          stale: false,
          relatedFiles: ["src/auth.ts", "src/db.ts"],
          relatedSymbols: ["readToken", "src/auth.ts"],
        },
        { approval: "approved", stale: false, relatedFiles: ["src/db.ts"] },
      ],
    });

    const hints = buildSessionHints(registry, PROJECT_ID, SESSION_ID);

    expect(hints.recentMemory).toEqual(["src/db.ts", "src/auth.ts", "readToken"]);
  });

  it("drops sub-4-char tokens from recentMemory and projectConventions", () => {
    const registry = hintRegistry({
      memory: [{ approval: "approved", stale: false, relatedSymbols: ["x", "validateToken"] }],
      rules: [{ appliesTo: ["abc", "src/auth.ts"] }],
    });

    const hints = buildSessionHints(registry, PROJECT_ID, SESSION_ID);

    expect(hints.recentMemory).toEqual(["validateToken"]);
    expect(hints.projectConventions).toEqual(["src/auth.ts"]);
  });

  it("keeps the 12 newest failure signatures when the cap overflows", () => {
    const failures = Array.from({ length: 13 }, (_, i) =>
      failure(`error in src/f${String(i).padStart(2, "0")}.ts`),
    );
    const registry = hintRegistry({ failures });

    const hints = buildSessionHints(registry, PROJECT_ID, SESSION_ID);

    expect(hints.recentFailures).toHaveLength(12);
    expect(hints.recentFailures).toContain("src/f12.ts");
    expect(hints.recentFailures).not.toContain("src/f00.ts");
  });

  it("caps recentMemory at 12 items", () => {
    const registry = hintRegistry({
      memory: [
        {
          approval: "approved",
          stale: false,
          relatedFiles: Array.from({ length: 15 }, (_, i) => `src/file-${i}.ts`),
        },
      ],
    });

    const hints = buildSessionHints(registry, PROJECT_ID, SESSION_ID);

    expect(hints.recentMemory).toHaveLength(12);
  });

  it("never leaks keywords, content, or title into recentMemory", () => {
    // Mutation target: an impl that reads keywords/content/title instead of
    // relatedFiles/relatedSymbols must fail here.
    const keywordOnly = {
      approval: "approved",
      stale: false,
      keywords: ["src/keyword-leak.ts"],
      title: "src/title-leak.ts",
      content: "explains src/content-leak.ts in detail",
    };
    const registry = hintRegistry({ memory: [keywordOnly] });

    const hints = buildSessionHints(registry, PROJECT_ID, SESSION_ID);

    expect(hints.recentMemory).toEqual([]);
  });

  it("excludes unapproved and stale memory", () => {
    const registry = hintRegistry({
      memory: [
        { approval: "suggested", stale: false, relatedFiles: ["src/suggested.ts"] },
        { approval: "rejected", stale: false, relatedFiles: ["src/rejected.ts"] },
        { approval: "approved", stale: true, relatedFiles: ["src/stale.ts"] },
        { approval: "approved", stale: false, relatedFiles: ["src/kept.ts"] },
      ],
    });

    const hints = buildSessionHints(registry, PROJECT_ID, SESSION_ID);

    expect(hints.recentMemory).toEqual(["src/kept.ts"]);
  });

  it("flattens rule appliesTo into projectConventions, deduped and capped at 12 newest", () => {
    const registry = hintRegistry({
      rules: [
        {
          appliesTo: [
            "src/auth.ts",
            ...Array.from({ length: 15 }, (_, i) => `lit-${String(i).padStart(2, "0")}/x.ts`),
          ],
        },
        { appliesTo: ["src/auth.ts", "packages/core/index.ts"] },
      ],
    });

    const hints = buildSessionHints(registry, PROJECT_ID, SESSION_ID);

    // Newest rule's tokens survive the cap; the oldest rule's overflow is evicted.
    expect(hints.projectConventions?.slice(0, 2)).toEqual([
      "src/auth.ts",
      "packages/core/index.ts",
    ]);
    expect(hints.projectConventions).toHaveLength(12);
    expect(new Set(hints.projectConventions).size).toBe(12);
  });

  it("drops glob patterns from projectConventions, keeping only literal paths", () => {
    const registry = hintRegistry({
      rules: [{ appliesTo: ["src/**/*.ts", "src/auth.ts"] }],
    });

    const hints = buildSessionHints(registry, PROJECT_ID, SESSION_ID);

    expect(hints.projectConventions).toEqual(["src/auth.ts"]);
  });

  it("drops every glob metachar form (*, ?, [, {)", () => {
    const registry = hintRegistry({
      rules: [
        { appliesTo: ["src/*.ts", "file?.ts", "src/[id].ts", "src/{a,b}.ts", "docs/setup.md"] },
      ],
    });

    const hints = buildSessionHints(registry, PROJECT_ID, SESSION_ID);

    expect(hints.projectConventions).toEqual(["docs/setup.md"]);
  });
});

const ROOT_PID = String(process.pid);
const NOW = "2026-07-01T00:00:00.000Z";

type FakeChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  killed: boolean;
};
function makeChild(): FakeChild {
  const c = new EventEmitter() as FakeChild;
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  c.killed = false;
  c.kill = vi.fn(() => {
    c.killed = true;
    return true;
  });
  return c;
}
function spawnMock(child: FakeChild): RunCommandSpawn {
  return ((_c: string, _a: readonly string[], _o: Record<string, unknown>) =>
    child) as unknown as RunCommandSpawn;
}
function makeSharedRegistry(
  projectRoot: string,
  created: SessionFailureRecord[],
  memory: MemoryEntryView[] = [],
): OrchestratorRegistry {
  return {
    getSession: (id) =>
      id === SESSION_ID
        ? {
            projectId: PROJECT_ID,
            tokenSaver: { mode: "balanced", maxReturnedBytes: 12_000, storeRawOutput: true },
          }
        : null,
    getProject: (id) => (id === PROJECT_ID ? { rootPath: projectRoot } : null),
    createSessionFailure: (failure) => {
      created.push(failure);
      return failure;
    },
    listSessionFailures: () => [...created],
    listMemoryEntries: () => [...memory],
    listProjectRules: () => [],
  };
}

describe("runOutputExecCommand — failure-aware ranking (session hints wired)", () => {
  let store: string;
  let projectRoot: string;
  let idCounter: number;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "cg-hints-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "cg-hints-root-"));
    idCounter = 0;
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("ranks a chunk referencing a prior failure signature above unrelated noise", async () => {
    const created: SessionFailureRecord[] = [];
    const registry = makeSharedRegistry(projectRoot, created);

    // Command 1 fails with a REALISTIC multi-line tsc failure. Slice-1 capture
    // records the full redacted blob on the SessionFailure; buildSessionHints
    // later distills it into SHORT signatures (the file path, the TS2322 code).
    const failChild = makeChild();
    const failPromise = runOutputExecCommand({
      registry,
      storeRoot: store,
      sessionId: SESSION_ID,
      command: "pnpm",
      args: ["typecheck"],
      intent: "typecheck",
      originPid: ROOT_PID,
      timeoutMs: 300_000,
      maxBytes: 20_000_000,
      now: () => NOW,
      newId: () => `cs-${idCounter++}`,
      loadPermissions: () => null,
      spawn: spawnMock(failChild),
    });
    failChild.stdout.emit("data", Buffer.from(TSC_FAILURE));
    failChild.emit("close", 1);
    const failOutcome = await failPromise;
    expect(failOutcome.ok).toBe(true);
    expect(created).toHaveLength(1);
    // The record keeps the FULL redacted blob (schema unchanged); only the
    // hints emit signatures.
    expect(created[0]?.errorOutput).toBe(TSC_FAILURE);

    // Command 2 succeeds; one chunk of its output mentions a signature from the
    // prior failure (the file path src/auth.ts), a separate chunk is pure noise.
    // With sessionHints + engineRanking wired, the signature chunk must earn a
    // positive failureHistoryBoost and outrank the noise chunk.
    const noiseTail = Array.from({ length: 45 }, (_, i) => `info detail entry ${i}`).join("\n");
    const secondBody = `rebuilt module src/auth.ts cleanly\n${noiseTail}\n`;
    const okChild = makeChild();
    const okPromise = runOutputExecCommand({
      registry,
      storeRoot: store,
      sessionId: SESSION_ID,
      command: "pnpm",
      args: ["build"],
      intent: "build the project",
      originPid: ROOT_PID,
      timeoutMs: 300_000,
      maxBytes: 20_000_000,
      now: () => NOW,
      newId: () => `cs-${idCounter++}`,
      loadPermissions: () => null,
      spawn: spawnMock(okChild),
    });
    okChild.stdout.emit("data", Buffer.from(secondBody));
    okChild.emit("close", 0);
    const okOutcome = await okPromise;
    expect(okOutcome.ok).toBe(true);
    if (!okOutcome.ok) return;

    const excerpts = okOutcome.result.excerpts;
    const boostedIndex = excerpts.findIndex((e) => e.text.includes("src/auth.ts"));
    const noiseIndex = excerpts.findIndex((e) => !e.text.includes("src/auth.ts"));
    expect(boostedIndex).toBeGreaterThanOrEqual(0);
    expect(noiseIndex).toBeGreaterThanOrEqual(0);
    // Engine ranking is active: the signature chunk carries a positive
    // failureHistoryBoost and the noise chunk does not.
    expect(excerpts[boostedIndex]?.engine?.failureHistoryBoost).toBeGreaterThan(0);
    expect(excerpts[noiseIndex]?.engine?.failureHistoryBoost).toBe(0);
    // …and it is ranked ahead of the noise chunk.
    expect(boostedIndex).toBeLessThan(noiseIndex);
  });

  it("ranks a chunk referencing approved memory relatedFiles above noise (memoryBoost)", async () => {
    const registry = makeSharedRegistry(
      projectRoot,
      [],
      [{ approval: "approved", stale: false, relatedFiles: ["src/auth.ts"] }],
    );

    const noiseTail = Array.from({ length: 45 }, (_, i) => `info detail entry ${i}`).join("\n");
    const body = `rebuilt module src/auth.ts cleanly\n${noiseTail}\n`;
    const child = makeChild();
    const promise = runOutputExecCommand({
      registry,
      storeRoot: store,
      sessionId: SESSION_ID,
      command: "pnpm",
      args: ["build"],
      intent: "build the project",
      originPid: ROOT_PID,
      timeoutMs: 300_000,
      maxBytes: 20_000_000,
      now: () => NOW,
      newId: () => `cs-${idCounter++}`,
      loadPermissions: () => null,
      spawn: spawnMock(child),
    });
    child.stdout.emit("data", Buffer.from(body));
    child.emit("close", 0);
    const outcome = await promise;
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const excerpts = outcome.result.excerpts;
    const boostedIndex = excerpts.findIndex((e) => e.text.includes("src/auth.ts"));
    const noiseIndex = excerpts.findIndex((e) => !e.text.includes("src/auth.ts"));
    expect(boostedIndex).toBeGreaterThanOrEqual(0);
    expect(noiseIndex).toBeGreaterThanOrEqual(0);
    expect(excerpts[boostedIndex]?.engine?.memoryBoost).toBeGreaterThan(0);
    expect(excerpts[noiseIndex]?.engine?.memoryBoost).toBe(0);
    expect(boostedIndex).toBeLessThan(noiseIndex);
  });
});
