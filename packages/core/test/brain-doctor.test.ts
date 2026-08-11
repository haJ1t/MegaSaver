import { describe, expect, it } from "vitest";
import {
  DOCTOR_CONFLICT_SCAN_CAP,
  DOCTOR_DECAYED_AGE_MS,
  diagnoseMemoryHealth,
} from "../src/brain-doctor.js";
import { DECAY_HALF_LIFE_MS } from "../src/memory-entry.js";
import type { MemoryEntry } from "../src/memory-entry.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-08-06T00:00:00.000Z";

const mk = (id: string, over: Partial<MemoryEntry> = {}): MemoryEntry =>
  ({
    id,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "t",
    content: "use pnpm not npm",
    keywords: ["pnpm"],
    confidence: "medium",
    source: "agent",
    approval: "approved",
    stale: false,
    relatedFiles: ["package.json"],
    createdAt: "2026-06-16T12:00:00.000Z",
    updatedAt: "2026-06-16T12:00:00.000Z",
    ...over,
  }) as MemoryEntry;

describe("brain doctor", () => {
  it("flags a stale entry with its id and a sweep repair", () => {
    const stale = mk("00000000-0000-4000-8000-0000000000a1", { stale: true });
    const { findings } = diagnoseMemoryHealth([stale], NOW);
    const f = findings.find((x) => x.check === "stale-flagged");
    expect(f?.severity).toBe("warn");
    expect(f?.evidence.entryIds).toEqual([stale.id]);
    expect(f?.repair).toContain("mega memory sweep");
  });

  it("flags decay strictly past two half-lives, keyed on lastActiveAt", () => {
    const at = (ms: number) => new Date(Date.parse(NOW) - ms).toISOString();
    const fresh = mk("00000000-0000-4000-8000-0000000000a2", {
      lastActiveAt: at(DOCTOR_DECAYED_AGE_MS),
    });
    const old = mk("00000000-0000-4000-8000-0000000000a3", {
      lastActiveAt: at(DOCTOR_DECAYED_AGE_MS + 1),
    });
    const { findings } = diagnoseMemoryHealth([fresh, old], NOW);
    const decayed = findings.filter((x) => x.check === "decayed");
    expect(decayed.flatMap((x) => x.evidence.entryIds)).toEqual([old.id]);
    expect(decayed[0]?.severity).toBe("info");
  });

  it("decay falls back lastActiveAt -> updatedAt -> createdAt and skips stale/suggested rows", () => {
    const oldTs = new Date(Date.parse(NOW) - DOCTOR_DECAYED_AGE_MS - 1).toISOString();
    const viaUpdated = mk("00000000-0000-4000-8000-0000000000a4", { updatedAt: oldTs });
    const staleOld = mk("00000000-0000-4000-8000-0000000000a5", { updatedAt: oldTs, stale: true });
    const suggestedOld = mk("00000000-0000-4000-8000-0000000000a6", {
      updatedAt: oldTs,
      approval: "suggested",
    });
    const { findings } = diagnoseMemoryHealth([viaUpdated, staleOld, suggestedOld], NOW);
    const ids = findings.filter((x) => x.check === "decayed").flatMap((x) => x.evidence.entryIds);
    expect(ids).toEqual([viaUpdated.id]);
  });

  it("summary reuses isRecallable for recallableNow", () => {
    const ok = mk("00000000-0000-4000-8000-0000000000a7");
    const suggested = mk("00000000-0000-4000-8000-0000000000a8", { approval: "suggested" });
    const archival = mk("00000000-0000-4000-8000-0000000000a9", { tier: "archival" });
    const closed = mk("00000000-0000-4000-8000-0000000000aa", {
      validTo: "2026-08-01T00:00:00.000Z",
    });
    const { summary } = diagnoseMemoryHealth([ok, suggested, archival, closed], NOW);
    expect(summary).toEqual({ total: 4, recallableNow: 1, suggested: 1, staleFlagged: 0 });
  });

  it("reports a stored code contradiction as error citing the verify stamp", () => {
    const entry = mk("00000000-0000-4000-8000-0000000000b1", {
      anchor: { repoHead: "deadbeef", capturedAt: NOW, files: [], symbols: [] },
      lastVerified: {
        headSha: "deadbeef",
        at: NOW,
        result: "contradicted",
        closedByCodeTruth: false,
      },
    });
    const { findings } = diagnoseMemoryHealth([entry], NOW);
    const f = findings.find((x) => x.check === "contradicted-by-code");
    expect(f?.severity).toBe("error");
    expect(f?.evidence.entryIds).toEqual([entry.id]);
    expect(f?.repair).toContain("mega memory verify");
  });

  it("reports one deduped rule-polarity contradiction pair", () => {
    const rule = mk("00000000-0000-4000-8000-0000000000c1", {
      type: "project_rule",
      keywords: ["skip", "ci"],
      relatedFiles: ["turbo.json"],
      content: "skip ci on docs-only changes",
    });
    const other = mk("00000000-0000-4000-8000-0000000000c2", {
      type: "decision",
      keywords: ["ci"],
      relatedFiles: ["turbo.json"],
      content: "always run ci",
    });
    const { findings } = diagnoseMemoryHealth([rule, other], NOW);
    const pairs = findings.filter((x) => x.check === "rule-contradiction");
    expect(pairs).toHaveLength(1);
    expect([...(pairs[0]?.evidence.entryIds ?? [])].sort()).toEqual([rule.id, other.id].sort());
    expect(pairs[0]?.severity).toBe("warn");
    expect(pairs[0]?.repair).toContain("mega memory reject");
  });

  it("caps the pairwise scan at DOCTOR_CONFLICT_SCAN_CAP and discloses truncation", () => {
    const many = Array.from({ length: DOCTOR_CONFLICT_SCAN_CAP + 1 }, (_, i) =>
      mk(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, {
        content: `unique content ${i}`,
        relatedFiles: [],
      }),
    );
    const { findings } = diagnoseMemoryHealth(many, NOW);
    expect(findings.some((x) => x.check === "conflict-scan-truncated")).toBe(true);
  });

  it("flags an approved supersession whose target is still open", () => {
    const target = mk("00000000-0000-4000-8000-0000000000d1");
    const winner = mk("00000000-0000-4000-8000-0000000000d2", {
      supersedesId: target.id,
      content: "replacement rule",
    });
    const { findings } = diagnoseMemoryHealth([target, winner], NOW);
    const f = findings.find((x) => x.check === "lineage-conflict");
    expect(f?.severity).toBe("error");
    expect(f?.evidence.entryIds).toEqual([winner.id, target.id]);
    expect(f?.repair).toContain("mega memory history");
  });

  it("does not flag a properly closed supersession", () => {
    const target = mk("00000000-0000-4000-8000-0000000000d3", {
      validTo: "2026-08-01T00:00:00.000Z",
    });
    const winner = mk("00000000-0000-4000-8000-0000000000d4", { supersedesId: target.id });
    const { findings } = diagnoseMemoryHealth([target, winner], NOW);
    expect(findings.some((x) => x.check === "lineage-conflict")).toBe(false);
  });

  it("flags a dangling supersedesId as warn", () => {
    const winner = mk("00000000-0000-4000-8000-0000000000d5", {
      supersedesId: "00000000-0000-4000-8000-00000000dead" as never,
    });
    const { findings } = diagnoseMemoryHealth([winner], NOW);
    const f = findings.find((x) => x.check === "lineage-conflict");
    expect(f?.severity).toBe("warn");
  });

  it("aggregates the suggested backlog; old backlog escalates to warn", () => {
    const freshSuggested = mk("00000000-0000-4000-8000-0000000000e1", {
      approval: "suggested",
      createdAt: "2026-08-05T00:00:00.000Z",
    });
    const info = diagnoseMemoryHealth([freshSuggested], NOW);
    expect(info.findings.find((x) => x.check === "suggestion-backlog")?.severity).toBe("info");

    const oldSuggested = mk("00000000-0000-4000-8000-0000000000e2", {
      approval: "suggested",
      createdAt: "2026-07-01T00:00:00.000Z", // 36d >= 14d threshold
    });
    const warn = diagnoseMemoryHealth([oldSuggested], NOW);
    const f = warn.findings.find((x) => x.check === "suggestion-backlog");
    expect(f?.severity).toBe("warn");
    expect(f?.repair).toContain("mega memory review");
  });
});
