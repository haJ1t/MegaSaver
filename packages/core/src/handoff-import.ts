import { memoryEntryIdSchema } from "@megasaver/shared";
import type { ProjectId } from "@megasaver/shared";
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
  badges: { memoryId: string; badge: string }[];
}

// importBrain's safeguards, memories only (failures are inspect-only in v1).
// Session-scoped packet entries land project-scoped with sessionId null: the
// sender's session ids mean nothing in the receiving store (brain-import
// precedent). Badges are recomputed locally over the CREATED rows so a
// hostile packet can never assert "verified".
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
  const badges: { memoryId: string; badge: string }[] = [];

  for (const entry of input.packet.payload.memories) {
    if (contentKeys.has(entry.content)) {
      skipped += 1;
      continue;
    }
    const { supersedesId: _dropped, ...rest } = entry;
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
      evidence: [...(entry.evidence ?? []), provenance],
    });
    contentKeys.add(entry.content);
    imported += 1;
    badges.push({ memoryId: created.id, badge: verificationBadgeFor(created) });
  }

  return { imported, skipped, badges };
}
