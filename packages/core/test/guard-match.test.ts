import type { GuardCorpusRow } from "@megasaver/context-gate";
import { describe, expect, it } from "vitest";
import type { FailedAttempt } from "../src/failed-attempt.js";
import { type GuardCandidate, matchGuard, normalizeCommand } from "../src/guard-match.js";

const ASOF = "2026-07-12T10:00:00.000Z";
const FRESH = "2026-07-01T10:00:00.000Z"; // 11 days old
const STALE = "2026-06-01T10:00:00.000Z"; // 41 days old

function attempt(over: Partial<FailedAttempt> = {}): GuardCandidate {
  return {
    kind: "failed-attempt",
    attempt: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      projectId: "11111111-1111-4111-8111-111111111111",
      sessionId: null,
      task: "run the test shard",
      failedStep: "pnpm vitest --shard 2",
      errorOutput: "Error: unknown option '--shard'",
      relatedFiles: [],
      convertedToRule: false,
      createdAt: FRESH,
      ...over,
    } as FailedAttempt,
  };
}

function corpusRow(over: Partial<GuardCorpusRow> = {}): GuardCandidate {
  return {
    kind: "auto-capture",
    row: {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      command: "pnpm vitest --shard 2",
      errorOutput: "Error: unknown option '--shard'",
      wastedTokens: 4200,
      createdAt: FRESH,
      ...over,
    },
  };
}

function bash(command: string, candidates: GuardCandidate[], over = {}) {
  return matchGuard({
    call: { tool: "Bash", command },
    candidates,
    mutedIds: [],
    firedIds: [],
    asOf: ASOF,
    ...over,
  });
}

describe("normalizeCommand", () => {
  it("collapses whitespace runs and trims", () => {
    expect(normalizeCommand("  pnpm   vitest  --shard 2 ")).toBe("pnpm vitest --shard 2");
  });
  it("does NOT strip env-assignment prefixes (they change behavior)", () => {
    expect(normalizeCommand("CI=1 NODE_ENV=test pnpm vitest")).toBe(
      "CI=1 NODE_ENV=test pnpm vitest",
    );
  });
  it("does NOT reorder flags (deferred, semantic risk)", () => {
    expect(normalizeCommand("ls -a -l")).not.toBe(normalizeCommand("ls -l -a"));
  });
});

describe("T1 exact", () => {
  it("hits on whitespace variants of a corpus command", () => {
    const m = bash("  pnpm   vitest --shard 2 ", [corpusRow()]);
    expect(m?.tier).toBe("t1");
    expect(m?.action).toBe("deny-capable");
  });
  it("does NOT T1-deny an env-prefixed variant (env changes behavior)", () => {
    // regression: NODE_ENV=production npm build must not exact-match a stored
    // `npm build` failure and get denied in strict mode.
    const m = bash("NODE_ENV=production pnpm vitest --shard 2", [corpusRow()]);
    expect(m?.action).not.toBe("deny-capable");
  });
  it("hits on a FailedAttempt whose failedStep normalizes to the command", () => {
    const m = bash("pnpm vitest --shard 2", [attempt()]);
    expect(m?.tier).toBe("t1");
  });
  it("misses when the candidate is older than 30 days (falls to T3 at most)", () => {
    const m = bash("pnpm vitest --shard 2", [corpusRow({ createdAt: STALE })]);
    expect(m?.tier).not.toBe("t1");
  });
  it("30-day boundary is strict: exactly 30 days old does NOT T1-match", () => {
    const m = bash("pnpm vitest --shard 2", [corpusRow({ createdAt: "2026-06-12T10:00:00.000Z" })]);
    expect(m?.tier).not.toBe("t1");
  });
  it("resolved FailedAttempt never denies — emits recall instead", () => {
    const m = bash("pnpm vitest --shard 2", [attempt({ resolution: "use --shard=2/2" })]);
    expect(m?.action).toBe("recall");
  });
  it("documented miss: quoting is lost in stored argv-joins", () => {
    // stored corpus command has no quotes; the live command with quotes
    // normalizes differently — expected miss at T1 (may still T3-match).
    const m = bash('grep "foo bar" x', [corpusRow({ command: "grep foo bar x" })]);
    expect(m?.tier).not.toBe("t1");
  });
});

describe("exclusions", () => {
  it("muted ids never match", () => {
    const c = corpusRow();
    const m = bash("pnpm vitest --shard 2", [c], {
      mutedIds: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
    });
    expect(m).toBeNull();
  });
  it("already-fired ids never match (per-session cooldown)", () => {
    const m = bash("pnpm vitest --shard 2", [corpusRow()], {
      firedIds: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
    });
    expect(m).toBeNull();
  });
  it("convertedToRule attempts are excluded everywhere", () => {
    const m = bash("pnpm vitest --shard 2", [attempt({ convertedToRule: true })]);
    expect(m).toBeNull();
  });
});

describe("T2 path (edit tools, two-signal)", () => {
  const editAttempt = attempt({
    failedStep: "edited token refresh to use < instead of <=",
    relatedFiles: ["src/auth/middleware.ts"],
    errorOutput: "TokenExpiredError: jwt expired",
  });
  function edit(filePath: string, text: string) {
    return matchGuard({
      call: { tool: "Edit", filePath, text },
      candidates: [editAttempt],
      mutedIds: [],
      firedIds: [],
      asOf: ASOF,
    });
  }
  it("warns when path intersects relatedFiles AND text BM25-matches", () => {
    const m = edit("/repo/src/auth/middleware.ts", "token refresh expired jwt check");
    expect(m?.tier).toBe("t2");
    expect(m?.action).toBe("warn");
  });
  it("misses on path-only (no text signal)", () => {
    expect(edit("/repo/src/auth/middleware.ts", "completely unrelated edit zzz qqq")).toBeNull();
  });
  it("misses on text-only (no path signal)", () => {
    expect(edit("/repo/src/other/file.ts", "token refresh expired jwt check")).toBeNull();
  });
});

describe("T3 BM25 (Bash, conservative)", () => {
  it("warns on a near-verbatim replay of a stale-but-relevant failure", () => {
    const m = bash("pnpm vitest run --shard 2 --reporter dot", [corpusRow({ createdAt: STALE })]);
    expect(m?.tier).toBe("t3");
    expect(m?.action).toBe("warn");
  });
  it("misses on prose that merely mentions a command word", () => {
    expect(bash("echo done", [corpusRow({ createdAt: STALE })])).toBeNull();
  });
  it("misses when top-1 has no margin over top-2 (ambiguous corpus)", () => {
    const a = corpusRow({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      command: "pnpm vitest run suite-a",
      errorOutput: "timeout in suite-a",
      createdAt: STALE,
    });
    const b = corpusRow({
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      command: "pnpm vitest run suite-b",
      errorOutput: "timeout in suite-b",
      createdAt: STALE,
    });
    expect(bash("pnpm vitest run", [a, b])).toBeNull();
  });
});
