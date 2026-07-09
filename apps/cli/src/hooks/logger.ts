import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

// Proxy Mode v1.2 §13 — Claude Code PreToolUse telemetry logger.
//
// SAFETY CONTRACT (§13.4): metadata-only, best-effort, ALWAYS safe. The
// logger must NEVER read or emit file contents, NEVER throw, and NEVER block,
// delay, or abort the user's original tool call. Every entry point here
// swallows its own errors; the runnable wrapper (logger-run.ts) always
// exits 0.

// §13.3 (wave 1, spec 2026-07-09): native tools whose calls are eligible to
// log, mapped to their eligibility category tag. Anything else (Write,
// Edit, …) is skipped. Any mcp__* tool (other than Mega's own bridge) is
// also eligible, via categoryFor below — it can't be enumerated statically.
const TOOL_CATEGORY: Record<string, string> = {
  Read: "eligible_read",
  Bash: "eligible_command",
  Grep: "eligible_search",
  Glob: "eligible_search",
  LS: "eligible_read",
  WebFetch: "eligible_read",
  Task: "eligible_command",
  BashOutput: "eligible_command",
  Monitor: "eligible_command",
  WebSearch: "eligible_search",
  ToolSearch: "eligible_search",
};

// Mega's own bridge tools are never self-logged.
const MEGA_MCP_TOOL = /^mcp__megasaver__/i;

function categoryFor(tool: string): string | undefined {
  const mapped = TOOL_CATEGORY[tool];
  if (mapped !== undefined) return mapped;
  if (tool.startsWith("mcp__") && !MEGA_MCP_TOOL.test(tool)) return "eligible_mcp";
  return undefined;
}

export const ELIGIBLE_HOOK_TOOLS: ReadonlySet<string> = new Set(Object.keys(TOOL_CATEGORY));

export const HOOK_LOG_RELATIVE_PATH = join(".megasaver", "hooks", "claude-tool-calls.jsonl");

type HookLine = {
  timestamp: string;
  agent: "claude-code";
  tool: string;
  category: string;
  filePath?: string;
  sessionId?: string;
};

// Named optional-property views of the JSON payload — declaring the exact
// fields we read (instead of an index signature) keeps both TS
// (noPropertyAccessFromIndexSignature) and Biome (useLiteralKeys) happy with
// plain dot access.
type PreToolUsePayload = {
  tool_name?: unknown;
  tool_input?: unknown;
  session_id?: unknown;
};
type ToolInput = { file_path?: unknown; path?: unknown };

function asObject<T>(value: unknown): T | null {
  return typeof value === "object" && value !== null ? (value as T) : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

// Claude Code passes a JSON payload with `tool_name`, `tool_input`, and
// `session_id`. Only the path string is ever read from tool_input — never any
// content/command body. Returns the JSON line, or null to skip this call.
export function buildHookLine(payload: unknown, now: () => string): string | null {
  const record = asObject<PreToolUsePayload>(payload);
  if (record === null) return null;

  const tool = asString(record.tool_name);
  if (tool === undefined) return null;
  const category = categoryFor(tool);
  if (category === undefined) return null;

  const input = asObject<ToolInput>(record.tool_input);
  const filePath = input ? (asString(input.file_path) ?? asString(input.path)) : undefined;
  const sessionId = asString(record.session_id);

  const line: HookLine = {
    timestamp: now(),
    agent: "claude-code",
    tool,
    category,
    ...(filePath !== undefined ? { filePath } : {}),
    ...(sessionId !== undefined ? { sessionId } : {}),
  };
  return JSON.stringify(line);
}

export type WriteHookLineInput = {
  megasaverRoot: string;
  payload: unknown;
  now?: () => string;
};

// Best-effort append. mkdir-p the hooks dir, append one line. On ANY failure
// (no dir, unwritable, bad payload) swallow and return — the tool call must
// never be blocked.
export function writeHookLine(input: WriteHookLineInput): void {
  try {
    const now = input.now ?? (() => new Date().toISOString());
    const line = buildHookLine(input.payload, now);
    if (line === null) return;
    const logPath = join(input.megasaverRoot, HOOK_LOG_RELATIVE_PATH);
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, `${line}\n`);
  } catch {
    // Intentionally swallowed — §13.4 best-effort guarantee.
  }
}
