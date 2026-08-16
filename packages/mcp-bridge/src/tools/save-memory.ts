import {
  type CoreRegistry,
  type MemoryEntry,
  type SaveMemoryLineageResult,
  captureCodeAnchor,
  defaultWriteExpiresAt,
  memoryApprovalSchema,
  memoryConfidenceSchema,
  memoryEmbedText,
  memoryEmbeddingsSidecarPath,
  memoryEntrySchema,
  memoryScopeSchema,
  memorySourceSchema,
  memoryTypeSchema,
  saveMemoryWithLineage,
  stripReservedKeywords,
  verifyMemoryWrite,
} from "@megasaver/core";
import { CoreRegistryError } from "@megasaver/core";
import { embed, readVectors } from "@megasaver/embeddings";
import type { ProjectId } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";
import { resolveWritePointers } from "../write-verify-resolver.js";

export type SaveMemoryEnv = {
  registry: CoreRegistry;
  now: () => string;
  newId: () => string;
  // Cosine supersession inputs are best-effort: storeRoot locates the memory
  // vector sidecar; embedFn is injectable so tests never load the real model.
  storeRoot?: string;
  embedFn?: (texts: readonly string[]) => Promise<Float32Array[]>;
  // Injectable git runner threaded into captureCodeAnchor so anchor tests
  // never need a real repo. Absent ⇒ capture's execFileSync default. The third
  // argument is git's stdin (batched cat-file) and MUST be forwarded.
  execGit?: (args: string[], cwd: string, input?: string) => string;
  policyVersion?: string;
};

export type SaveMemoryResult = {
  id: string;
  supersession?: SaveMemoryLineageResult["supersession"];
  deduped?: SaveMemoryLineageResult["deduped"];
};

export const saveMemoryInputSchema = z
  .object({
    projectId: z.string().min(1),
    scope: memoryScopeSchema,
    content: z.string().min(1),
    type: memoryTypeSchema.optional(),
    title: z.string().min(1).optional(),
    keywords: z.array(z.string()).optional(),
    confidence: memoryConfidenceSchema.optional(),
    source: memorySourceSchema.optional(),
    approval: memoryApprovalSchema.optional(),
    sessionId: z.string().min(1).optional(),
    reason: z.string().min(1).optional(),
    goal: z.string().min(1).optional(),
    relatedFiles: z.array(z.string()).optional(),
    relatedSymbols: z.array(z.string()).optional(),
    evidence: z.array(z.string()).max(32).optional(),
    expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
    supersedesId: z.string().min(1).optional(),
  })
  .strict();

// CoreRegistry failures carry a closed code; surface it as the matching wire
// code so an MCP client sees why the write was rejected.
function mapCoreError(err: unknown): McpBridgeError {
  if (err instanceof CoreRegistryError) {
    if (err.code === "session_not_found") {
      return new McpBridgeError("session_not_found", err.message);
    }
    if (err.code === "project_not_found") {
      return new McpBridgeError("resource_not_found", err.message);
    }
    return new McpBridgeError("validation_failed", err.message);
  }
  if (err instanceof Error) return new McpBridgeError("validation_failed", err.message);
  return new McpBridgeError("validation_failed", "save_memory failed");
}

// Best-effort cosine inputs for supersession detection (living brain §4.2):
// only when a storeRoot is configured AND the sidecar has vectors. Embeds the
// candidate's title+content once. Any failure (no model, unreadable sidecar)
// degrades to lexical-only detection — never blocks the save.
async function cosineInputsFor(
  env: SaveMemoryEnv,
  entry: MemoryEntry,
): Promise<{ queryVector: Float32Array; memoryVectors: Map<string, Float32Array> } | undefined> {
  if (env.storeRoot === undefined) return undefined;
  try {
    const memoryVectors = readVectors(
      memoryEmbeddingsSidecarPath(env.storeRoot, entry.projectId as ProjectId),
    );
    if (memoryVectors.size === 0) return undefined;
    const [queryVector] = await (env.embedFn ?? embed)([memoryEmbedText(entry)]);
    if (queryVector === undefined) return undefined;
    return { queryVector, memoryVectors };
  } catch {
    return undefined;
  }
}

export async function handleSaveMemory(
  env: SaveMemoryEnv,
  rawArgs: unknown,
): Promise<SaveMemoryResult> {
  const parsed = saveMemoryInputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const d = parsed.data;

  // Code anchor capture (i6 §5): best-effort and TOTAL — any failure (no git,
  // missing project, extractor throw) yields undefined and the save proceeds
  // unanchored. Capture must never block or fail a save. save_memory has no
  // opt-out flag by design (§5.1: agents shouldn't decide).
  const project = env.registry.getProject(d.projectId as ProjectId);
  const anchor =
    project !== null && (d.relatedFiles !== undefined || d.relatedSymbols !== undefined)
      ? await captureCodeAnchor({
          rootPath: project.rootPath,
          ...(d.relatedFiles !== undefined ? { relatedFiles: d.relatedFiles } : {}),
          ...(d.relatedSymbols !== undefined ? { relatedSymbols: d.relatedSymbols } : {}),
          now: env.now(),
          ...(env.execGit !== undefined ? { execGit: env.execGit } : {}),
        })
      : undefined;

  let entry: MemoryEntry;
  try {
    entry = memoryEntrySchema.parse({
      id: env.newId(),
      projectId: d.projectId,
      sessionId: d.sessionId ?? null,
      scope: d.scope,
      type: d.type ?? "todo",
      title: d.title ?? d.content,
      content: d.content,
      keywords: stripReservedKeywords(d.keywords ?? []),
      confidence: d.confidence ?? "medium",
      // Boundary-forced: save_memory is an agent-only surface; the caller's
      // source claim is ignored so no agent can dodge the gate as "manual".
      source: "agent",
      approval: d.approval ?? "suggested",
      ...(d.reason !== undefined ? { reason: d.reason } : {}),
      ...(d.goal !== undefined ? { goal: d.goal } : {}),
      ...(d.relatedFiles !== undefined ? { relatedFiles: d.relatedFiles } : {}),
      ...(d.relatedSymbols !== undefined ? { relatedSymbols: d.relatedSymbols } : {}),
      ...(d.evidence !== undefined ? { evidence: d.evidence } : {}),
      ...(anchor !== undefined ? { anchor } : {}),
      ...(d.expiresAt !== undefined ? { expiresAt: d.expiresAt } : {}),
      ...(d.supersedesId !== undefined ? { supersedesId: d.supersedesId } : {}),
      createdAt: env.now(),
      updatedAt: env.now(),
    });
  } catch (err) {
    throw new McpBridgeError(
      "validation_failed",
      err instanceof Error ? err.message : "invalid memory entry",
    );
  }

  // Write gate (memory write-verify): the gate NEVER fails the save — failing
  // verdicts force suggested + confidence cap + TTL, then the row persists.
  // Skipped when the project is null (the registry throws exactly as today).
  let verdict: ReturnType<typeof verifyMemoryWrite> | undefined;
  if (project !== null) {
    const resolution = await resolveWritePointers({
      storeRoot: env.storeRoot,
      evidence: entry.evidence ?? [],
      projectRootPath: project.rootPath,
      projectId: entry.projectId,
      sessionId: entry.sessionId,
    });
    const normalizePath = (f: string) => f.replace(/\\/g, "/").replace(/^\.\//, "");
    // No anchor means the file-at-commit claim was never checked (capture is
    // best-effort), so every cited file counts as dropped: the write can never
    // verify on evidence alone.
    const droppedCitedFiles =
      entry.anchor === undefined
        ? (entry.relatedFiles ?? []).map(normalizePath)
        : (entry.relatedFiles ?? [])
            .map(normalizePath)
            .filter(
              (f) =>
                !entry.anchor?.files.some((a) => a.path === f) &&
                !entry.anchor?.symbols.some((a) => a.path === f),
            );
    const approvedActive = env.registry
      .listMemoryEntries(entry.projectId)
      .filter((m) => m.approval === "approved" && !m.stale && m.id !== entry.id);
    verdict = verifyMemoryWrite({
      candidate: entry,
      callerConfidence: entry.confidence,
      callerApproval: entry.approval,
      approvedActive,
      resolution,
      droppedCitedFiles,
    });
    entry = memoryEntrySchema.parse({
      ...entry,
      confidence: verdict.confidence,
      approval: verdict.approval,
      ...(entry.expiresAt !== undefined
        ? { expiresAt: entry.expiresAt }
        : { expiresAt: defaultWriteExpiresAt(entry.createdAt) }),
    });
  }

  const cosineInputs = await cosineInputsFor(env, entry);
  try {
    const result = saveMemoryWithLineage(env.registry, entry, {
      now: env.now,
      ...(cosineInputs ?? {}),
    });
    if (result.deduped === undefined && verdict !== undefined) {
      // Sidecar is best-effort: a validation write failure never fails the save.
      try {
        env.registry.setMemoryValidation({
          memoryEntryId: result.entry.id,
          validationStatus: verdict.validationStatus,
          reasons: [...verdict.reasons],
          conflictIds: [...verdict.conflictIds],
          validatedAt: env.now(),
          validatedBy: "system",
          policyVersion: env.policyVersion ?? "1",
        });
      } catch {
        // best-effort — see above
      }
    }
    return {
      id: result.entry.id,
      ...(result.supersession !== undefined ? { supersession: result.supersession } : {}),
      ...(result.deduped !== undefined ? { deduped: result.deduped } : {}),
    };
  } catch (err) {
    throw mapCoreError(err);
  }
}
