import type { Session } from "@megasaver/core";
import { describe, expect, it } from "vitest";
import { pickLatestOpenSession } from "../../src/commands/connector/shared.js";

// Minimal Session factory — only fields consumed by pickLatestOpenSession.
function makeSession(
  id: string,
  agentId: string,
  startedAt: string,
  endedAt: string | null = null,
): Session {
  return {
    id,
    projectId: "00000000-0000-4000-8000-000000000001",
    agentId: agentId as Session["agentId"],
    riskLevel: "medium",
    title: null,
    startedAt,
    endedAt,
  };
}

describe("pickLatestOpenSession — T1: basic cases", () => {
  it("returns null when session list is empty", () => {
    expect(pickLatestOpenSession([], "claude-code")).toBeNull();
  });

  it("returns the single open session when exactly one exists", () => {
    const s = makeSession(
      "11111111-1111-4111-8111-111111111111",
      "claude-code",
      "2026-05-09T10:00:00.000Z",
    );
    expect(pickLatestOpenSession([s], "claude-code")).toBe(s);
  });

  it("returns the open session when one is ended and one is open", () => {
    const ended = makeSession(
      "22222222-2222-4222-8222-222222222222",
      "claude-code",
      "2026-05-09T08:00:00.000Z",
      "2026-05-09T09:00:00.000Z",
    );
    const open = makeSession(
      "33333333-3333-4333-8333-333333333333",
      "claude-code",
      "2026-05-09T10:00:00.000Z",
    );
    expect(pickLatestOpenSession([ended, open], "claude-code")).toBe(open);
  });

  it("returns the session with the later startedAt when two are open", () => {
    const earlier = makeSession(
      "44444444-4444-4444-8444-444444444444",
      "claude-code",
      "2026-05-09T10:00:00.000Z",
    );
    const later = makeSession(
      "55555555-5555-4555-8555-555555555555",
      "claude-code",
      "2026-05-09T12:00:00.000Z",
    );
    expect(pickLatestOpenSession([earlier, later], "claude-code")).toBe(later);
  });

  it("filters out sessions with a different agentId", () => {
    const codex = makeSession(
      "66666666-6666-4666-8666-666666666666",
      "codex",
      "2026-05-09T12:00:00.000Z",
    );
    expect(pickLatestOpenSession([codex], "claude-code")).toBeNull();
  });
});

describe("pickLatestOpenSession — T3: same-instant tie-break", () => {
  // Two open sessions with identical startedAt for the same agentId.
  // The implementation uses Array.reduce with strict '>'. When timestamps
  // are equal, current is NOT strictly greater, so latest (the accumulator,
  // i.e. the first element) is kept. Index-0 session wins.
  it("returns the FIRST (index-0) session when startedAt timestamps are identical", () => {
    const first = makeSession(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "claude-code",
      "2026-05-09T10:00:00.000Z",
    );
    const second = makeSession(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "claude-code",
      "2026-05-09T10:00:00.000Z",
    );
    // first is at index 0; identical timestamps → reduce keeps first (accumulator).
    expect(pickLatestOpenSession([first, second], "claude-code")).toBe(first);
  });
});

describe("pickLatestOpenSession — T4: DST-transition ranking", () => {
  // US spring-forward 2026: clocks skip from 02:00 to 03:00 on 2026-03-13.
  // Session A: 2026-03-13T01:30:00.000Z (UTC, before the transition, earlier instant)
  // T4 must use timestamps where lex and numeric ordering DISAGREE so a
  // buggy lex-comparison would pick the WRONG session. Date prefix shared, but
  // timezone offsets diverge: A=10:00+02:00 (UTC 08:00), B=09:00Z (UTC 09:00).
  // Lex order: A > B (because "T10..." > "T09..."). Numeric order: B > A
  // (because UTC 09:00 > UTC 08:00). pickLatestOpenSession MUST return B.
  it("ranks by numeric UTC instant, not by lexicographic string order", () => {
    const lexLaterButEarlierInstant = makeSession(
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      "claude-code",
      "2026-03-13T10:00:00+02:00",
    );
    const lexEarlierButLaterInstant = makeSession(
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      "claude-code",
      "2026-03-13T09:00:00Z",
    );
    expect(
      pickLatestOpenSession(
        [lexLaterButEarlierInstant, lexEarlierButLaterInstant],
        "claude-code",
      ),
    ).toBe(lexEarlierButLaterInstant);
  });
});

describe("pickLatestOpenSession — T5: millisecond precision", () => {
  it("picks the session that started 1ms later", () => {
    const earlier = makeSession(
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      "claude-code",
      "2026-05-09T10:00:00.000Z",
    );
    const laterByOneMs = makeSession(
      "ffffffff-ffff-4fff-8fff-ffffffffffff",
      "claude-code",
      "2026-05-09T10:00:00.001Z",
    );
    expect(pickLatestOpenSession([earlier, laterByOneMs], "claude-code")).toBe(laterByOneMs);
  });
});

describe("pickLatestOpenSession — S7: three open sessions, strictly increasing startedAt", () => {
  it("returns the most recent (last by time) when three sessions are open", () => {
    const oldest = makeSession(
      "11111111-1111-4111-8111-aaaaaaaaaaaa",
      "claude-code",
      "2026-05-09T08:00:00.000Z",
    );
    const middle = makeSession(
      "22222222-2222-4222-8222-aaaaaaaaaaaa",
      "claude-code",
      "2026-05-09T10:00:00.000Z",
    );
    const newest = makeSession(
      "33333333-3333-4333-8333-aaaaaaaaaaaa",
      "claude-code",
      "2026-05-09T12:00:00.000Z",
    );
    // Array order: oldest first. pickLatestOpenSession must still return newest.
    expect(pickLatestOpenSession([oldest, middle, newest], "claude-code")).toBe(newest);
  });
});
