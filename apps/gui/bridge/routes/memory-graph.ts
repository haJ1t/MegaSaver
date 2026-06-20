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
import { buildGraph, parseWikiPage } from "@megasaver/memory-graph";
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

// Walk a wiki folder and return parsed WikiInput entries.
// Path confinement: top-level folders are lstat'd and skipped if they are symlinks;
// entries inside each walk are skipped via Dirent.isSymbolicLink(); the resolved-path
// startsWith check guards against any remaining ../ traversal.
async function readWikiPages(cwd: string): Promise<WikiInput[]> {
  const wikiRoot = resolve(join(cwd, "wiki"));
  const confinementPrefix = wikiRoot + sep;
  const results: WikiInput[] = [];

  async function walkDir(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
    if (entries === null) return;
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      // Skip symlinks — a symlinked target could escape the wiki tree.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walkDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        // Verify the resolved path stays within wiki root before reading.
        const realPath = resolve(fullPath);
        if (!realPath.startsWith(confinementPrefix)) continue;
        let content: string;
        try {
          content = await readFile(fullPath, "utf8");
        } catch {
          continue;
        }
        // Normalize to POSIX separators: the wiki node id must be /-separated on
        // every OS so it matches /-shaped [[link]] targets and (source:) citations.
        const relPath = relative(wikiRoot, realPath).split(sep).join("/");
        results.push(parseWikiPage(relPath, content));
      }
    }
  }

  for (const folder of WIKI_FOLDERS) {
    const folderPath = join(wikiRoot, folder);
    // Skip top-level folder if it is a symlink — mirrors the in-walk isSymbolicLink() skip.
    // lstat throws on ENOENT (folder absent) → treat as skip, same as readdir catching null.
    const st = await lstat(folderPath).catch(() => null);
    if (st === null || st.isSymbolicLink()) continue;
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
    projectId: null,
    memoryType: entry.type,
    title: entry.title,
    approval: entry.approval,
    confidence: entry.confidence,
    source: entry.source,
    stale: entry.stale,
    evidenceIds: entry.evidence ?? [],
    // Mirror parse-wiki's leading-"./" canonicalization so a memory relatedFile
    // and a wiki source: citation for the same path collapse to ONE file node.
    relatedFiles: (entry.relatedFiles ?? []).map((f) => (f.startsWith("./") ? f.slice(2) : f)),
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
    projects: [],
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
