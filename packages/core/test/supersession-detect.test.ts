import type { MemoryEntryId, SessionId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import type { MemoryEntry } from "../src/memory-entry.js";
import {
  POSSIBLE_SUPERSEDES_PREFIX,
  SUPERSEDE_COSINE_AMBIGUOUS,
  SUPERSEDE_COSINE_LINK,
  SUPERSEDE_TOP_K,
  type SupersessionDetection,
  detectSupersession,
  eligibleSupersessionCorpus,
} from "../src/supersession.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_A = "33333333-3333-4333-8333-333333333333" as SessionId;
const SESSION_B = "44444444-4444-4444-8444-444444444444" as SessionId;
const NOW = "2026-07-13T12:00:00.000Z";
const PAST_CLOSE = "2026-07-01T00:00:00.000Z";
const CAND_ID = "00000000-0000-4000-8000-0000000000c0" as MemoryEntryId;
const ID_B1 = "00000000-0000-4000-8000-0000000000b1" as MemoryEntryId;
const ID_K = "00000000-0000-4000-8000-0000000000b2" as MemoryEntryId;
const ID_D1 = "00000000-0000-4000-8000-0000000000d1" as MemoryEntryId;
const ID_D2 = "00000000-0000-4000-8000-0000000000d2" as MemoryEntryId;
const ID_D3 = "00000000-0000-4000-8000-0000000000d3" as MemoryEntryId;
const ID_D4 = "00000000-0000-4000-8000-0000000000d4" as MemoryEntryId;
const ID_D5 = "00000000-0000-4000-8000-0000000000d5" as MemoryEntryId;
const ID_D6 = "00000000-0000-4000-8000-0000000000d6" as MemoryEntryId;

// Cast-style fixtures (conflict-checker.test.ts precedent): terse, and lets
// scope/session combinations be built without registry ceremony.
const mk = (id: string, over: Partial<MemoryEntry> = {}): MemoryEntry =>
  ({
    id,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "install tooling",
    content: "use pnpm not npm",
    keywords: ["pnpm"],
    confidence: "medium",
    source: "agent",
    approval: "approved",
    stale: false,
    relatedFiles: ["package.json"],
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
    ...over,
  }) as MemoryEntry;

describe("supersession constants", () => {
  it("fixtures-are-the-spec: constants pinned", () => {
    expect(SUPERSEDE_TOP_K).toBe(5);
    expect(SUPERSEDE_COSINE_LINK).toBe(0.8);
    expect(SUPERSEDE_COSINE_AMBIGUOUS).toBe(0.6);
    expect(POSSIBLE_SUPERSEDES_PREFIX).toBe("possible-supersedes:");
  });
});

describe("eligibleSupersessionCorpus", () => {
  it("keeps same-project same-type approved recallable project-scope rows, drops the rest", () => {
    const candidate = mk(CAND_ID);
    const keep = mk(ID_K);
    const self = mk(CAND_ID);
    const otherProject = mk(ID_D1, { projectId: OTHER_PROJECT_ID as MemoryEntry["projectId"] });
    const otherType = mk(ID_D2, { type: "bug" });
    const unapproved = mk(ID_D3, { approval: "suggested" });
    const closed = mk(ID_D4, { validTo: PAST_CLOSE });
    const archival = mk(ID_D5, { tier: "archival" });
    const sessionScoped = mk(ID_D6, { scope: "session", sessionId: SESSION_A });

    const result = eligibleSupersessionCorpus(
      candidate,
      [keep, self, otherProject, otherType, unapproved, closed, archival, sessionScoped],
      NOW,
    );
    expect(result.map((e) => e.id)).toEqual([ID_K]);
  });

  it("session-scoped candidate matches only its own session", () => {
    const candidate = mk(CAND_ID, { scope: "session", sessionId: SESSION_A });
    const sameSession = mk(ID_K, { scope: "session", sessionId: SESSION_A });
    const otherSession = mk(ID_D1, { scope: "session", sessionId: SESSION_B });
    const projectScoped = mk(ID_D2);

    const result = eligibleSupersessionCorpus(
      candidate,
      [sameSession, otherSession, projectScoped],
      NOW,
    );
    expect(result.map((e) => e.id)).toEqual([ID_K]);
  });
});

describe("detectSupersession — lexical ladder", () => {
  type Case = {
    name: string;
    candidate: MemoryEntry;
    corpus: MemoryEntry[];
    expected: SupersessionDetection;
  };

  const cases: Case[] = [
    {
      name: "exact duplicate -> duplicate",
      candidate: mk(CAND_ID),
      corpus: [mk(ID_B1)],
      expected: { kind: "duplicate", existingId: ID_B1 },
    },
    {
      name: "file-overlap divergence (same type, different conclusion) -> supersede via supersession",
      candidate: mk(CAND_ID, { content: "use npm not pnpm", keywords: ["npm"] }),
      corpus: [mk(ID_B1)],
      expected: { kind: "supersede", supersededId: ID_B1, via: "supersession" },
    },
    {
      // Negation flip. NOTE: the corpus row is a different type (decision vs
      // project_rule) — with a same-type pair, checkConflicts' supersession
      // branch (same type + file overlap + different content) fires first.
      // detectSupersession takes the corpus as a parameter, so the ladder is
      // unit-tested here independent of eligibleSupersessionCorpus' same-type
      // filter (see the plan's open questions for the production wrinkle).
      name: "negation flip -> supersede via contradiction",
      candidate: mk(CAND_ID, {
        type: "project_rule",
        title: "merge shortcut",
        content: "merge without waiting for tests",
        keywords: ["merge", "skip"],
        relatedFiles: ["ci.yml"],
      }),
      corpus: [
        mk(ID_B1, {
          title: "merge gate",
          content: "tests must pass before merge",
          keywords: ["merge", "pass"],
          relatedFiles: ["ci.yml"],
        }),
      ],
      expected: { kind: "supersede", supersededId: ID_B1, via: "contradiction" },
    },
    {
      name: "unrelated -> none",
      candidate: mk(CAND_ID, {
        content: "auth uses JWT",
        keywords: ["jwt"],
        relatedFiles: ["src/auth.ts"],
      }),
      corpus: [mk(ID_B1)],
      expected: { kind: "none" },
    },
    {
      name: "empty corpus -> none",
      candidate: mk(CAND_ID),
      corpus: [],
      expected: { kind: "none" },
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(detectSupersession(c.candidate, c.corpus, NOW)).toEqual(c.expected);
    });
  }

  it("is deterministic under a fixed now (pure — repeat calls agree)", () => {
    const candidate = mk(CAND_ID, { content: "use npm not pnpm", keywords: ["npm"] });
    const corpus = [mk(ID_B1)];
    const first = detectSupersession(candidate, corpus, NOW);
    const second = detectSupersession(candidate, corpus, NOW);
    expect(second).toEqual(first);
    expect(second).toEqual({ kind: "supersede", supersededId: ID_B1, via: "supersession" });
  });
});
