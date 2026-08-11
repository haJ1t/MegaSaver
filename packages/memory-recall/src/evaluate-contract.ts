import { type MemoryEntry, isRecallable } from "@megasaver/core";
import { estimateTokens } from "@megasaver/output-filter";
import type { ProjectId } from "@megasaver/shared";
import type { Contract, ContractEvidence } from "./contract.js";
import { rankProjectMemories } from "./rank-project-memories.js";

export type ContractFindingReason =
  | "entry-missing"
  | "entry-stale"
  | "entry-not-recallable"
  | "ranked-below-budget"
  | "no-entry-in-cut";

export type ContractFinding = {
  evidence: ContractEvidence;
  status: "pass" | "fail";
  reason?: ContractFindingReason;
  entryId?: string;
  entryTitle?: string;
  rankPosition?: number;
  detail: string;
};

export type ContractResult = {
  name: string;
  pass: boolean;
  findings: ContractFinding[];
  cut: { size: number; tokenEstimate: number; rankedTotal: number };
};

const normalizePath = (value: string): string => value.replaceAll("\\", "/");

export async function evaluateContract(input: {
  contract: Contract;
  projectId: ProjectId;
  entries: readonly MemoryEntry[];
  storeRoot: string;
  asOf: string;
}): Promise<ContractResult> {
  const ranked = (
    await rankProjectMemories({
      projectId: input.projectId,
      entries: input.entries,
      task: input.contract.intent,
      storeRoot: input.storeRoot,
      query: { includeStale: false, limit: Math.max(1, input.entries.length), asOf: input.asOf },
      profile: "safe",
    })
  ).memory;
  const cut: MemoryEntry[] = [];
  const rendered: string[] = [];
  for (const entry of ranked) {
    const candidate = [...rendered, `${entry.title}\n${entry.content}`].join("\n");
    if (estimateTokens(candidate) > input.contract.tokenBudget) break;
    rendered.push(`${entry.title}\n${entry.content}`);
    cut.push(entry);
  }
  const findings = input.contract.requiredEvidence.map((evidence) =>
    findingFor(evidence, { cut, ranked, entries: input.entries, asOf: input.asOf }),
  );
  return {
    name: input.contract.name,
    pass: findings.every((f) => f.status === "pass"),
    findings,
    cut: {
      size: cut.length,
      tokenEstimate: estimateTokens(rendered.join("\n")),
      rankedTotal: ranked.length,
    },
  };
}

function findingFor(
  evidence: ContractEvidence,
  ctx: {
    cut: readonly MemoryEntry[];
    ranked: readonly MemoryEntry[];
    entries: readonly MemoryEntry[];
    asOf: string;
  },
): ContractFinding {
  if (evidence.kind === "memory-entry-ref") {
    const inCut = ctx.cut.find((entry) => entry.id === evidence.value);
    if (inCut) {
      return {
        evidence,
        status: "pass",
        entryId: inCut.id,
        entryTitle: inCut.title,
        detail: `entry ${inCut.id} ("${inCut.title}") is in the cut`,
      };
    }
    const entry = ctx.entries.find((candidate) => candidate.id === evidence.value);
    if (!entry) {
      return {
        evidence,
        status: "fail",
        reason: "entry-missing",
        detail: `no memory entry with id ${evidence.value} exists in this project`,
      };
    }
    const named = { entryId: entry.id, entryTitle: entry.title };
    if (entry.stale) {
      return {
        evidence,
        status: "fail",
        reason: "entry-stale",
        ...named,
        detail: `entry ${entry.id} ("${entry.title}") is marked stale`,
      };
    }
    if (!isRecallable(entry, ctx.asOf)) {
      const gate =
        entry.approval !== "approved"
          ? `approval is "${entry.approval}", not "approved"`
          : (entry.tier ?? "recall") === "archival"
            ? "tier is archival (hidden from recall)"
            : `validity window [${entry.validFrom ?? "-inf"}, ${entry.validTo ?? "inf"}) excludes ${ctx.asOf}`;
      return {
        evidence,
        status: "fail",
        reason: "entry-not-recallable",
        ...named,
        detail: `entry ${entry.id} ("${entry.title}") is not recallable: ${gate}`,
      };
    }
    const rankPosition = ctx.ranked.findIndex((candidate) => candidate.id === entry.id) + 1;
    return {
      evidence,
      status: "fail",
      reason: "ranked-below-budget",
      ...named,
      ...(rankPosition > 0 ? { rankPosition } : {}),
      detail:
        rankPosition > 0
          ? `entry ${entry.id} ("${entry.title}") ranked #${rankPosition} of ${ctx.ranked.length} but the token-budget cut ends at #${ctx.cut.length}`
          : `entry ${entry.id} ("${entry.title}") was excluded before ranking`,
    };
  }
  const matches =
    evidence.kind === "file-ref"
      ? (entry: MemoryEntry) =>
          (entry.relatedFiles ?? []).some((file) => normalizePath(file) === normalizePath(evidence.value))
      : (entry: MemoryEntry) =>
          [entry.title, entry.content, ...entry.keywords].some((text) =>
            text.toLowerCase().includes(evidence.value.toLowerCase()),
          );
  const hit = ctx.cut.find(matches);
  if (hit) {
    return {
      evidence,
      status: "pass",
      entryId: hit.id,
      entryTitle: hit.title,
      detail: `${evidence.kind} "${evidence.value}" matched entry ${hit.id} ("${hit.title}") in the cut`,
    };
  }
  return {
    evidence,
    status: "fail",
    reason: "no-entry-in-cut",
    detail: `no entry in the ${ctx.cut.length}-entry cut matches ${evidence.kind} "${evidence.value}"`,
  };
}
