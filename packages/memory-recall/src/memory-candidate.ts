import { createHash } from "node:crypto";
import type { MemoryEntry } from "@megasaver/core";
import type { Lm2Candidate } from "@megasaver/long-memory";
import type { WorkspaceKey } from "@megasaver/shared";

export function memoryCandidate(entry: MemoryEntry, workspaceKey: WorkspaceKey): Lm2Candidate {
  const text = `${entry.title}\n${entry.content}\n${entry.keywords.join(" ")}`.trim();
  return {
    id: entry.id,
    workspaceKey,
    observedAt: entry.lastActiveAt ?? entry.updatedAt,
    kind: "memory_entry",
    text,
    sourceDigest: createHash("sha256").update(text, "utf8").digest("hex"),
  };
}
