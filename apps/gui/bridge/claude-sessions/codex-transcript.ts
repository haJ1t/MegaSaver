import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { isCodexNoiseText } from "./multi-harness-scanner.js";
import type { ClaudeTranscript, NormalizedMessage } from "./types.js";

const TOOL_INPUT_MAX = 2000;
const HEADER_BYTES = 8192;
void HEADER_BYTES;

function asObj(v: unknown): Record<string, unknown> | null {
  if (typeof v !== "object" || v === null) return null;
  return v as Record<string, unknown>;
}
function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function normalizeCodexLine(raw: unknown): NormalizedMessage | null {
  const rec = asObj(raw);
  if (!rec) return null;
  const type = rec["type"];
  if (type !== "response_item") return null;
  const payload = asObj(rec["payload"] ?? rec);
  if (!payload) return null;
  const pType = payload["type"];
  const ts = str(rec["timestamp"]) ?? str(payload["timestamp"]) ?? "";
  const topOrdinal = typeof rec["ordinal"] === "number" ? String(rec["ordinal"]) : "";
  if (pType === "message") {
    const role = payload["role"];
    if (role !== "user" && role !== "assistant") return null;
    const content = payload["content"];
    const blocks: NormalizedMessage["blocks"] = [];
    if (Array.isArray(content)) {
      for (const c of content) {
        const b = asObj(c);
        if (!b) continue;
        if (
          typeof b["text"] === "string" &&
          (b["type"] === "input_text" || b["type"] === "output_text" || b["type"] === "text")
        ) {
          const t = (b["text"] as string).trim();
          if (t.length === 0) continue;
          if (role === "user" && isCodexNoiseText(t)) continue;
          blocks.push({ kind: "text", text: b["text"] as string });
        } else if (typeof b["text"] === "string" && b["type"] === "input_text") {
          const t = (b["text"] as string).trim();
          if (t.length === 0 || (role === "user" && isCodexNoiseText(t))) continue;
          blocks.push({ kind: "text", text: b["text"] as string });
        }
      }
    } else if (typeof content === "string" && content.trim().length > 0) {
      if (role === "user" && isCodexNoiseText(content)) return null;
      blocks.push({ kind: "text", text: content });
    } else if (
      typeof payload["text"] === "string" &&
      (payload["text"] as string).trim().length > 0
    ) {
      const t = payload["text"] as string;
      if (role === "user" && isCodexNoiseText(t)) return null;
      blocks.push({ kind: "text", text: t });
    }
    if (blocks.length === 0) return null;
    return {
      role: role as "user" | "assistant",
      ts: ts || topOrdinal,
      blocks,
    } satisfies NormalizedMessage;
  }
  if (pType === "function_call" || pType === "custom_tool_call") {
    const name = str(payload["name"]) ?? "tool";
    const args = payload["arguments"];
    const argsStr = typeof args === "string" ? args : JSON.stringify(args ?? {});
    return {
      role: "assistant",
      ts: ts || topOrdinal,
      blocks: [{ kind: "tool_use", text: `${name}(${argsStr.slice(0, TOOL_INPUT_MAX)})` }],
    } satisfies NormalizedMessage;
  }
  if (pType === "function_call_output" || pType === "custom_tool_call_output") {
    const out = payload["output"];
    let text = "";
    if (typeof out === "string") text = out;
    else if (Array.isArray(out)) {
      for (const item of out) {
        const o = asObj(item);
        if (o && typeof o["text"] === "string") text += o["text"] as string;
        else if (typeof item === "string") text += item;
      }
    } else if (out) text = JSON.stringify(out);
    text = text.slice(0, TOOL_INPUT_MAX);
    if (text.trim().length === 0) return null;
    return {
      role: "assistant",
      ts: ts || topOrdinal,
      blocks: [{ kind: "tool_result", text }],
    } satisfies NormalizedMessage;
  }
  return null;
}
function firstJsonlLine(txt: string): string {
  const nl = txt.indexOf("\n");
  return nl === -1 ? txt : txt.slice(0, nl);
}

async function codexCwdFromFile(head: string): Promise<string> {
  for (const line of head.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t) as Record<string, unknown>;
      if (o["type"] === "session_meta") {
        const p = asObj(o["payload"]);
        const cwd = p ? str(p["cwd"]) : null;
        if (cwd) return cwd;
        const cwd2 = str(o["cwd"]);
        if (cwd2) return cwd2;
      }
    } catch {}
  }
  return "";
}
export async function resolveCodexTranscriptPath(
  homeDir: string,
  id: string,
): Promise<{ path: string; offset: number } | null> {
  const base = join(homeDir, ".codex", "sessions");
  if (!existsSync(base)) return null;
  const candidates: string[] = [];
  async function collect(dir: string, depth: number): Promise<void> {
    if (depth > 4 || !existsSync(dir)) return;
    let entries: string[] = [];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e);
      try {
        const st = await stat(full);
        if (st.isDirectory()) await collect(full, depth + 1);
        else if (e.endsWith(".jsonl") && (e.includes(id) || e.startsWith("rollout-"))) {
          if (e.includes(id)) candidates.push(full);
          else if (candidates.length < 80) candidates.push(full);
        }
      } catch {}
    }
  }
  await collect(base, 0);
  const exact = candidates.filter((p) => basename(p).includes(id));
  const toProbe = exact.length > 0 ? exact : candidates.slice(0, 40);
  for (const p of toProbe) {
    let txt: string;
    try {
      txt = await readFile(p, "utf8");
    } catch {
      continue;
    }
    if (!txt.includes(id)) continue;
    let ok = false;
    {
      const headCheck = txt.length > 64 * 1024 ? txt.slice(0, 64 * 1024) : txt;
      for (const line of headCheck.split("\n")) {
        const t = line.trim();
        if (!t) continue;
        if (!t.includes(id)) continue;
        try {
          const o = JSON.parse(t) as Record<string, unknown>;
          const pl = asObj((o["payload"] as unknown) ?? null);
          if (o["type"] === "session_meta") {
            if (pl && pl["session_id"] === id) {
              ok = true;
              break;
            }
            if (o["session_id"] === id) {
              ok = true;
              break;
            }
          }
          if (pl && typeof pl["session_id"] === "string" && pl["session_id"] === id) {
            ok = true;
            break;
          }
        } catch {}
      }
    }
    if (!ok) {
      try {
        for (const line of txt.slice(0, 64 * 1024).split("\n"))
          if (line.includes(id)) {
            ok = true;
            break;
          }
      } catch {}
    }
    if (ok) {
      try {
        const s = await stat(p);
        return { path: p, offset: s.size };
      } catch {
        return { path: p, offset: Buffer.byteLength(txt) };
      }
    }
  }
  return null;
}
export async function readCodexTranscript(
  homeDir: string,
  id: string,
): Promise<ClaudeTranscript | null> {
  const resolved = await resolveCodexTranscriptPath(homeDir, id);
  if (!resolved) return null;
  let txt: string;
  try {
    txt = await readFile(resolved.path, "utf8");
  } catch {
    return null;
  }
  const messages: NormalizedMessage[] = [];
  let currentModel: string | undefined = undefined;
  for (const line of txt.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const raw = JSON.parse(line) as Record<string, unknown>;
      const pl = asObj(raw["payload"]);
      if (pl) {
        const threadSettings = asObj(pl["thread_settings"]);
        if (typeof threadSettings?.["model"] === "string") {
          currentModel = threadSettings["model"] as string;
        }
        if (typeof pl["model"] === "string") currentModel = pl["model"] as string;
        const info = asObj(pl["info"]);
        const lastUsage = asObj(info?.["last_token_usage"]);
        if (lastUsage) {
          const inTok =
            typeof lastUsage["input_tokens"] === "number"
              ? (lastUsage["input_tokens"] as number)
              : 0;
          const outTok =
            typeof lastUsage["output_tokens"] === "number"
              ? (lastUsage["output_tokens"] as number)
              : 0;
          const cacheTok =
            typeof lastUsage["cached_input_tokens"] === "number"
              ? (lastUsage["cached_input_tokens"] as number)
              : 0;
          const cacheWriteTok =
            typeof lastUsage["cache_write_input_tokens"] === "number"
              ? (lastUsage["cache_write_input_tokens"] as number)
              : 0;
          for (let i = messages.length - 1; i >= 0; i--) {
            const prev = messages[i];
            if (prev && prev.role === "assistant") {
              const effectiveModel = prev.meta?.model ?? currentModel;
              messages[i] = {
                ...prev,
                meta: {
                  ...(effectiveModel ? { model: effectiveModel } : {}),
                  usage: {
                    inputTokens: inTok,
                    outputTokens: outTok,
                    cacheReadInputTokens: cacheTok,
                    cacheCreationInputTokens: cacheWriteTok,
                  },
                },
              };
              break;
            }
          }
        }
      }
      const m = normalizeCodexLine(raw);
      if (m && m.blocks.length > 0) {
        if (m.role === "assistant" && currentModel && !m.meta?.model) {
          m.meta = { ...(m.meta ?? {}), model: currentModel };
        }
        messages.push(m);
      }
    } catch {}
  }
  if (messages.length === 0) return null;
  const projectLabel = await codexCwdFromFile(firstJsonlLine(txt));
  const dir = projectLabel.length > 0 ? `-${projectLabel.slice(1).replace(/\//g, "-")}` : "codex";
  return {
    dir,
    id,
    projectLabel: projectLabel || "OpenAI Codex",
    byteLength: Buffer.byteLength(txt, "utf8"),
    messages,
  } satisfies ClaudeTranscript;
}
export { normalizeCodexLine };
