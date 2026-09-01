import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ClaudeTranscript, NormalizedMessage } from "./types.js";

const TOOL_INPUT_MAX = 2000;

function asObj(v: unknown): Record<string, unknown> | null {
  if (typeof v !== "object" || v === null) return null;
  return v as Record<string, unknown>;
}
function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function normalizePiLine(raw: unknown): NormalizedMessage | null {
  const rec = asObj(raw);
  if (!rec) return null;
  if (rec["type"] !== "message") return null;
  const msg = asObj(rec["message"]);
  if (!msg) return null;
  const role = msg["role"];
  if (role !== "user" && role !== "assistant" && role !== "toolResult") return null;
  const ts = str(rec["timestamp"]) ?? str(msg["timestamp"]) ?? "";
  if (role === "toolResult") {
    const content = msg["content"];
    let text = "";
    if (Array.isArray(content)) {
      for (const c of content) {
        const b = asObj(c);
        if (b && typeof b["text"] === "string") text += `${b["text"] as string}\n`;
      }
    } else if (typeof content === "string") text = content;
    text = text.trim().slice(0, TOOL_INPUT_MAX);
    if (text.length === 0) return null;
    return {
      role: "assistant",
      ts,
      blocks: [{ kind: "tool_result", text }],
    } satisfies NormalizedMessage;
  }
  const content = msg["content"];
  const blocks: NormalizedMessage["blocks"] = [];
  if (Array.isArray(content)) {
    for (const c of content) {
      const b = asObj(c);
      if (!b) continue;
      if (
        b["type"] === "thinking" &&
        typeof b["thinking"] === "string" &&
        (b["thinking"] as string).trim().length > 0
      )
        blocks.push({ kind: "thinking", text: b["thinking"] as string });
      else if (b["type"] === "toolCall") {
        const name = str(b["name"]) ?? "tool";
        const args = b["arguments"];
        const argsStr = typeof args === "string" ? args : JSON.stringify(args ?? {});
        blocks.push({
          kind: "tool_use",
          text: `${name}(${argsStr.slice(0, TOOL_INPUT_MAX)})`,
        });
      } else if (typeof b["text"] === "string" && (b["text"] as string).trim().length > 0)
        blocks.push({ kind: "text", text: b["text"] as string });
    }
  } else if (typeof content === "string" && content.trim().length > 0)
    blocks.push({ kind: "text", text: content });
  if (blocks.length === 0) return null;
  const model = str(msg["model"]);
  const usageObj = asObj(msg["usage"]);
  let meta = undefined;
  if (model || usageObj) {
    meta = {
      ...(model ? { model } : {}),
      ...(usageObj
        ? {
            usage: {
              inputTokens:
                typeof usageObj["input"] === "number" ? (usageObj["input"] as number) : 0,
              outputTokens:
                typeof usageObj["output"] === "number" ? (usageObj["output"] as number) : 0,
              cacheReadInputTokens:
                typeof usageObj["cacheRead"] === "number" ? (usageObj["cacheRead"] as number) : 0,
              cacheCreationInputTokens:
                typeof usageObj["cacheWrite"] === "number" ? (usageObj["cacheWrite"] as number) : 0,
            },
          }
        : {}),
    };
  }
  return {
    role: role as "user" | "assistant",
    ts,
    blocks,
    ...(meta ? { meta } : {}),
  } satisfies NormalizedMessage;
}

export async function resolvePiTranscriptPath(
  homeDir: string,
  id: string,
): Promise<{ path: string; offset: number } | null> {
  const base = join(homeDir, ".pi", "agent", "sessions");
  if (!existsSync(base)) return null;
  let dirs: string[] = [];
  try {
    dirs = await readdir(base);
  } catch {
    return null;
  }
  for (const d of dirs) {
    const fp = join(base, d);
    try {
      const st = await stat(fp);
      if (!st.isDirectory()) continue;
      const files = await readdir(fp);
      for (const f of files) {
        if (!f.endsWith(".jsonl") || !f.includes(id)) continue;
        const full = join(fp, f);
        try {
          const txt = await readFile(full, "utf8");
          if (!txt.includes(id)) continue;
          const nl = txt.indexOf("\n");
          const first = txt.slice(0, nl === -1 ? undefined : nl);
          try {
            const o = JSON.parse(first) as Record<string, unknown>;
            if (o["id"] !== id && !txt.includes(`"id":"${id}"`)) continue;
          } catch {}
          try {
            const s = await stat(full);
            return { path: full, offset: s.size };
          } catch {
            return { path: full, offset: Buffer.byteLength(txt) };
          }
        } catch {}
      }
    } catch {}
  }
  return null;
}

export async function readPiTranscript(
  homeDir: string,
  id: string,
): Promise<ClaudeTranscript | null> {
  const resolved = await resolvePiTranscriptPath(homeDir, id);
  if (!resolved) return null;
  let txt: string;
  try {
    txt = await readFile(resolved.path, "utf8");
  } catch {
    return null;
  }
  let cwd = "";
  try {
    const first = txt.slice(0, txt.indexOf("\n"));
    const o = JSON.parse(first) as Record<string, unknown>;
    if (typeof o["cwd"] === "string") cwd = o["cwd"] as string;
  } catch {}
  if (!cwd) {
    try {
      const first = txt.slice(0, txt.indexOf("\n"));
      const o = JSON.parse(first) as Record<string, unknown>;
      if (typeof o["cwd"] === "string") cwd = o["cwd"] as string;
    } catch {}
  }
  const messages: NormalizedMessage[] = [];
  for (const line of txt.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const raw = JSON.parse(line);
      const m = normalizePiLine(raw);
      if (m) messages.push(m);
    } catch {}
  }
  if (messages.length === 0) return null;
  const dir = cwd.length > 0 ? basename(cwd) : "pi";
  return {
    dir,
    id,
    projectLabel: cwd || "Pi Agent",
    byteLength: Buffer.byteLength(txt, "utf8"),
    messages,
  } satisfies ClaudeTranscript;
}
export { normalizePiLine };
