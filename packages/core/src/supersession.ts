import type { MemoryEntryId } from "@megasaver/shared";
import type { MemoryEntry } from "./memory-entry.js";
import type { CoreRegistry } from "./registry.js";

// The bi-temporal validTo-close block, extracted verbatim from the approve
// flip (mcp-bridge approve-memory.ts). supersedesId is agent-controlled (the
// schema only checks UUID shape), so the target is validated before closing
// its validity, or an agent could (a) close a CURRENT memory in another
// project/scope it should not touch, or (b) self-reference to close its own
// validity — approved yet instantly non-current, silently vanishing from
// default recall. So close ONLY a different, same-project, same-scope,
// still-open target. Invalid targets skip silently (closed: false) exactly as
// today; the return value makes the outcome disclosable at decision surfaces.
export function applySupersession(
  registry: CoreRegistry,
  entry: MemoryEntry,
  now: () => string,
): { closed: boolean; superseded?: { id: MemoryEntryId; title: string } } {
  if (entry.supersedesId === undefined) return { closed: false };
  const superseded = registry.getMemoryEntry(entry.supersedesId);
  const targetIsValid =
    superseded !== null &&
    superseded.id !== entry.id &&
    superseded.projectId === entry.projectId &&
    superseded.scope === entry.scope &&
    superseded.validTo == null;
  if (!targetIsValid) return { closed: false };
  registry.updateMemoryEntry(superseded.id, {
    validTo: now(),
    updatedAt: now(),
  });
  return { closed: true, superseded: { id: superseded.id, title: superseded.title } };
}
