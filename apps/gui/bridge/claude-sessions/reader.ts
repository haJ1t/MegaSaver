import { unwatchFile, watchFile } from "node:fs";
import { open, readFile, readdir, realpath, stat } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import { HARNESS_CATALOG } from "@megasaver/harness-detect";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { scanAllHarnessSessions } from "./multi-harness-scanner.js";
import { normalizeLine } from "./parse.js";
import type { ClaudeSessionMeta, ClaudeTranscript, NormalizedMessage } from "./types.js";

const META_SCAN_BYTES = 64 * 1024;
const HARNESS_MAP = new Map(HARNESS_CATALOG.map((h) => [h.id, h]));

function isSafeSegment(value: string): boolean {
  return (
    value.length > 0 &&
    !value.includes("/") &&
    true &&
    !value.includes(" ") &&
    value !== "." &&
    value !== ".."
  );
}

// Resolve <root>/<dir>/<id>.jsonl, rejecting any traversal. Returns null when
// `dir`/`id` are unsafe or escape the projects root. Security-critical: both
// segments arrive from the URL.
export async function safeSessionPath(
  root: string,
  dir: string,
  id: string,
): Promise<string | null> {
  if (!isSafeSegment(dir) || !isSafeSegment(id)) return null;
  const base = resolve(root);
  const candidate = resolve(base, dir, `${id}.jsonl`);
  if (candidate !== join(base, dir, `${id}.jsonl`)) return null;
  if (!candidate.startsWith(base + sep)) return null;
  try {
    const [realBase, realCandidate] = await Promise.all([realpath(base), realpath(candidate)]);
    if (!realCandidate.startsWith(realBase + sep)) return null;
  } catch {
    // base or candidate doesn't exist yet — lexical checks already passed.
  }
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

type SessionTitle = {
  title: string;
  cwd: string;
  lastActivityAt: number;
  isArchived: boolean;
  model: string;
  permissionMode: string;
};

async function readSessionTitles(metaDir: string): Promise<Map<string, SessionTitle>> {
  const titles = new Map<string, SessionTitle>();
  let entries: string[];
  try {
    entries = await readdir(metaDir, { recursive: true });
  } catch {
    return titles;
  }
  await Promise.all(
    entries.map(async (rel) => {
      const base = rel.split(sep).pop() ?? "";
      if (!base.startsWith("local_") || !base.endsWith(".json")) return;
      try {
        const obj = JSON.parse(await readFile(join(metaDir, rel), "utf8")) as {
          cliSessionId?: unknown;
          title?: unknown;
          cwd?: unknown;
          lastActivityAt?: unknown;
          isArchived?: unknown;
          model?: unknown;
          permissionMode?: unknown;
        };
        if (typeof obj.cliSessionId !== "string" || typeof obj.title !== "string") return;
        const lastActivityAt = typeof obj.lastActivityAt === "number" ? obj.lastActivityAt : 0;
        const existing = titles.get(obj.cliSessionId);
        if (existing && existing.lastActivityAt >= lastActivityAt) return;
        titles.set(obj.cliSessionId, {
          title: obj.title,
          cwd: typeof obj.cwd === "string" ? obj.cwd : "",
          lastActivityAt,
          isArchived: obj.isArchived === true,
          model: typeof obj.model === "string" ? obj.model : "",
          permissionMode: typeof obj.permissionMode === "string" ? obj.permissionMode : "",
        });
      } catch {
        // skip unreadable / partially-written metadata file
      }
    }),
  );
  return titles;
}

function firstCwd(chunk: string): string {
  for (const line of chunk.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const obj = JSON.parse(line) as { cwd?: unknown };
      if (typeof obj.cwd === "string") return obj.cwd;
    } catch {}
  }
  return "";
}

export async function listSessions(
  root: string,
  metaDir: string,
  opts: {
    limit: number;
    offset: number;
    storeRoot?: string;
    harness?: string;
    workspaceKey?: string;
    homeDir?: string;
  },
): Promise<ClaudeSessionMeta[]> {
  const allSessions: ClaudeSessionMeta[] = [];
  const seenIds = new Set<string>();

  try {
    const titles = await readSessionTitles(metaDir);
    if (titles.size > 0) {
      let dirs: string[] = [];
      try {
        dirs = await readdir(root);
      } catch {
        dirs = [];
      }
      const located = new Map<string, { dir: string; path: string }>();
      for (const dir of dirs) {
        let entries: string[] = [];
        try {
          entries = await readdir(join(root, dir));
        } catch {
          continue;
        }
        for (const entry of entries) {
          if (!entry.endsWith(".jsonl")) continue;
          const id = entry.slice(0, -".jsonl".length);
          if (!titles.has(id) || located.has(id)) continue;
          located.set(id, { dir, path: join(root, dir, entry) });
        }
      }

      const stated = await Promise.all(
        [...located].map(async ([id, f]) => {
          const meta = titles.get(id) as SessionTitle;
          if (meta.isArchived) return null;
          try {
            const s = await stat(f.path);
            if (s.size === 0) return null;
            const chunk = await readFile(f.path, "utf8");
            let hasUser = false;
            for (const line of chunk.split("\n")) {
              if (line.includes('"type":"user"') || line.includes('"role":"user"')) {
                hasUser = true;
                break;
              }
            }
            if (!hasUser) return null;
            return {
              dir: f.dir,
              id,
              mtimeMs: s.mtimeMs,
              size: s.size,
              title: meta.title,
              projectLabel: meta.cwd,
              isArchived: meta.isArchived,
              model: meta.model,
              permissionMode: meta.permissionMode,
              lastActivityAt: meta.lastActivityAt,
              harness: "claude-code",
              harnessName: "Claude Code",
            } satisfies ClaudeSessionMeta;
          } catch {
            return null;
          }
        }),
      );

      for (const s of stated) {
        if (s) {
          allSessions.push(s);
          seenIds.add(s.id);
        }
      }
    }
  } catch {}

  // Multi-Harness Scanner: Scans all 39 supported harnesses + Mesh Presence when storeRoot is present
  if (opts.storeRoot) {
    try {
      const otherSessions = await scanAllHarnessSessions({
        storeRoot: opts.storeRoot,
        harness: opts.harness,
        homeDir: opts.homeDir,
      });
      for (const s of otherSessions) {
        if (!seenIds.has(s.id)) {
          allSessions.push(s);
          seenIds.add(s.id);
        }
      }
    } catch {}
  }

  let filtered = opts.harness ? allSessions.filter((s) => s.harness === opts.harness) : allSessions;

  if (opts.workspaceKey) {
    filtered = filtered.filter((s) => {
      if (!s.projectLabel) return false;
      try {
        return encodeWorkspaceKey(s.projectLabel) === opts.workspaceKey;
      } catch {
        return false;
      }
    });
  }

  return filtered
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(opts.offset, opts.offset + opts.limit);
}

export async function readTranscript(
  root: string,
  dir: string,
  id: string,
): Promise<ClaudeTranscript | null> {
  const path = await safeSessionPath(root, dir, id);
  if (!path) return null;
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return null;
  }
  const messages = parseLines(text);
  const projectLabel = firstCwd(text.slice(0, META_SCAN_BYTES));
  return {
    dir,
    id,
    projectLabel,
    byteLength: Buffer.byteLength(text, "utf8"),
    messages,
  } satisfies ClaudeTranscript;
}

export function tailTranscript(
  path: string,
  startOffset: number,
  onMessage: (message: NormalizedMessage) => void,
): () => void {
  let offset = startOffset;
  let buffer = "";
  let reading = false;

  async function drain(): Promise<void> {
    if (reading) return;
    reading = true;
    try {
      const s = await stat(path);
      if (s.size <= offset) return;
      const handle = await open(path, "r");
      try {
        const len = s.size - offset;
        const buf = Buffer.alloc(len);
        await handle.read(buf, 0, len, offset);
        offset = s.size;
        buffer += buf.toString("utf8");
      } finally {
        await handle.close();
      }
      let nl = buffer.indexOf("\n");
      while (nl !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.trim().length > 0) {
          try {
            const msg = normalizeLine(JSON.parse(line));
            if (msg) onMessage(msg);
          } catch {}
        }
        nl = buffer.indexOf("\n");
      }
    } catch {
      // File vanished or unreadable
    } finally {
      reading = false;
    }
  }

  const listener = (): void => {
    void drain();
  };
  watchFile(path, { interval: 250 }, listener);
  void drain();

  return () => {
    unwatchFile(path, listener);
  };
}
