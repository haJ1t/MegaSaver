import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

const schema = z.object({ paths: z.array(z.string().min(1)) });

function storeFile(storeRoot: string): string {
  return resolve(storeRoot, "user-projects.json");
}

async function normalizePath(rawPath: string): Promise<string> {
  const trimmed = rawPath.trim();
  if (trimmed.length === 0) throw new Error("path required");
  const resolved = resolve(trimmed);
  let candidate: string;
  try {
    candidate = await realpath(resolved);
  } catch {
    candidate = resolved;
  }
  let s: Awaited<ReturnType<typeof stat>>;
  try {
    s = await stat(candidate);
  } catch {
    throw new Error(`Path does not exist: ${candidate}`);
  }
  if (!s.isDirectory()) throw new Error(`Not a directory: ${candidate}`);
  return candidate;
}

export async function readUserProjects(storeRoot: string): Promise<string[]> {
  try {
    const txt = await readFile(storeFile(storeRoot), "utf8");
    const parsed = schema.safeParse(JSON.parse(txt));
    if (!parsed.success) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of parsed.data.paths) {
      const n = resolve(p);
      if (!seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    }
    return out;
  } catch {
    return [];
  }
}

export async function writeUserProjects(storeRoot: string, paths: string[]): Promise<void> {
  const file = storeFile(storeRoot);
  await mkdir(resolve(storeRoot), { recursive: true });
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    const n = resolve(p);
    if (!seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  const tmp = `${file}.tmp.${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await writeFile(tmp, JSON.stringify({ paths: out }, null, 2), "utf8");
  await rename(tmp, file);
}

export async function addUserProject(storeRoot: string, rawPath: string): Promise<string[]> {
  const norm = await normalizePath(rawPath);
  const cur = await readUserProjects(storeRoot);
  if (cur.includes(norm)) return cur;
  const next = [...cur, norm];
  await writeUserProjects(storeRoot, next);
  return next;
}

export async function removeUserProject(storeRoot: string, rawPath: string): Promise<string[]> {
  const trimmed = rawPath.trim();
  if (trimmed.length === 0) throw new Error("path required");
  const norm = resolve(trimmed);
  let realNorm: string;
  try {
    realNorm = await realpath(norm);
  } catch {
    realNorm = norm;
  }
  const cur = await readUserProjects(storeRoot);
  const next = cur.filter((p) => {
    const rp = resolve(p);
    return rp !== norm && rp !== realNorm;
  });
  await writeUserProjects(storeRoot, next);
  return next;
}
