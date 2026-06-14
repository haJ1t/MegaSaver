import { open, readdir, readFile, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { normalizeLine } from "./parse.js";
import type { ClaudeSessionMeta, ClaudeTranscript, NormalizedMessage } from "./types.js";

const META_SCAN_BYTES = 64 * 1024;

function isSafeSegment(value: string): boolean {
  return (
    value.length > 0 &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    value !== "." &&
    value !== ".."
  );
}

// Resolve <root>/<dir>/<id>.jsonl, rejecting any traversal. Returns null when
// `dir`/`id` are unsafe or escape the projects root. Security-critical: both
// segments arrive from the URL.
export function safeSessionPath(root: string, dir: string, id: string): string | null {
  if (!isSafeSegment(dir) || !isSafeSegment(id)) return null;
  const base = resolve(root);
  const candidate = resolve(base, dir, `${id}.jsonl`);
  if (candidate !== join(base, dir, `${id}.jsonl`)) return null;
  if (!candidate.startsWith(base + sep)) return null;
  return candidate;
}

function parseLines(text: string): NormalizedMessage[] {
  const messages: NormalizedMessage[] = [];
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = normalizeLine(raw);
    if (msg) messages.push(msg);
  }
  return messages;
}

function deriveMeta(chunk: string): { title: string; projectLabel: string } {
  let title = "";
  let projectLabel = "";
  for (const line of chunk.split("\n")) {
    if (line.trim().length === 0) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    if (raw && typeof raw === "object") {
      const obj = raw as Record<string, unknown>;
      if (!projectLabel && typeof obj.cwd === "string") projectLabel = obj.cwd;
      if (!title) {
        const msg = normalizeLine(raw);
        if (msg?.role === "user") {
          title = msg.blocks.map((b) => b.text).join(" ").slice(0, 120);
        }
      }
    }
    if (title && projectLabel) break;
  }
  return { title, projectLabel };
}

async function readHead(path: string, bytes: number): Promise<string> {
  const handle = await open(path, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

export async function listSessions(
  root: string,
  opts: { limit: number; offset: number },
): Promise<ClaudeSessionMeta[]> {
  let dirs: string[];
  try {
    dirs = await readdir(root);
  } catch {
    return [];
  }
  const files: { dir: string; id: string; path: string }[] = [];
  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = await readdir(join(root, dir));
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".jsonl")) continue;
      files.push({ dir, id: entry.slice(0, -".jsonl".length), path: join(root, dir, entry) });
    }
  }
  const stated = await Promise.all(
    files.map(async (f) => {
      try {
        const s = await stat(f.path);
        return { ...f, mtimeMs: s.mtimeMs, size: s.size };
      } catch {
        return null;
      }
    }),
  );
  const sorted = stated
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(opts.offset, opts.offset + opts.limit);

  return Promise.all(
    sorted.map(async (s) => {
      const head = await readHead(s.path, META_SCAN_BYTES).catch(() => "");
      const { title, projectLabel } = deriveMeta(head);
      return {
        dir: s.dir,
        id: s.id,
        mtimeMs: s.mtimeMs,
        size: s.size,
        title,
        projectLabel,
      } satisfies ClaudeSessionMeta;
    }),
  );
}

export async function readTranscript(
  root: string,
  dir: string,
  id: string,
): Promise<ClaudeTranscript | null> {
  const path = safeSessionPath(root, dir, id);
  if (!path) return null;
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return null;
  }
  const messages = parseLines(text);
  const projectLabel = deriveMeta(text.slice(0, META_SCAN_BYTES)).projectLabel;
  return {
    dir,
    id,
    projectLabel,
    byteLength: Buffer.byteLength(text, "utf8"),
    messages,
  } satisfies ClaudeTranscript;
}
