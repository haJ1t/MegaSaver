import { randomBytes } from "node:crypto";
import type { Chunk, OverlayChunkSet } from "@megasaver/content-store";
import { chunkByLines } from "@megasaver/output-filter";
import { redact } from "@megasaver/policy";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { type ClaimsManifest, buildClaimsManifest } from "./claims.js";
import { type ContextExtent, enclosingExtents } from "./context-extents.js";
import { renderDigest } from "./digest.js";
import { ReviewPackError } from "./errors.js";
import {
  type ChangedFile,
  type ExecGit,
  type RangeInfo,
  assertCleanTree,
  changedLineRanges,
  defaultExecGit,
  fileAtHead,
  listChangedFiles,
  listCommits,
  repoTopLevel,
  resolveRange,
  unifiedDiff,
} from "./git.js";
import { persistPack } from "./persist.js";
import { readReceiptEvents, receiptCandidatesFromEvents } from "./receipts.js";

export type BuildReviewPackInput = {
  repoRoot: string;
  storeRoot: string;
  range?: string | undefined;
  resolveProjectId?: (repoTopLevel: string) => string | undefined;
  execGit?: ExecGit;
  now?: () => string;
  newId?: () => string;
};

export type ReviewPack = {
  packId: string;
  workspaceKey: string;
  range: RangeInfo;
  claims: ClaimsManifest;
  files: Array<{
    path: string;
    status: ChangedFile["status"];
    diffChunkIds: string[];
    contextChunkIds: string[];
  }>;
  chunkSets: { diff: string; context: string; manifest: string };
  digest: string;
};

function splitDiffSegments(rawDiff: string): string[] {
  if (!rawDiff.trim()) return [];
  const parts = rawDiff.split(/(?=^diff --git )/m);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

export async function buildReviewPack(
  input: BuildReviewPackInput,
): Promise<ReviewPack> {
  const execGit = input.execGit ?? defaultExecGit;
  const now = input.now ? input.now() : new Date().toISOString();
  const rawId = input.newId ? input.newId() : randomBytes(6).toString("hex");
  const packId = rawId.startsWith("rp-") ? rawId : `rp-${rawId}`;

  const topLevel = repoTopLevel(input.repoRoot, execGit);
  if (!topLevel) {
    throw new ReviewPackError(
      "git_unavailable",
      "directory is not a git repository or git is unavailable",
    );
  }

  assertCleanTree(topLevel, execGit);

  const rangeInfo = resolveRange(topLevel, input.range, execGit);
  const changedFiles = listChangedFiles(topLevel, rangeInfo, execGit);
  if (changedFiles.length === 0) {
    throw new ReviewPackError(
      "empty_diff",
      `no changes detected in range "${rangeInfo.label}"`,
    );
  }

  const commits = listCommits(topLevel, rangeInfo, execGit);
  const rawDiff = unifiedDiff(topLevel, rangeInfo, execGit);

  // 1. Build diff chunk set
  const diffSegments = splitDiffSegments(rawDiff);
  const diffChunks: Chunk[] = [];
  const fileDiffChunkMap = new Map<string, string[]>();

  for (const segment of diffSegments) {
    const headerMatch = /^diff --git a\/(.+?) b\/(.+?)$/m.exec(segment);
    const filePath = headerMatch?.[2] ?? headerMatch?.[1] ?? "";
    const lines = segment.split("\n");
    const subSegments: string[] =
      lines.length > 400
        ? chunkByLines(segment, 80).map((c) => c.text)
        : [segment];

    const assignedIds: string[] = [];
    for (const sub of subSegments) {
      const chunkId = String(diffChunks.length);
      const redactedSub = redact(sub).redacted;
      diffChunks.push({
        id: chunkId,
        startLine: 1,
        endLine: redactedSub.split("\n").length,
        bytes: Buffer.byteLength(redactedSub, "utf8"),
        text: redactedSub,
      });
      assignedIds.push(chunkId);
    }
    if (filePath) {
      fileDiffChunkMap.set(filePath, assignedIds);
    }
  }

  // 2. Build context extents chunk set
  const contextChunks: Chunk[] = [];
  const fileContextChunkMap = new Map<string, string[]>();

  for (const file of changedFiles) {
    if (file.status === "D") continue;
    const headText = fileAtHead(topLevel, rangeInfo.headSha, file.path, execGit);
    if (!headText) continue;

    const ranges = changedLineRanges(topLevel, rangeInfo, file.path, execGit);
    const extents = await enclosingExtents({
      path: file.path,
      headText,
      ranges,
    });

    const assignedIds: string[] = [];
    for (const ext of extents) {
      const chunkId = String(contextChunks.length);
      const header = `// [${ext.path}:${ext.startLine}-${ext.endLine}${ext.name ? ` (${ext.name})` : ""}]\n`;
      const fullChunkText = header + ext.text;
      const redactedText = redact(fullChunkText).redacted;
      contextChunks.push({
        id: chunkId,
        startLine: ext.startLine,
        endLine: ext.endLine,
        bytes: Buffer.byteLength(redactedText, "utf8"),
        text: redactedText,
      });
      assignedIds.push(chunkId);
    }
    fileContextChunkMap.set(file.path, assignedIds);
  }

  // 3. Receipts & Claims manifest
  const workspaceKey = encodeWorkspaceKey(topLevel);
  const projectId = input.resolveProjectId?.(topLevel);
  const receiptEvents = readReceiptEvents(
    { root: input.storeRoot },
    { workspaceKey, ...(projectId !== undefined ? { projectId } : {}) },
  );
  const candidates = receiptCandidatesFromEvents(receiptEvents, { now });
  const claimsManifest = buildClaimsManifest({
    commits,
    changedPaths: changedFiles.map((f) => f.path),
    receipts: candidates,
  });

  const manifestJson = redact(
    JSON.stringify(claimsManifest, null, 2),
  ).redacted;
  const manifestChunks: Chunk[] = [
    {
      id: "0",
      startLine: 1,
      endLine: manifestJson.split("\n").length,
      bytes: Buffer.byteLength(manifestJson, "utf8"),
      text: manifestJson,
    },
  ];

  // 4. Assemble Chunk Sets
  const liveSessionId = `review-${packId}`;
  const source = {
    kind: "command" as const,
    command: "mega",
    args: ["review", "pack", rangeInfo.label],
  };

  const diffSetId = `${packId}-diff`;
  const contextSetId = `${packId}-context`;
  const manifestSetId = `${packId}-manifest`;

  const diffSet: OverlayChunkSet = {
    chunkSetId: diffSetId,
    liveSessionId,
    workspaceKey,
    createdAt: now,
    source,
    rawBytes: diffChunks.reduce((acc, c) => acc + c.bytes, 0),
    redacted: true,
    chunks: diffChunks,
  };

  const contextSet: OverlayChunkSet = {
    chunkSetId: contextSetId,
    liveSessionId,
    workspaceKey,
    createdAt: now,
    source,
    rawBytes: contextChunks.reduce((acc, c) => acc + c.bytes, 0),
    redacted: true,
    chunks: contextChunks,
  };

  const manifestSet: OverlayChunkSet = {
    chunkSetId: manifestSetId,
    liveSessionId,
    workspaceKey,
    createdAt: now,
    source,
    rawBytes: manifestChunks.reduce((acc, c) => acc + c.bytes, 0),
    redacted: true,
    chunks: manifestChunks,
  };

  // 5. Persist
  await persistPack({
    storeRoot: input.storeRoot,
    workspaceKey,
    liveSessionId,
    createdAt: now,
    rangeLabel: rangeInfo.label,
    sets: {
      diff: diffSet,
      context: contextSet,
      manifest: manifestSet,
    },
  });

  // 6. Build final pack representation
  const files = changedFiles.map((f) => ({
    path: f.path,
    status: f.status,
    diffChunkIds: fileDiffChunkMap.get(f.path) ?? [],
    contextChunkIds: fileContextChunkMap.get(f.path) ?? [],
  }));

  const partialPack: Omit<ReviewPack, "digest"> = {
    packId,
    workspaceKey,
    range: rangeInfo,
    claims: claimsManifest,
    files,
    chunkSets: {
      diff: diffSetId,
      context: contextSetId,
      manifest: manifestSetId,
    },
  };

  const digest = renderDigest(partialPack as ReviewPack);
  return {
    ...partialPack,
    digest,
  };
}
