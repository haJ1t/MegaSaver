import type { Dirent } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import {
  type MemoryEntry,
  type OverlayMemoryEntry,
  checkConflicts,
  readOverlayMemory,
} from "@megasaver/core";
import { listEvidenceByWorkspace } from "@megasaver/evidence-ledger";
import type {
  ChunkSetInput,
  ConflictPair,
  EvidenceInput,
  FileInput,
  GraphInput,
  MemoryInput,
  SessionInput,
  SymbolInput,
  WikiInput,
} from "@megasaver/memory-graph";
import { buildGraph, canonicalizeFilePath, parseWikiPage } from "@megasaver/memory-graph";
import { handleCaughtError } from "../error-mapping.js";
import type { RouteContext } from "../route-context.js";
import { resolveSessionWorkspace, sendSessionResolveError } from "./_claude-session.js";

// Map an OverlayMemoryEntry to the MemoryEntry shape required by checkConflicts.
// checkConflicts reads id/type/content/title and — load-bearing — keywords
// (negation set in contradiction) and relatedFiles (fileOverlap in supersession
// and contradiction); all are forwarded verbatim. The (projectId, sessionId) FK
// pair is NOT read by checkConflicts, so we supply placeholder values purely to
// satisfy the MemoryEntry type without affecting conflict logic.
function toConflictEntry(entry: OverlayMemoryEntry): MemoryEntry {
  return {
    id: entry.id,
    projectId: "overlay" as MemoryEntry["projectId"],
    sessionId: null,
    scope: entry.scope,
    type: entry.type,
    title: entry.title,
    content: entry.content,
    keywords: entry.keywords,
    confidence: entry.confidence,
    source: entry.source,
    approval: entry.approval,
    stale: entry.stale,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    ...(entry.reason !== undefined ? { reason: entry.reason } : {}),
    ...(entry.goal !== undefined ? { goal: entry.goal } : {}),
    ...(entry.evidence !== undefined ? { evidence: entry.evidence } : {}),
    ...(entry.relatedFiles !== undefined ? { relatedFiles: entry.relatedFiles } : {}),
    ...(entry.relatedSymbols !== undefined ? { relatedSymbols: entry.relatedSymbols } : {}),
    ...(entry.expiresAt !== undefined ? { expiresAt: entry.expiresAt } : {}),
  };
}

// Only these six folders are in-scope wiki folders; raw/ and archive/ are
// intentionally excluded — raw/ is immutable and archive/ is stale content.
const WIKI_FOLDERS = ["entities", "concepts", "decisions", "syntheses", "workflows", "sources"];

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

// Walk a wiki folder and return parsed WikiInput entries.
// Path confinement: top-level folders and in-walk entries are skipped when they are
// symlinks (Dirent.isSymbolicLink); a symlinked target could escape the wiki tree.
async function readWikiPages(cwd: string): Promise<WikiInput[]> {
  const wikiRoot = resolve(join(cwd, "wiki"));
  const results: WikiInput[] = [];

  async function walkDir(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      // ENOENT alone is a benign skip (folder vanished between lstat and readdir);
      // EACCES/EIO/EMFILE are real failures that must surface, not become an empty wiki.
      if (isNodeError(e) && e.code === "ENOENT") return;
      throw e;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      // Skip symlinks — a symlinked target could escape the wiki tree.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walkDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        let content: string;
        try {
          content = await readFile(fullPath, "utf8");
        } catch (e) {
          // The file vanished between readdir and read → skip; EACCES/EIO must surface.
          if (isNodeError(e) && e.code === "ENOENT") continue;
          throw e;
        }
        // Normalize to POSIX separators: the wiki node id must be /-separated on
        // every OS so it matches /-shaped [[link]] targets and (source:) citations.
        const relPath = relative(wikiRoot, fullPath).split(sep).join("/");
        results.push(parseWikiPage(relPath, content));
      }
    }
  }

  for (const folder of WIKI_FOLDERS) {
    const folderPath = join(wikiRoot, folder);
    // Skip top-level folder if it is a symlink — mirrors the in-walk isSymbolicLink() skip.
    let st: Awaited<ReturnType<typeof lstat>>;
    try {
      st = await lstat(folderPath);
    } catch (e) {
      // A wiki folder that does not exist is a legitimate skip; EACCES/EIO must surface.
      if (isNodeError(e) && e.code === "ENOENT") continue;
      throw e;
    }
    if (st.isSymbolicLink()) continue;
    await walkDir(folderPath);
  }

  return results;
}

async function loadGraphInput(
  storeRoot: string,
  workspaceKey: string,
  liveSessionId: string | null,
  cwd: string,
): Promise<GraphInput> {
  const overlayEntries = readOverlayMemory(storeRoot, workspaceKey);
  const evidenceRecords = await listEvidenceByWorkspace({ storeRoot, workspaceKey });

  const memories: MemoryInput[] = overlayEntries.map((entry) => ({
    id: entry.id,
    scope: entry.scope,
    sessionId: entry.liveSessionId,
    // Overlay memories have no registry project; the workspace is their structural
    // parent. Workspace-scoped entries point at the synthetic workspace node below
    // so buildGraph emits a project-memory edge instead of orphaning them.
    projectId: entry.scope === "project" ? workspaceKey : null,
    memoryType: entry.type,
    title: entry.title,
    approval: entry.approval,
    confidence: entry.confidence,
    source: entry.source,
    stale: entry.stale,
    evidenceIds: entry.evidence ?? [],
    // Mirror parse-wiki's fileCite canonicalization so a memory relatedFile and a
    // wiki source: citation for the same path collapse to ONE file node.
    relatedFiles: (entry.relatedFiles ?? []).map((f) => canonicalizeFilePath(f)),
    relatedSymbols: entry.relatedSymbols ?? [],
  }));

  const evidence: EvidenceInput[] = evidenceRecords.map((rec) => ({
    evidenceId: rec.evidenceId,
    sourceKind: rec.sourceKind,
    sessionId: rec.sessionRef?.id ?? null,
    chunkSetIds: [
      ...rec.returnedChunkRefs.map((r) => r.chunkSetId),
      ...(rec.redactedRawChunkSetId !== null ? [rec.redactedRawChunkSetId] : []),
    ],
    status: rec.status,
  }));

  // Collect unique chunkSetIds from evidence records.
  const chunkSetIdSet = new Set<string>();
  for (const ev of evidenceRecords) {
    for (const r of ev.returnedChunkRefs) chunkSetIdSet.add(r.chunkSetId);
    if (ev.redactedRawChunkSetId !== null) chunkSetIdSet.add(ev.redactedRawChunkSetId);
  }
  const chunkSets: ChunkSetInput[] = Array.from(chunkSetIdSet).map((csId) => ({
    chunkSetId: csId,
    label: csId.slice(0, 8),
    redacted: true,
  }));

  const sessionId = liveSessionId ?? "live";
  const sessions: SessionInput[] = [{ id: sessionId, projectId: null }];

  // Run conflict detection over approved, non-stale overlay entries only.
  const approvedActive = overlayEntries.filter((e) => e.approval === "approved" && !e.stale);
  const conflicts: ConflictPair[] = [];

  for (let i = 0; i < approvedActive.length; i++) {
    const candidate = approvedActive[i] as OverlayMemoryEntry;
    const prior = approvedActive.slice(0, i).map(toConflictEntry);
    if (prior.length === 0) continue;
    const result = checkConflicts(toConflictEntry(candidate), prior);
    if (result.outcome === "unrelated") continue;
    const kindMap: Record<"duplicate" | "supersession" | "contradiction", ConflictPair["kind"]> = {
      duplicate: "duplicate",
      supersession: "supersede",
      contradiction: "conflict",
    };
    for (const conflictId of result.conflictIds) {
      conflicts.push({
        from: candidate.id,
        to: conflictId,
        kind: kindMap[result.outcome as "duplicate" | "supersession" | "contradiction"],
      });
    }
  }

  const wikiPages = await readWikiPages(cwd);

  // Unique file paths from memory relatedFiles + wiki fileCites.
  const filePathSet = new Set<string>();
  for (const m of memories) for (const fp of m.relatedFiles) filePathSet.add(fp);
  for (const w of wikiPages) for (const fc of w.fileCites) filePathSet.add(fc);
  const files: FileInput[] = Array.from(filePathSet).map((path) => ({ path }));

  // Unique symbols from memory relatedSymbols.
  const symbolSet = new Set<string>();
  for (const m of memories) for (const sym of m.relatedSymbols) symbolSet.add(sym);
  const symbols: SymbolInput[] = Array.from(symbolSet).map((symbol) => ({ symbol }));

  return {
    projects: [{ id: workspaceKey, name: workspaceKey }],
    sessions,
    memories,
    evidence,
    chunkSets,
    conflicts,
    files,
    symbols,
    wikiPages,
  };
}

export async function handleGetMemoryGraph(
  ctx: RouteContext,
  dir: string,
  id: string,
): Promise<void> {
  const resolved = await resolveSessionWorkspace(ctx, dir, id);
  if (resolved === "unsafe" || resolved === "not_found") {
    sendSessionResolveError(ctx, resolved, dir, id);
    return;
  }
  try {
    const input = await loadGraphInput(
      ctx.storeRoot,
      resolved.workspaceKey,
      resolved.liveSessionId,
      resolved.cwd,
    );
    const graph = buildGraph(input);
    ctx.sendJson(ctx.res, 200, graph, ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}
