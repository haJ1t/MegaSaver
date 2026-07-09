import {
  type RecordOverlayOutputInput,
  type RecordOverlayOutputResult,
  tokensFromBytes,
} from "@megasaver/core";
import type { OutputSourceKind } from "@megasaver/output-filter";
import { type TokenSaverMode, encodeWorkspaceKey, modeToBudget } from "@megasaver/shared";

// PostToolUse processes the OUTPUT of these read/observe tools. Write/Edit and
// MCP tools are skipped (nothing to read-compress / already proxied).
const TOOL_SOURCE: Record<string, OutputSourceKind> = {
  Read: "file",
  LS: "file",
  Bash: "command",
  Grep: "grep",
  Glob: "grep",
  WebFetch: "fetch",
  // Wave 1 (spec 2026-07-09): agent/search surfaces. "fetch" is off-limits for
  // these — its chunk-set label is URL-validated and would fail persistence.
  Task: "command",
  BashOutput: "command",
  Monitor: "command",
  WebSearch: "grep",
  ToolSearch: "grep",
};

// Mega's own bridge tools are already compressed upstream — never re-compress.
const MEGA_MCP_TOOL = /^mcp__megasaver__/i;
// The six native tools that predate wave-1 keep their plain mode budget;
// every newer/coarser surface (Task/background/search/mcp__*) gets the floor.
const ORIGINAL_TOOLS = new Set(["Read", "LS", "Bash", "Grep", "Glob", "WebFetch"]);
export const NEW_SURFACE_MIN_BYTES = 16_384;

function resolveSourceKind(tool: string): OutputSourceKind | undefined {
  const mapped = TOOL_SOURCE[tool];
  if (mapped !== undefined) return mapped;
  if (tool.startsWith("mcp__") && !MEGA_MCP_TOOL.test(tool)) return "command";
  return undefined;
}

function minBytesFor(tool: string, mode: TokenSaverMode): number {
  const budget = modeToBudget(mode);
  return ORIGINAL_TOOLS.has(tool) ? budget : Math.max(budget, NEW_SURFACE_MIN_BYTES);
}

export type SaverSettings = { enabled: boolean; mode: TokenSaverMode };

export type SaverDeps = {
  storeRoot: string;
  // Resolves activation from the cwd through the repository-family precedence
  // (exact → family → legacy-root → global). null ⇒ disabled/passthrough.
  resolveSettings: (storeRoot: string, cwd: string) => SaverSettings | null;
  readSessionIntent: (storeRoot: string, workspaceKey: string) => string | undefined;
  record: (input: RecordOverlayOutputInput) => Promise<RecordOverlayOutputResult>;
  // Metadata-only liveness heartbeats (best-effort; never block the tool call).
  recordInvocation: (storeRoot: string, workspaceKey: string) => void;
  recordCompression: (storeRoot: string, workspaceKey: string) => void;
};

export type SaverDecision = { updatedToolOutput: unknown } | { passthrough: true };

const PASSTHROUGH: SaverDecision = { passthrough: true };

// Reads the text payload out of a Claude Code tool_response and returns a
// rebuilder that swaps it for compressed text while preserving every other
// field (so the emitted shape matches the tool's original schema). Unknown
// shapes ⇒ null ⇒ caller passes through (original output preserved).
type Shaped = { raw: string; rebuild: (text: string) => unknown };
function readOutputShape(toolOutput: unknown): Shaped | null {
  // WebFetch (and other tools) can return the body as a bare string; the
  // updated output must stay a bare string so the tool schema is preserved.
  if (typeof toolOutput === "string") {
    return toolOutput.length === 0 ? null : { raw: toolOutput, rebuild: (t) => t };
  }
  if (typeof toolOutput !== "object" || toolOutput === null) return null;
  const o = toolOutput as Record<string, unknown>;
  // WebFetch object shape: { result: "<markdown/answer>" }.
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  if (typeof o["result"] === "string")
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    return { raw: o["result"], rebuild: (t) => ({ ...o, result: t }) };
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  const stdout = typeof o["stdout"] === "string" ? o["stdout"] : undefined;
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  const stderr = typeof o["stderr"] === "string" ? o["stderr"] : undefined;
  if (stdout !== undefined || stderr !== undefined) {
    // Wave 1 (A6): pnpm/cargo/webpack put their bulk on stderr — compress the
    // larger stream, keep the other untouched so the stdout/stderr split survives.
    // ponytail: the size gate below only sees the chosen slot; two comparably
    // large streams (each below floor, combined above) still pass through raw.
    // Handles the dominant "bulk on one stream" case; combined-stream gating +
    // both-slot compression is a follow-up wave if that leak proves real.
    const slot = (stderr?.length ?? 0) > (stdout?.length ?? 0) ? "stderr" : "stdout";
    const raw = slot === "stderr" ? (stderr as string) : (stdout ?? "");
    return { raw, rebuild: (t) => ({ ...o, [slot]: t }) };
  }
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  if (typeof o["content"] === "string") {
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    return { raw: o["content"], rebuild: (t) => ({ ...o, content: t }) };
  }
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  if (Array.isArray(o["content"])) {
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    const blocks = o["content"] as unknown[];
    if (blocks.length === 0) return null;
    const isText = (b: unknown): b is { type: "text"; text: string } =>
      typeof b === "object" &&
      b !== null &&
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      (b as { type?: unknown })["type"] === "text" &&
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      typeof (b as { text?: unknown })["text"] === "string";
    const textBlocks = blocks.filter(isText);
    if (textBlocks.length === 0) return null;
    const raw = textBlocks.map((b) => b.text).join("\n");
    if (raw.length === 0) return null;
    // Wave 1 (A7): compressed text lands at the FIRST text block's position;
    // non-text blocks (images, …) pass through byte-identical, order held.
    const rebuild = (t: string) => {
      const firstTextIdx = blocks.findIndex(isText);
      const next: unknown[] = [];
      blocks.forEach((b, i) => {
        if (i === firstTextIdx) next.push({ type: "text", text: t });
        else if (!isText(b)) next.push(b);
      });
      return { ...o, content: next };
    };
    return { raw, rebuild };
  }
  // Wave 1 (A5): Grep files_with_matches / Glob expose a filenames array —
  // uncapped 30KB+ leaks in a monorepo. Compress as newline-joined paths;
  // rebuild keeps the string[] schema (fewer, ranked paths + footer).
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  const filenames = o["filenames"];
  if (
    Array.isArray(filenames) &&
    filenames.length > 0 &&
    filenames.every((f) => typeof f === "string")
  ) {
    const raw = (filenames as string[]).join("\n");
    if (raw.length === 0) return null;
    // Drop empties so the appended footer's blank lines don't become bogus
    // ""-entries; numFiles (preserved via ...o) stays the authoritative count.
    return {
      raw,
      rebuild: (t) => ({ ...o, filenames: t.split("\n").filter((s) => s.length > 0) }),
    };
  }
  // Real Claude Code Read payload: the file body is nested at `file.content`, not
  // top-level `content`. Swap it while preserving the surrounding file metadata.
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  const file = o["file"];
  if (typeof file === "object" && file !== null) {
    const f = file as Record<string, unknown>;
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    if (typeof f["content"] === "string")
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      return { raw: f["content"], rebuild: (t) => ({ ...o, file: { ...f, content: t } }) };
  }
  return null;
}

function asStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

// The harness can truncate a tool output BEFORE the PostToolUse hook sees it; the
// stored chunk is then incomplete and "Full output recoverable" would be a lie.
// Anchored near the END of the buffer (last 256 bytes) to keep false positives low:
// a mid-text mention of truncation is normal content, not a real cutoff.
const TRUNCATION_MARKER = /\[truncated\b|output truncated|<truncated\b/i;
const TRUNCATION_TAIL_BYTES = 256;
function looksPreTruncated(raw: string): boolean {
  const tail = raw.length > TRUNCATION_TAIL_BYTES ? raw.slice(-TRUNCATION_TAIL_BYTES) : raw;
  return TRUNCATION_MARKER.test(tail);
}

function labelOf(toolInput: unknown, fallback: string): string {
  if (typeof toolInput !== "object" || toolInput === null) return fallback;
  const i = toolInput as Record<string, unknown>;
  return (
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    asStr(i["file_path"]) ??
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    asStr(i["path"]) ??
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    asStr(i["command"]) ??
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    asStr(i["pattern"]) ??
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    asStr(i["description"]) ??
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    asStr(i["query"]) ??
    // WebFetch labels by url; the fetch chunk-set source validates it as a URL,
    // so a bad fallback ("WebFetch") would fail persistence and blank the save.
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    asStr(i["url"]) ??
    fallback
  );
}

// Pure decision: never throws (callers rely on this), returns passthrough on any
// gate miss. `deps` are injected so tests need no fs/store.
export async function buildSaverDecision(
  payload: unknown,
  deps: SaverDeps,
): Promise<SaverDecision> {
  try {
    if (typeof payload !== "object" || payload === null) return PASSTHROUGH;
    const p = payload as Record<string, unknown>;
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    const tool = asStr(p["tool_name"]);
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    const sessionId = asStr(p["session_id"]);
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    const cwd = asStr(p["cwd"]);
    if (tool === undefined || sessionId === undefined || cwd === undefined) return PASSTHROUGH;

    const sourceKind = resolveSourceKind(tool);
    if (sourceKind === undefined) return PASSTHROUGH;

    // C13: a recovery expansion must arrive whole — never re-compress it.
    if (tool === "Bash") {
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      const ti = p["tool_input"];
      const i = typeof ti === "object" && ti !== null ? (ti as Record<string, unknown>) : {};
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      const cmd = asStr(i["command"]) ?? "";
      if (/\bmega\s+output\s+chunk\b/.test(cmd)) return PASSTHROUGH;
    }

    const workspaceKey = encodeWorkspaceKey(cwd);
    // Step 1: liveness heartbeat for every valid payload, before activation and
    // size gates (so a healthy hook is observable even on passthrough).
    deps.recordInvocation(deps.storeRoot, workspaceKey);

    const settings = deps.resolveSettings(deps.storeRoot, cwd);
    if (settings === null || !settings.enabled) return PASSTHROUGH;
    const sessionIntent = deps.readSessionIntent(deps.storeRoot, workspaceKey);

    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    const shape = readOutputShape(p["tool_response"]);
    if (shape === null) return PASSTHROUGH;
    if (Buffer.byteLength(shape.raw, "utf8") <= minBytesFor(tool, settings.mode))
      return PASSTHROUGH;

    const recorded = await deps.record({
      storeRoot: deps.storeRoot,
      // Evidence rows live under <storeRoot>/evidence/<wk>/ — same base root the
      // MCP approve-memory path reads from. Passing it turns on the best-effort
      // evidence write inside record(); a failure there never blocks compression.
      evidenceStoreRoot: deps.storeRoot,
      workspaceKey,
      liveSessionId: sessionId,
      raw: shape.raw,
      sourceKind,
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      label: labelOf(p["tool_input"], tool),
      mode: settings.mode,
      storeRawOutput: true,
      ...(sessionIntent !== undefined ? { intent: sessionIntent } : {}),
    });
    if (recorded.decision !== "compressed") return PASSTHROUGH;

    // Step 5: a qualifying compression updates the global latestCompression.
    deps.recordCompression(deps.storeRoot, workspaceKey);

    const rawTokens = tokensFromBytes(recorded.rawBytes);
    const returnedTokens = tokensFromBytes(recorded.returnedBytes);
    const tokenPct = rawTokens === 0 ? "0.0" : ((1 - returnedTokens / rawTokens) * 100).toFixed(1);
    const expandCmd = `run: mega output chunk "${recorded.chunkSetId}" "0"`;
    const recovery = looksPreTruncated(shape.raw)
      ? `NOTE: upstream output appears truncated, recovered chunk is PARTIAL, not complete — ${expandCmd} (or MCP proxy_expand_chunk if connected)`
      : `Full output recoverable — ${expandCmd} (or MCP proxy_expand_chunk if connected)`;
    const pointer = recorded.chunkSetId
      ? `\n\n[Mega Saver: compressed ${recorded.rawBytes}→${recorded.returnedBytes} B (~${rawTokens}→${returnedTokens} tokens, ${tokenPct}%). ${recovery}.]`
      : "";
    return { updatedToolOutput: shape.rebuild(`${recorded.returnedText}${pointer}`) };
  } catch {
    return PASSTHROUGH; // §13.4 best-effort: never break the tool call.
  }
}
