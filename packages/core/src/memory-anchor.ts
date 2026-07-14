import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { type ExtractedBlock, extractBlocksForFile } from "@megasaver/output-filter";
import { z } from "zod";

export const fileAnchorSchema = z
  .object({
    path: z.string().min(1), // repo-relative, POSIX separators
    blobSha: z.string().min(1), // git blob SHA at capture
  })
  .strict();
export type FileAnchor = z.infer<typeof fileAnchorSchema>;

export const symbolAnchorSchema = z
  .object({
    path: z.string().min(1),
    name: z.string().min(1),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    contentHash: z.string().min(1), // indexer hashText over the block span
  })
  .strict();
export type SymbolAnchor = z.infer<typeof symbolAnchorSchema>;

export const codeAnchorSchema = z
  .object({
    repoHead: z.string().min(1), // HEAD sha at capture
    capturedAt: z.string().datetime({ offset: true }),
    files: z.array(fileAnchorSchema),
    symbols: z.array(symbolAnchorSchema),
  })
  .strict();
export type CodeAnchor = z.infer<typeof codeAnchorSchema>;

export const verificationResultSchema = z.enum(["verified", "contradicted", "healed"]);
export type VerificationResult = z.infer<typeof verificationResultSchema>;

export const lastVerifiedSchema = z
  .object({
    headSha: z.string().min(1),
    at: z.string().datetime({ offset: true }),
    result: verificationResultSchema,
    // Close ownership (architect B1): true ONLY when the contradiction
    // mutation itself closed validTo (found the row open). Heal may reopen
    // validTo only when this is true — a close owned by the lineage channel
    // (supersession, manual close) is never stomped by a code-truth heal.
    closedByCodeTruth: z.boolean(),
  })
  .strict();
export type LastVerified = z.infer<typeof lastVerifiedSchema>;

type ExecGit = (args: string[], cwd: string) => string;

// timeout so a stuck git (index.lock, slow FS) can't stall a save; the
// best-effort catch below absorbs the throw (same shape as cli git-delta.ts).
const defaultExecGit: ExecGit = (args, cwd) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 3000,
    maxBuffer: 10 * 1024 * 1024,
  });

// Repo-relative POSIX form, or undefined when the input escapes rootPath or
// carries control characters. Nothing unsafe ever reaches a git argv or an
// anchor row (architect N3/N4); every path-taking git call below also uses
// the HEAD: prefix so a leading-dash path can never parse as a flag.
function normalizeRepoPath(rootPath: string, input: string): string | undefined {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control chars is the point (N4)
  if (/[\u0000-\u001f\u007f]/.test(input)) return undefined;
  const rel = relative(rootPath, resolve(rootPath, input));
  if (rel === "" || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) {
    return undefined;
  }
  return rel.split(sep).join("/");
}

// Capture what a memory claims about the code: blob SHAs at HEAD per related
// file, content hashes per related symbol read from the CURRENT worktree file
// (§6.4). Best-effort TOTAL (§5): ANY failure — not a git repo, git missing,
// extractor throw — returns undefined and the save proceeds unanchored.
// Capture must never block or fail a save. Runs BEFORE the sync
// registry.createMemoryEntry; the anchor rides in on the entry.
export async function captureCodeAnchor(opts: {
  rootPath: string;
  relatedFiles?: readonly string[];
  relatedSymbols?: readonly string[];
  now: string;
  execGit?: ExecGit;
}): Promise<CodeAnchor | undefined> {
  const exec = opts.execGit ?? defaultExecGit;
  try {
    const repoHead = exec(["rev-parse", "HEAD"], opts.rootPath).trim();
    if (repoHead === "") return undefined;

    const relFiles: string[] = [];
    for (const input of opts.relatedFiles ?? []) {
      const rel = normalizeRepoPath(opts.rootPath, input);
      if (rel !== undefined && !relFiles.includes(rel)) relFiles.push(rel);
    }

    const files: FileAnchor[] = [];
    for (const rel of relFiles) {
      try {
        const blobSha = exec(["rev-parse", `HEAD:${rel}`], opts.rootPath).trim();
        if (blobSha !== "") files.push({ path: rel, blobSha });
      } catch {
        // no blob at HEAD (untracked/new) — skipped, not an error (§5)
      }
    }

    // Symbols read the worktree, not HEAD — anchors describe what the agent
    // actually sees on disk (§6.4). Cache per file: one read + one extract.
    const blockCache = new Map<string, ExtractedBlock[] | undefined>();
    const blocksFor = async (rel: string): Promise<ExtractedBlock[] | undefined> => {
      if (!blockCache.has(rel)) {
        let blocks: ExtractedBlock[] | undefined;
        try {
          const source = await readFile(resolve(opts.rootPath, rel), "utf8");
          blocks = await extractBlocksForFile(rel, source);
        } catch {
          blocks = undefined; // unreadable / extractor throw — symbols skipped
        }
        blockCache.set(rel, blocks);
      }
      return blockCache.get(rel);
    };

    const symbols: SymbolAnchor[] = [];
    for (const symbol of opts.relatedSymbols ?? []) {
      const hashAt = symbol.indexOf("#");
      const name = hashAt === -1 ? symbol : symbol.slice(hashAt + 1);
      if (name === "") continue;
      let candidatePaths: readonly string[];
      if (hashAt === -1) {
        candidatePaths = relFiles;
      } else {
        const rel = normalizeRepoPath(opts.rootPath, symbol.slice(0, hashAt));
        candidatePaths = rel === undefined ? [] : [rel];
      }

      const matches: SymbolAnchor[] = [];
      for (const rel of candidatePaths) {
        for (const block of (await blocksFor(rel)) ?? []) {
          if (block.name === name) {
            matches.push({
              path: rel,
              name,
              startLine: block.startLine,
              endLine: block.endLine,
              contentHash: block.contentHash,
            });
          }
        }
      }
      // N2: ambiguity never anchors — multiple same-name blocks (within one
      // file, or across candidate files for a bare name) skip the symbol.
      const only = matches[0];
      if (matches.length === 1 && only !== undefined) symbols.push(only);
    }

    if (files.length === 0 && symbols.length === 0) return undefined;
    return codeAnchorSchema.parse({
      repoHead,
      capturedAt: opts.now,
      files,
      symbols,
    });
  } catch {
    return undefined; // best-effort total (§5): capture never blocks a save
  }
}
