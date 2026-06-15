import type { RecordOverlayOutputInput, RecordOverlayOutputResult } from "@megasaver/core";
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
};

export type SaverSettings = { enabled: boolean; mode: TokenSaverMode };

export type SaverDeps = {
  storeRoot: string;
  readSettings: (storeRoot: string, workspaceKey: string) => SaverSettings | null;
  record: (input: RecordOverlayOutputInput) => Promise<RecordOverlayOutputResult>;
};

export type SaverDecision = { updatedToolOutput: unknown } | { passthrough: true };

const PASSTHROUGH: SaverDecision = { passthrough: true };

// Reads the text payload out of a Claude Code tool_output and returns a
// rebuilder that swaps it for compressed text while preserving every other
// field (so the emitted shape matches the tool's original schema). Unknown
// shapes ⇒ null ⇒ caller passes through (original output preserved).
type Shaped = { raw: string; rebuild: (text: string) => Record<string, unknown> };
function readOutputShape(toolOutput: unknown): Shaped | null {
  if (typeof toolOutput !== "object" || toolOutput === null) return null;
  const o = toolOutput as Record<string, unknown>;
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  if (typeof o["stdout"] === "string")
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    return { raw: o["stdout"], rebuild: (t) => ({ ...o, stdout: t }) };
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  if (typeof o["content"] === "string") {
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    return { raw: o["content"], rebuild: (t) => ({ ...o, content: t }) };
  }
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  if (Array.isArray(o["content"])) {
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    const blocks = o["content"] as unknown[];
    // Evidence-preserving (§1): never collapse a multi-modal array — if ANY
    // block is non-text (image, etc.) pass through verbatim. Only pure-text
    // arrays are safe to compress.
    const allText = blocks.every(
      (b) =>
        typeof b === "object" &&
        b !== null &&
        // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
        (b as { type?: unknown })["type"] === "text" &&
        // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
        typeof (b as { text?: unknown })["text"] === "string",
    );
    if (!allText || blocks.length === 0) return null;
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    const raw = blocks.map((b) => (b as { text: string })["text"]).join("\n");
    if (raw.length === 0) return null;
    return { raw, rebuild: (t) => ({ ...o, content: [{ type: "text", text: t }] }) };
  }
  return null;
}

function asStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
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

    const sourceKind = TOOL_SOURCE[tool];
    if (sourceKind === undefined) return PASSTHROUGH;

    const workspaceKey = encodeWorkspaceKey(cwd);
    const settings = deps.readSettings(deps.storeRoot, workspaceKey);
    if (settings === null || !settings.enabled) return PASSTHROUGH;

    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    const shape = readOutputShape(p["tool_output"]);
    if (shape === null) return PASSTHROUGH;
    if (Buffer.byteLength(shape.raw, "utf8") <= modeToBudget(settings.mode)) return PASSTHROUGH;

    const recorded = await deps.record({
      storeRoot: deps.storeRoot,
      workspaceKey,
      liveSessionId: sessionId,
      raw: shape.raw,
      sourceKind,
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      label: labelOf(p["tool_input"], tool),
      mode: settings.mode,
      storeRawOutput: true,
    });
    if (recorded.decision !== "compressed") return PASSTHROUGH;

    const pointer = recorded.chunkSetId
      ? `\n\n[Mega Saver: compressed ${recorded.rawBytes}→${recorded.returnedBytes} B. Full output recoverable — call proxy_expand_chunk("${recorded.chunkSetId}", "0") (or mega_fetch_chunk).]`
      : "";
    return { updatedToolOutput: shape.rebuild(`${recorded.returnedText}${pointer}`) };
  } catch {
    return PASSTHROUGH; // §13.4 best-effort: never break the tool call.
  }
}
