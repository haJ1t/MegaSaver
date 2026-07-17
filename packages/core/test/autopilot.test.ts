import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_AUTOPILOT_POLICY } from "../src/autopilot-store.js";
import { runAutopilot, scoreCandidate } from "../src/autopilot.js";
import { createJsonDirectoryCoreRegistry } from "../src/json-directory-registry.js";
import { type CoreRegistry, createInMemoryCoreRegistry } from "../src/registry.js";
import type { ExtractedCandidate } from "../src/session-memory.js";

function cand(over: Partial<ExtractedCandidate> = {}): ExtractedCandidate {
  return {
    type: "bug",
    source: "test_failure",
    scope: "session",
    confidence: "low",
    approval: "suggested",
    title: "run auth tests",
    content: "Failed step: run auth tests",
    relatedFiles: [],
    contentHash: "0123456789abcdef",
    dedupeKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:0123456789abcdef",
    occurrences: 1,
    ...over,
  };
}

describe("scoreCandidate", () => {
  it("recurring-failure: a cross-session recurring bug scores high", () => {
    expect(scoreCandidate(cand({ type: "bug" }), { priorSessionHit: true })).toBe("high");
  });

  it("recurring-failure: a cross-session recurring test_behavior scores high", () => {
    expect(
      scoreCandidate(cand({ type: "test_behavior", confidence: "medium" }), {
        priorSessionHit: true,
      }),
    ).toBe("high");
  });

  it("keep-extractor: non-failure types keep extractor confidence even on recurrence", () => {
    expect(scoreCandidate(cand({ type: "decision" }), { priorSessionHit: true })).toBe("low");
  });

  it("keep-extractor: no prior-session hit passes the extractor confidence through", () => {
    expect(scoreCandidate(cand({ confidence: "medium" }), { priorSessionHit: false })).toBe(
      "medium",
    );
    expect(scoreCandidate(cand({ confidence: "low" }), { priorSessionHit: false })).toBe("low");
  });

  it("keep-extractor clamps 'high': only the recurring-failure rule may return high", () => {
    // The auto-approval score must come from THIS function's recurrence rule,
    // never passed through from the extractor.
    const passedThrough = scoreCandidate(cand({ confidence: "high" }), { priorSessionHit: false });
    expect(passedThrough).toBe("medium");
    // Same for a recurring non-failure type, which skips the recurring-failure rule.
    expect(
      scoreCandidate(cand({ type: "decision", confidence: "high" }), { priorSessionHit: true }),
    ).not.toBe("high");
  });

  it("M2 regression: a within-session retry storm NEVER scores high", () => {
    // 5 identical failures in ONE session (occurrences 5) with no cross-session
    // recurrence is a stuck automated loop, not an important memory.
    const storm = scoreCandidate(cand({ occurrences: 5 }), { priorSessionHit: false });
    expect(storm).toBe("low");
  });
});

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const PRIOR_SESSION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as SessionId;
const CURRENT_SESSION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" as SessionId;
const TS = "2026-07-10T00:00:00.000Z";
const NOW = "2026-07-15T12:00:00.000Z";

// Monotonic across the whole file, never reset: the real caller passes
// crypto.randomUUID, so a per-run sequence restarting at 0001 would collide on
// the second run of a test and mask the property under test with a fixture bug.
const nextId = (() => {
  let n = 0;
  return () => {
    n += 1;
    return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  };
})();

// sessionId is nullable on FailedAttempt (failed-attempt.ts) — a sessionless
// row is a first-class citizen here, not an illegal fixture.
type AddFailure = (
  sessionId: SessionId | null,
  failedStep: string,
  errorOutput: string,
  relatedFiles?: string[],
) => void;

function seedBase(registry: CoreRegistry, rootPath = "/nonexistent/never-a-git-repo"): AddFailure {
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath,
    createdAt: TS,
    updatedAt: TS,
  } as never);
  for (const [id, startedAt] of [
    [PRIOR_SESSION, TS],
    [CURRENT_SESSION, NOW],
  ] as const) {
    registry.createSession({
      id,
      projectId: PROJECT_ID,
      agentId: "claude-code",
      riskLevel: "medium",
      title: "s",
      startedAt,
      endedAt: null,
    } as never);
  }
  let n = 0;
  return (sessionId, failedStep, errorOutput, relatedFiles = []) => {
    n += 1;
    registry.createFailedAttempt({
      id: `cccccccc-cccc-4ccc-8ccc-${String(n).padStart(12, "0")}`,
      projectId: PROJECT_ID,
      sessionId,
      task: "task",
      failedStep,
      errorOutput,
      relatedFiles,
      convertedToRule: false,
      createdAt: sessionId === PRIOR_SESSION ? TS : NOW,
    } as never);
  };
}

function run(registry: CoreRegistry, over: { dryRun?: boolean } = {}) {
  return runAutopilot({
    registry,
    projectId: PROJECT_ID,
    sessionId: CURRENT_SESSION,
    policy: DEFAULT_AUTOPILOT_POLICY,
    now: NOW,
    newId: nextId,
    ...(over.dryRun !== undefined ? { dryRun: over.dryRun } : {}),
  });
}

describe("runAutopilot", () => {
  it("approves the cross-session recurrence, stages the rest", async () => {
    const registry = createInMemoryCoreRegistry();
    const addFailure = seedBase(registry);
    addFailure(PRIOR_SESSION, "auth middleware crashes", "TypeError: x is undefined");
    addFailure(CURRENT_SESSION, "auth middleware crashes", "TypeError: x is undefined");
    addFailure(CURRENT_SESSION, "build the cli bundle", "ENOENT: missing dist/cli.js");

    const result = await run(registry);

    expect(result.autoApproved).toHaveLength(1);
    expect(result.staged).toHaveLength(1);
    expect(result.skippedExisting).toBe(0);
    expect(result.cappedOut).toBe(0);

    const approved = result.autoApproved[0];
    expect(approved).toBeDefined();
    if (approved === undefined) return;
    expect(approved.approval).toBe("approved");
    expect(approved.confidence).toBe("high");
    expect(approved.validFrom).toBe(NOW);
    expect(approved.lastActiveAt).toBe(NOW);
    expect(approved.evidence).toEqual([
      `autopilot@1 rule=recurring-failure session=${CURRENT_SESSION}`,
    ]);
    expect(approved.title).toBe("auth middleware crashes");

    const staged = result.staged[0];
    expect(staged).toBeDefined();
    if (staged === undefined) return;
    expect(staged.approval).toBe("suggested");
    expect(staged.confidence).toBe("low");
    expect(staged.evidence).toBeUndefined();
    expect(staged.validFrom).toBeUndefined();

    // BOTH branches carry the idempotence ledger keyword (architect M4).
    // Hardcoded, not re-derived through extractSessionMemories/dedupeKeywordFor:
    // a computed expectation drifts in lockstep with the code it checks, and the
    // ledger is a cross-writer wire format — from-session must compose the same
    // bytes for autopilot's skip to see its rows at all.
    expect(approved.keywords).toEqual([
      "from-session:cccccccc-cccc-4ccc-8ccc-000000000002:73b5e6cebe082b46",
    ]);
    expect(staged.keywords).toEqual([
      "from-session:cccccccc-cccc-4ccc-8ccc-000000000003:c825e22aca68ef73",
    ]);
    expect(registry.listMemoryEntries(PROJECT_ID)).toHaveLength(2);
  });

  it("storm-negative: a same-session repeat alone approves NOTHING (M2)", async () => {
    const registry = createInMemoryCoreRegistry();
    const addFailure = seedBase(registry);
    addFailure(CURRENT_SESSION, "flaky deploy step", "socket hang up");
    addFailure(CURRENT_SESSION, "flaky deploy step", "socket hang up");
    addFailure(CURRENT_SESSION, "flaky deploy step", "socket hang up");

    const result = await run(registry);

    expect(result.autoApproved).toEqual([]);
    expect(result.staged).toHaveLength(1);
    expect(result.staged[0]?.approval).toBe("suggested");
    expect(result.staged[0]?.confidence).toBe("low");
  });

  it("never counts a null-session failure as a prior session (M2)", async () => {
    const registry = createInMemoryCoreRegistry();
    const addFailure = seedBase(registry);
    // FailedAttempt.sessionId is nullable, and three real writers produce null:
    // MCP record_failed_attempt with sessionId omitted, `mega fail record`
    // without --session, and EVERY brain-import row. null is the ABSENCE of a
    // session, not a different one — counting it as recurrence would let an
    // agent manufacture its own auto-approval precondition with two tool calls,
    // and would make an imported corpus (all-null) a standing prior bucket.
    addFailure(null, "auth middleware crashes", "TypeError: x is undefined");
    addFailure(CURRENT_SESSION, "auth middleware crashes", "TypeError: x is undefined");

    const result = await run(registry);

    expect(result.autoApproved).toEqual([]);
    expect(result.staged).toHaveLength(1);
    expect(result.staged[0]?.approval).toBe("suggested");
    expect(result.staged[0]?.evidence).toBeUndefined();
    // No row may attest to a recurrence that never happened.
    const attested = registry
      .listMemoryEntries(PROJECT_ID)
      .flatMap((m) => m.evidence ?? [])
      .filter((e) => e.includes("rule=recurring-failure"));
    expect(attested).toEqual([]);
  });

  it("honors a narrowed autoApproveTypes allowlist", async () => {
    const registry = createInMemoryCoreRegistry();
    const addFailure = seedBase(registry);
    addFailure(PRIOR_SESSION, "vitest auth suite", "expected 200 got 401");
    addFailure(CURRENT_SESSION, "vitest auth suite", "expected 200 got 401");

    const result = await runAutopilot({
      registry,
      projectId: PROJECT_ID,
      sessionId: CURRENT_SESSION,
      policy: { ...DEFAULT_AUTOPILOT_POLICY, autoApproveTypes: ["bug"] },
      now: NOW,
      newId: nextId,
    });

    // This candidate recurs across sessions and so scores "high", but the
    // operator narrowed the allowlist to bug-only: the policy is a real gate,
    // not decoration the score can talk its way past.
    expect(result.staged).toHaveLength(1);
    expect(result.staged[0]?.type).toBe("test_behavior");
    expect(result.staged[0]?.approval).toBe("suggested");
    expect(result.autoApproved).toEqual([]);
  });

  it("caps auto-approves per session in candidate order", async () => {
    const registry = createInMemoryCoreRegistry();
    const addFailure = seedBase(registry);
    for (let i = 1; i <= 11; i += 1) {
      addFailure(PRIOR_SESSION, `step ${i} exploded`, `boom ${i}`);
      addFailure(CURRENT_SESSION, `step ${i} exploded`, `boom ${i}`);
    }

    const result = await run(registry); // DEFAULT policy cap: 10

    expect(result.autoApproved).toHaveLength(10);
    expect(result.staged).toHaveLength(1);
    expect(result.cappedOut).toBe(1);
    // The surplus qualified row lands in staged as a plain suggested row.
    expect(result.staged[0]?.approval).toBe("suggested");
    expect(result.staged[0]?.confidence).toBe("low");
    expect(result.staged[0]?.title).toBe("step 11 exploded");
  });

  it("second run skips everything (M4: approved rows carry the ledger keyword)", async () => {
    const registry = createInMemoryCoreRegistry();
    const addFailure = seedBase(registry);
    addFailure(PRIOR_SESSION, "auth middleware crashes", "TypeError: x is undefined");
    addFailure(CURRENT_SESSION, "auth middleware crashes", "TypeError: x is undefined");
    addFailure(CURRENT_SESSION, "build the cli bundle", "ENOENT: missing dist/cli.js");

    const first = await run(registry);
    expect(first.autoApproved).toHaveLength(1);
    // M4 precondition: the APPROVED row itself carries the from-session: keyword.
    expect(first.autoApproved[0]?.keywords.some((k) => k.startsWith("from-session:"))).toBe(true);

    const second = await run(registry);
    expect(second).toEqual({ autoApproved: [], staged: [], skippedExisting: 2, cappedOut: 0 });
    expect(registry.listMemoryEntries(PROJECT_ID)).toHaveLength(2);
  });

  it("stays idempotent when a NEW failure lands between runs (m10 ordering pin)", async () => {
    const registry = createInMemoryCoreRegistry();
    const addFailure = seedBase(registry);
    addFailure(CURRENT_SESSION, "build the cli bundle", "ENOENT: missing dist/cli.js");
    const first = await run(registry);
    expect(first.staged).toHaveLength(1);

    addFailure(CURRENT_SESSION, "run lint", "no-unused-vars");
    const second = await run(registry);
    expect(second.skippedExisting).toBe(1);
    expect(second.staged).toHaveLength(1);
    expect(second.staged[0]?.title).toBe("run lint");
    expect(registry.listMemoryEntries(PROJECT_ID)).toHaveLength(2);
  });
});

describe("runAutopilot --dry-run", () => {
  let rootDir: string;
  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), "megasaver-autopilot-dry-"));
  });
  afterEach(() => rmSync(rootDir, { recursive: true, force: true }));

  function snapshot(dir: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const rel of readdirSync(dir, { recursive: true }) as string[]) {
      const full = join(dir, rel);
      if (statSync(full).isFile()) out.set(rel, readFileSync(full, "utf8"));
    }
    return out;
  }

  it("builds both sets but writes NOTHING (store byte-identical)", async () => {
    const registry = createJsonDirectoryCoreRegistry({ rootDir });
    const addFailure = seedBase(registry);
    addFailure(PRIOR_SESSION, "auth middleware crashes", "TypeError: x is undefined");
    addFailure(CURRENT_SESSION, "auth middleware crashes", "TypeError: x is undefined");
    addFailure(CURRENT_SESSION, "build the cli bundle", "ENOENT: missing dist/cli.js");

    const before = snapshot(rootDir);
    const result = await run(registry, { dryRun: true });

    expect(result.autoApproved).toHaveLength(1);
    expect(result.staged).toHaveLength(1);
    expect(result.autoApproved[0]?.approval).toBe("approved");
    expect(snapshot(rootDir)).toEqual(before);
    expect(registry.listMemoryEntries(PROJECT_ID)).toEqual([]);
  });
});

describe("runAutopilot code anchors (real git repo)", () => {
  let repo: string;

  function git(args: string[], cwd: string): string {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  }

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "megasaver-autopilot-anchor-"));
    git(["init"], repo);
    git(["config", "user.email", "t@t"], repo);
    git(["config", "user.name", "t"], repo);
    writeFileSync(join(repo, "a.ts"), "export function foo(): number {\n  return 1;\n}\n");
    git(["add", "."], repo);
    git(["commit", "-m", "add a"], repo);
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("captures the anchor on BOTH the approved and staged branches", async () => {
    const registry = createInMemoryCoreRegistry();
    const addFailure = seedBase(registry, repo);
    addFailure(PRIOR_SESSION, "auth middleware crashes", "TypeError: x is undefined", ["a.ts"]);
    addFailure(CURRENT_SESSION, "auth middleware crashes", "TypeError: x is undefined", ["a.ts"]);
    addFailure(CURRENT_SESSION, "build the cli bundle", "ENOENT: missing dist/cli.js", ["a.ts"]);

    const result = await run(registry);

    expect(result.autoApproved).toHaveLength(1);
    expect(result.staged).toHaveLength(1);
    const head = git(["rev-parse", "HEAD"], repo).trim();
    const blobSha = git(["rev-parse", "HEAD:a.ts"], repo).trim();
    // Spec §5.2: autopilot mirrors the CLI from-session path — an auto-approved
    // row is worth no less provenance than a staged one, so BOTH branches carry
    // the same anchor and cited files.
    for (const entry of [result.autoApproved[0], result.staged[0]]) {
      expect(entry?.relatedFiles).toEqual(["a.ts"]);
      expect(entry?.anchor?.repoHead).toBe(head);
      expect(entry?.anchor?.files).toEqual([{ path: "a.ts", blobSha }]);
      expect(entry?.anchor?.capturedAt).toBe(NOW);
    }
  });
});
