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
};

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

    const sourceKind = TOOL_SOURCE[tool];
    if (sourceKind === undefined) return PASSTHROUGH;

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
    if (Buffer.byteLength(shape.raw, "utf8") <= modeToBudget(settings.mode)) return PASSTHROUGH;

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
    const recovery = looksPreTruncated(shape.raw)
      ? `NOTE: upstream output appears truncated, recovered chunk is PARTIAL, not complete — call proxy_expand_chunk("${recorded.chunkSetId}", "0") (or mega_fetch_chunk)`
      : `Full output recoverable — call proxy_expand_chunk("${recorded.chunkSetId}", "0") (or mega_fetch_chunk)`;
    const pointer = recorded.chunkSetId
      ? `\n\n[Mega Saver: compressed ${recorded.rawBytes}→${recorded.returnedBytes} B (~${rawTokens}→${returnedTokens} tokens, ${tokenPct}%). ${recovery}.]`
      : "";
    return { updatedToolOutput: shape.rebuild(`${recorded.returnedText}${pointer}`) };
  } catch {
    return PASSTHROUGH; // §13.4 best-effort: never break the tool call.
  }
}
