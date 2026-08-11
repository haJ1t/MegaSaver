import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { redact } from "@megasaver/policy";
import { z } from "zod";
import { SAFE_REL_PATH } from "./rank.js";

export type QuarantineEntry = {
  from: string;
  to: string;
  size: number;
  mtimeMs: number;
  hash: string;
  move: "rename" | "copy";
};

export type QuarantineManifest = {
  version: 1;
  id: string;
  createdAt: string;
  snapshotId: string | null;
  entries: QuarantineEntry[];
  undoSh: string;
};

const manifestSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1),
    createdAt: z.string().datetime({ offset: true }),
    snapshotId: z.string().nullable(),
    entries: z.array(
      z.object({
        from: z.string(),
        to: z.string(),
        size: z.number().int().nonnegative(),
        mtimeMs: z.number(),
        hash: z.string().regex(/^[a-f0-9]{64}$/),
        move: z.enum(["rename", "copy"]),
      }),
    ),
    undoSh: z.string(),
  })
  .strict();

function hashFile(path: string): string {
  try {
    const data = readFileSync(path);
    return createHash("sha256").update(data).digest("hex");
  } catch {
    return "0".repeat(64);
  }
}

function validateRelPath(relPath: string): void {
  if (!SAFE_REL_PATH.test(relPath)) throw new Error(`unsafe path "${relPath}"`);
  if (relPath.includes("..")) throw new Error(`unsafe path "${relPath}"`);
  if (relPath.startsWith("/")) throw new Error(`unsafe path "${relPath}"`);
  // Resolve and ensure it stays within repo (no traversal via a/b/../c)
  // We check normalized form: join + normalize should equal original
  const normalized = relPath
    .split("/")
    .reduce((acc: string[], part) => {
      if (part === "..") acc.pop();
      else if (part !== "." && part !== "") acc.push(part);
      return acc;
    }, [])
    .join("/");
  if (normalized !== relPath) throw new Error(`unsafe path "${relPath}"`);
}

export function buildQuarantineId(now: () => number): string {
  return `${now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function quarantineFiles(input: {
  repoRoot: string;
  entries: { relPath: string; size?: number; mtimeMs?: number }[];
  snapshotId: string | null;
  now: () => number;
}): QuarantineManifest {
  const id = buildQuarantineId(input.now);
  const createdAt = new Date(input.now()).toISOString();
  const quarantineDir = join(input.repoRoot, ".megasaver", "quarantine", id);
  mkdirSync(quarantineDir, { recursive: true, mode: 0o700 });

  const entries: QuarantineEntry[] = [];
  const undoLines: string[] = [
    "#!/bin/sh",
    "set -e",
    `# undo quarantine ${id}`,
    `# created ${createdAt}`,
  ];

  for (const e of input.entries) {
    validateRelPath(e.relPath);
    const fromAbs = join(input.repoRoot, e.relPath);
    const toRel = e.relPath;
    const toAbs = join(quarantineDir, toRel);
    if (!existsSync(fromAbs)) continue;
    const stat = statSync(fromAbs);
    const hash = hashFile(fromAbs);
    mkdirSync(dirname(toAbs), { recursive: true });
    let move: "rename" | "copy" = "rename";
    try {
      renameSync(fromAbs, toAbs);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EXDEV") {
        copyFileSync(fromAbs, toAbs);
        try {
          unlinkSync(fromAbs);
        } catch {
          try {
            rmSync(toAbs, { force: true });
          } catch {}
          throw err;
        }
        move = "copy";
      } else {
        throw err;
      }
    }
    entries.push({
      from: e.relPath,
      to: join(id, toRel),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      hash,
      move,
    });
    const esc = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
    undoLines.push(`mkdir -p $(dirname ${esc(e.relPath)})`);
    undoLines.push(`mv ${esc(join(".megasaver/quarantine", id, toRel))} ${esc(e.relPath)}`);
  }

  undoLines.push(`rmdir ${`'${join(".megasaver/quarantine", id)}'`} 2>/dev/null || true`);
  const undoSh = `${undoLines.join("\n")}\n`;
  const manifest: QuarantineManifest = {
    version: 1,
    id,
    createdAt,
    snapshotId: input.snapshotId,
    entries,
    undoSh,
  };
  const manifestPath = join(quarantineDir, "manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  const undoPath = join(quarantineDir, "undo.sh");
  writeFileSync(undoPath, undoSh, { mode: 0o755 });

  // update index
  try {
    const indexPath = join(input.repoRoot, ".megasaver", "quarantine-index.json");
    let index: string[] = [];
    try {
      index = JSON.parse(readFileSync(indexPath, "utf8"));
    } catch {}
    if (!Array.isArray(index)) index = [];
    index.unshift(id);
    writeFileSync(indexPath, `${JSON.stringify(index.slice(0, 50), null, 2)}\n`);
  } catch {}

  return manifest;
}

export function readQuarantineManifest(repoRoot: string, id: string): QuarantineManifest | null {
  if (!/^\d+-[a-z0-9]{6}$/.test(id)) return null;
  const quarantineRoot = join(repoRoot, ".megasaver", "quarantine");
  const p = join(quarantineRoot, id, "manifest.json");
  // Containment check: resolved path must stay within quarantineRoot
  const resolved = join(quarantineRoot, id);
  // Use string prefix check (realpath not needed as id is strict)
  if (!resolved.startsWith(`${quarantineRoot}/`) && resolved !== quarantineRoot) return null;
  try {
    const raw = readFileSync(p, "utf8");
    const parsed = manifestSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function restoreQuarantine(input: {
  repoRoot: string;
  manifest: QuarantineManifest;
}): { moved: number; skipped: { path: string; reason: string }[] } {
  const parsed = manifestSchema.safeParse(input.manifest);
  if (!parsed.success) throw new Error("invalid manifest");
  const m = parsed.data;
  let moved = 0;
  const skipped: { path: string; reason: string }[] = [];
  for (const e of m.entries) {
    validateRelPath(e.from);
    const fromAbs = join(input.repoRoot, ".megasaver", "quarantine", e.to);
    const toAbs = join(input.repoRoot, e.from);
    if (!existsSync(fromAbs)) {
      skipped.push({ path: e.from, reason: "quarantine file missing" });
      continue;
    }
    if (existsSync(toAbs)) {
      skipped.push({ path: e.from, reason: "target exists" });
      continue;
    }
    mkdirSync(dirname(toAbs), { recursive: true });
    try {
      renameSync(fromAbs, toAbs);
      moved += 1;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EXDEV") {
        copyFileSync(fromAbs, toAbs);
        unlinkSync(fromAbs);
        moved += 1;
      } else {
        skipped.push({ path: e.from, reason: String(err) });
      }
    }
  }
  // remove quarantine dir if empty
  try {
    const dir = join(input.repoRoot, ".megasaver", "quarantine", m.id);
    rmSync(dir, { recursive: true, force: true });
  } catch {}
  return { moved, skipped };
}
