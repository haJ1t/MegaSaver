import { memoryEntryIdSchema } from "@megasaver/shared";
import type { ProjectId } from "@megasaver/shared";
import { makeRedactor, redactMemory } from "./brain-export.js";
import { CoreRegistryError } from "./errors.js";
import type { HandoffPacket } from "./handoff-packet.js";
import type { CoreRegistry } from "./registry.js";
import { stripReservedKeywords } from "./session-memory.js";
import { verificationBadgeFor } from "./verification-badge.js";

export interface ApplyHandoffMemoriesInput {
  registry: CoreRegistry;
  projectId: ProjectId;
  packet: HandoffPacket;
  // Kept for contract symmetry with the rest of the handoff pipeline
  // (buildHandoffPacket/parseHandoffPacket both take `now`); unused here
  // because dedupe/badge recompute are content- and anchor-keyed, not clock-keyed.
  now: number;
  newId: () => string;
}

export interface HandoffMergeReport {
  imported: number;
  skipped: number;
  redactionFindings: number;
  badges: { memoryId: string; badge: string }[];
}

// importBrain's safeguards, memories only (failures are inspect-only in v1).
// Session-scoped packet entries land project-scoped with sessionId null: the
// sender's session ids mean nothing in the receiving store (brain-import
// precedent). Badges are recomputed locally over the CREATED rows: the badge
// FIELD cannot travel in the packet, but the OUTCOME is anchor-derived and
// thus attacker-steerable — any schema-valid anchor reads "verified", which
// means only "anchored, no known local contradiction" (stored-state
// semantics, verification-badge.ts). Merge-report renderers must convey that.
export function applyHandoffMemories(input: ApplyHandoffMemoriesInput): HandoffMergeReport {
  const project = input.registry.getProject(input.projectId);
  if (project === null) {
    throw new CoreRegistryError("project_not_found", `Project does not exist: ${input.projectId}`);
  }
  const provenance = `handoff:${input.packet.manifest.sourceProject.name}`;
  const existing = input.registry.listMemoryEntries(input.projectId);
  const contentKeys = new Set(existing.filter((m) => m.scope === "project").map((m) => m.content));

  let imported = 0;
  let skipped = 0;
  let redactionFindings = 0;
  const badges: { memoryId: string; badge: string }[] = [];

  for (const entry of input.packet.payload.memories) {
    // The registry is user-controlled state like a written file: an exotic
    // secret anywhere in a packet memory must be scrubbed before it persists,
    // matching the open-side block guarantee. Same redactor as the pack side, so
    // import can never scrub fewer fields than export does. Dedupe on the
    // REDACTED content so re-running a secret-bearing packet stays idempotent
    // (stored rows already hold the redacted form).
    const r = makeRedactor();
    const scrubbed = redactMemory(entry, r);
    if (contentKeys.has(scrubbed.content)) {
      skipped += 1;
      continue;
    }
    redactionFindings += r.total;
    // lastVerified is a LOCAL audit stamp: it asserts a verification event
    // that never happened in this repo, and closedByCodeTruth is an ownership
    // flag the code-truth heal path trusts. The anchor stays (re-verifiable
    // here); the stamp does not.
    const { supersedesId: _dropped, lastVerified: _stamp, ...rest } = scrubbed;
    const created = input.registry.createMemoryEntry({
      ...rest,
      id: memoryEntryIdSchema.parse(input.newId()),
      projectId: input.projectId,
      sessionId: null,
      scope: "project",
      approval: "suggested",
      // A packet is external keyword data: strip the reserved ledger namespace
      // so it can't plant a forged from-session: keyword that suppresses a
      // legitimate autopilot/from-session capture in this project.
      keywords: stripReservedKeywords(rest.keywords),
      evidence: [...(scrubbed.evidence ?? []), provenance],
    });
    contentKeys.add(scrubbed.content);
    imported += 1;
    badges.push({ memoryId: created.id, badge: verificationBadgeFor(created) });
  }

  return { imported, skipped, redactionFindings, badges };
}
