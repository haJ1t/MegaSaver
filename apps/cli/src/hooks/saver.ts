import { realpathSync } from "node:fs";
import { type FailureKind, hashToolOutput } from "@megasaver/context-gate";
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
// Claude Code truncates Bash output at ~30 000 chars before the hook sees it;
// a gate at or above that ceiling means "never compress a command" (B9). Cap
// the Bash floor below the ceiling so safe mode (32 KB budget) still saves on
// commands; balanced/aggressive budgets already sit under the cap. Post-A4 the
// fit step targets a share of the input (output-filter targetBudget), so a
// 24-30 KB command output trims to ~half under safe and clears the admission
// floors — there is no untrimmed-then-reverted band left to gate out.
export const BASH_COMPRESS_FLOOR = 24_000;

function resolveSourceKind(tool: string): OutputSourceKind | undefined {
  const mapped = TOOL_SOURCE[tool];
  if (mapped !== undefined) return mapped;
  if (tool.startsWith("mcp__") && !MEGA_MCP_TOOL.test(tool)) return "command";
  return undefined;
}

// BashOutput/Monitor retrieve background-shell output, which shares Bash's
// ~30000-char truncation ceiling (undocumented, but the same shell machinery),
// so safe mode's 32000 floor would never fire — the B9 dead zone. Cap them
// below the ceiling too, while keeping the coarse 16384 new-surface floor for
// aggressive/balanced. Task is a subagent report (not shell-truncated,
// effectively unbounded) so its large reports already clear 32000 — it keeps
// the plain new-surface floor.
const BACKGROUND_SHELL_TOOLS = new Set(["BashOutput", "Monitor"]);

// §W1 lever (a) is implemented but NOT adopted here: the gate still derives
// from the mode budget. COMPRESS_FLOOR_BYTES (context-gate) is the decoupled
// value and is exported and tested; wiring it in would move the shipped trigger
// from 32 KB to 2 KB under `safe` — far more, far smaller rewrites. What each
// rewrite costs on the billed ledger is UNMEASURED: the in-place cache-churn
// tax once cited here was retracted (wiki/syntheses/saver-cache-churn,
// CORRECTION 2026-07-30), and no billed measurement has replaced it in either
// direction. That cost axis is exactly what the open A4 billed-S leg measures,
// so adoption stays gated on it and the conservative floor stays.
export function minBytesFor(tool: string, mode: TokenSaverMode): number {
  const budget = modeToBudget(mode);
  if (tool === "Bash") return Math.min(budget, BASH_COMPRESS_FLOOR);
  const floor = ORIGINAL_TOOLS.has(tool) ? budget : Math.max(budget, NEW_SURFACE_MIN_BYTES);
  return BACKGROUND_SHELL_TOOLS.has(tool) ? Math.min(floor, BASH_COMPRESS_FLOOR) : floor;
}

export function isSaverCoveredTool(tool: string): boolean {
  return resolveSourceKind(tool) !== undefined;
}

export type SaverSettings = { enabled: boolean; mode: TokenSaverMode };

export type SaverDeps = {
  storeRoot: string;
  // Resolves activation from the cwd through the repository-family precedence
  // (exact → family → legacy-root → global). null ⇒ disabled/passthrough.
  resolveSettings: (storeRoot: string, cwd: string) => SaverSettings | null;
  readSessionIntent: (
    storeRoot: string,
    workspaceKey: string,
    sessionId?: string,
  ) => string | undefined;
  record: (input: RecordOverlayOutputInput) => Promise<RecordOverlayOutputResult>;
  // Metadata-only liveness heartbeats (best-effort; never block the tool call).
  recordInvocation: (storeRoot: string, workspaceKey: string) => void;
  recordCompression: (storeRoot: string, workspaceKey: string) => void;
  // E21 ledger (best-effort; never block the tool call).
  recordFailure: (
    storeRoot: string,
    workspaceKey: string,
    kind: FailureKind,
    tsIso: string,
  ) => void;
  recordCompletion: (storeRoot: string, workspaceKey: string, tsIso: string) => void;
  // P1 first-sight ledger (fail-open at the store layer).
  hasSeenOutput: (
    storeRoot: string,
    workspaceKey: string,
    sessionId: string,
    hash: string,
  ) => boolean;
  recordSeenOutput: (
    storeRoot: string,
    workspaceKey: string,
    sessionId: string,
    hash: string,
  ) => void;
};

export type SaverDecision = { updatedToolOutput: unknown } | { passthrough: true };

const PASSTHROUGH: SaverDecision = { passthrough: true };

// Reads the text payload out of a Claude Code tool_response and returns a
// rebuilder that swaps it for compressed text while preserving every other
// field (so the emitted shape matches the tool's original schema). Unknown
// shapes ⇒ null ⇒ caller passes through (original output preserved).
// A Bash response carrying BOTH streams is exposed as two parts: the split is
// structural, never an in-band boundary line — such a line is a rankable,
// droppable chunk (dropping it relabels kept stderr evidence as stdout on
// rebuild) and would be persisted as if the command printed it (HOOK-4).
type ShapedText = { raw: string; rebuild: (text: string) => unknown };
type ShapedStreams = {
  streams: { stdout: string; stderr: string };
  rebuild: (stdout: string, stderr: string) => unknown;
};
type Shaped = ShapedText | ShapedStreams;
function readOutputShape(toolOutput: unknown): Shaped | null {
  // WebFetch (and other tools) can return the body as a bare string; the
  // updated output must stay a bare string so the tool schema is preserved.
  if (typeof toolOutput === "string") {
    return toolOutput.length === 0 ? null : { raw: toolOutput, rebuild: (t: string) => t };
  }
  if (typeof toolOutput !== "object" || toolOutput === null) return null;
  const o = toolOutput as Record<string, unknown>;
  // WebFetch object shape: { result: "<markdown/answer>" }.
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  if (typeof o["result"] === "string")
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    return { raw: o["result"], rebuild: (t: string) => ({ ...o, result: t }) };
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  const stdout = typeof o["stdout"] === "string" ? o["stdout"] : undefined;
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  const stderr = typeof o["stderr"] === "string" ? o["stderr"] : undefined;
  if (stdout !== undefined || stderr !== undefined) {
    const hasStdout = stdout !== undefined && stdout.length > 0;
    const hasStderr = stderr !== undefined && stderr.length > 0;
    if (hasStdout && hasStderr) {
      return {
        streams: { stdout: stdout as string, stderr: stderr as string },
        rebuild: (newStdout: string, newStderr: string) => ({
          ...o,
          stdout: newStdout,
          stderr: newStderr,
        }),
      };
    }
    const slot = hasStderr ? "stderr" : "stdout";
    const raw = slot === "stderr" ? (stderr as string) : (stdout ?? "");
    return { raw, rebuild: (t: string) => ({ ...o, [slot]: t }) };
  }
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  if (typeof o["content"] === "string") {
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    return { raw: o["content"], rebuild: (t: string) => ({ ...o, content: t }) };
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
  // rebuild keeps the string[] schema. W4: the rebuilt array must carry the
  // compression signal itself — an omission marker plus record()'s summary and
  // recovery-footer lines as trailing entries — or the model reads a silently
  // shortened list with no recovery handle. B6 still holds: every synthetic
  // entry sits behind an "… " sentinel so it cannot be mistaken for a result
  // path, and numFiles counts only genuine paths.
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  const filenames = o["filenames"];
  if (
    Array.isArray(filenames) &&
    filenames.length > 0 &&
    filenames.every((f) => typeof f === "string")
  ) {
    const orig = filenames as string[];
    const origSet = new Set(orig);
    const raw = orig.join("\n");
    if (raw.length === 0) return null;
    return {
      raw,
      rebuild: (t: string) => {
        const kept: string[] = [];
        const extras: string[] = [];
        for (const line of t.split("\n")) {
          if (origSet.has(line)) kept.push(line);
          else if (line.trim().length > 0) extras.push(line.startsWith("… ") ? line : `… ${line}`);
        }
        const marker = `… [Mega Saver: ${orig.length - kept.length} of ${orig.length} paths omitted]`;
        return { ...o, filenames: [...kept, marker, ...extras], numFiles: kept.length };
      },
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
      return { raw: f["content"], rebuild: (t: string) => ({ ...o, file: { ...f, content: t } }) };
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

type DecisionContext = { stage: FailureKind; workspaceKey?: string };

// Pure decision: never throws (callers rely on this), returns passthrough on
// any gate miss. `deps` are injected so tests need no fs/store. E21: a throw
// records a failure heartbeat with a coarse stage, a finished run records a
// completion — the invocation/completion gap is the crash signal. The §13.4
// fail-open posture is unchanged; failures become visible, not fatal.
export async function buildSaverDecision(
  payload: unknown,
  deps: SaverDeps,
): Promise<SaverDecision> {
  const ctx: DecisionContext = { stage: "payload" };
  try {
    const decision = await decide(payload, deps, ctx);
    // Only a run that stamped an invocation may stamp a completion: tools the
    // saver never processes return before the invocation heartbeat, and their
    // completion would clear a genuinely failing hook from doctor's liveness
    // FAIL — a fail-open inversion that hides dead compression.
    if (ctx.workspaceKey !== undefined) {
      try {
        deps.recordCompletion(deps.storeRoot, ctx.workspaceKey, new Date().toISOString());
      } catch {
        /* ledger is best-effort */
      }
    }
    return decision;
  } catch {
    try {
      deps.recordFailure(
        deps.storeRoot,
        // On a payload-stage failure the payload's cwd never parsed; fall back
        // to the hook process's own cwd — the same key the settings path uses.
        ctx.workspaceKey ?? encodeWorkspaceKey(process.cwd()),
        ctx.stage,
        new Date().toISOString(),
      );
    } catch {
      /* ledger is best-effort */
    }
    return PASSTHROUGH; // §13.4 best-effort: never break the tool call.
  }
}

async function decide(
  payload: unknown,
  deps: SaverDeps,
  ctx: DecisionContext,
): Promise<SaverDecision> {
  if (typeof payload !== "object" || payload === null) return PASSTHROUGH;
  const p = payload as Record<string, unknown>;
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  const tool = asStr(p["tool_name"]);
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  const sessionId = asStr(p["session_id"]);
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  const cwd = asStr(p["cwd"]);
  if (tool === undefined || sessionId === undefined || cwd === undefined) return PASSTHROUGH;
  ctx.stage = "resolve";

  // Canonicalize the payload cwd before the settings gate and the workspace
  // key: the enable command and exec-live derive both from the resolved real
  // path, so a symlinked/dotdot spelling would silently miss the settings
  // gate (passthrough with healthy heartbeats) or split the ledger key
  // (exec-rewrite-run.ts canonicalizes for the same reason).
  let canonicalCwd = cwd;
  try {
    canonicalCwd = realpathSync(cwd);
  } catch {
    // Identity, never behavior.
  }

  const sourceKind = resolveSourceKind(tool);
  if (sourceKind === undefined) return PASSTHROUGH;

  // C13: a recovery expansion must arrive whole — never re-compress it.
  // Foreground Bash only (the footer advertises a foreground run); a
  // backgrounded expansion read via BashOutput has no command in its input
  // to match — its re-compression is itself recoverable, so it's tolerated.
  // LD12: exec-live deliveries get the same exemption — their output is
  // already the compressed first-seen version; re-compressing it would mint
  // footer-on-footer text and garbage chunk sets of compressed content.
  // The launcher may be spelled any first-party form (mega, mega.mjs, or a
  // .../dist/cli.js dev path — hook-settings isFirstPartyLauncher), so the
  // exemption matches all three; over-match stays fail-open (no compression,
  // never corruption).
  if (tool === "Bash") {
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    const ti = p["tool_input"];
    const i = typeof ti === "object" && ti !== null ? (ti as Record<string, unknown>) : {};
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    const cmd = asStr(i["command"]) ?? "";
    if (/\b(?:mega|mega\.mjs|cli\.js)\s+output\s+(?:chunk|exec-live)\b/.test(cmd))
      return PASSTHROUGH;
  }

  const workspaceKey = encodeWorkspaceKey(canonicalCwd);
  ctx.workspaceKey = workspaceKey;
  // Step 1: liveness heartbeat for every valid payload, before activation and
  // size gates (so a healthy hook is observable even on passthrough).
  deps.recordInvocation(deps.storeRoot, workspaceKey);

  const settings = deps.resolveSettings(deps.storeRoot, canonicalCwd);
  if (settings === null || !settings.enabled) return PASSTHROUGH;
  const sessionIntent = deps.readSessionIntent(deps.storeRoot, workspaceKey, sessionId);

  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  const shape = readOutputShape(p["tool_response"]);
  if (shape === null) return PASSTHROUGH;
  const parts = "streams" in shape ? [shape.streams.stdout, shape.streams.stderr] : [shape.raw];
  // Dual-stream parts share workspace/session/label/raw-independent identity
  // inputs, so byte-identical stdout+stderr would derive one overlay event id
  // and the second event would be absorbed — name the slot so record() can
  // discriminate. Single-part shapes stay slotless (old event identity).
  const slots: readonly ("stdout" | "stderr" | undefined)[] =
    "streams" in shape ? ["stdout", "stderr"] : [undefined];
  const totalBytes = parts.reduce((sum, part) => sum + Buffer.byteLength(part, "utf8"), 0);
  const floorBytes = minBytesFor(tool, settings.mode);
  // B8: dual-stream output gates on the COMBINED size, so a small stream never
  // shields a large one from the floor.
  if (totalBytes <= floorBytes) return PASSTHROUGH;

  // P1 first-sight only: repeats pass through because the net-cost effect of
  // rewriting previously-seen content is UNMEASURED — the cache-churn
  // mechanism once cited here was retracted (wiki/syntheses/saver-cache-churn,
  // CORRECTION 2026-07-30). The first-sight ledger is the conservative choice
  // while the A4 billed-S leg is open.
  // "\0" join, not "\n": streams routinely contain newlines, so a newline
  // join aliases part boundaries ({a\nb, c} == {a, b\nc}) and a different
  // response could read as already-seen — an aliased skip is a silent
  // compression loss, unlike the ledger's usual fail-open direction.
  const outputHash = hashToolOutput(parts.join("\0"));
  if (deps.hasSeenOutput(deps.storeRoot, workspaceKey, sessionId, outputHash)) return PASSTHROUGH;

  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  const label = labelOf(p["tool_input"], tool);
  ctx.stage = "record";
  // The parts record SEQUENTIALLY, which a dual-stream response pays for
  // twice: worst case is two full daemon timeouts (2 x 1.5 s) before the
  // in-process fallbacks run, and a throw on part 2 leaves part 1's chunk set
  // and event already persisted while the whole decision falls to
  // passthrough. Both are accepted fail-open costs: the stall is bounded and
  // rare (a hung daemon), and the orphaned part-1 store is recoverable
  // evidence, never delivered — the model keeps the original output.
  const results: RecordOverlayOutputResult[] = [];
  for (const [i, part] of parts.entries()) {
    const partBytes = Buffer.byteLength(part, "utf8");
    const slot = slots[i];
    // Each part forwards its byte share of the floor, so clearing the combined
    // gate above is exactly clearing every per-part threshold — the hook stays
    // the single eligibility authority (B8) and record()'s admission guard
    // still rejects any per-part rewrite that would not pay for itself.
    const partFloor = Math.max(1, Math.round((floorBytes * partBytes) / totalBytes));
    const partHash = hashToolOutput(part);
    results.push(
      await deps.record({
        storeRoot: deps.storeRoot,
        // Evidence rows live under <storeRoot>/evidence/<wk>/ — same base root
        // the MCP approve-memory path reads from. Passing it turns on the
        // best-effort evidence write inside record(); a failure there never
        // blocks compression.
        evidenceStoreRoot: deps.storeRoot,
        workspaceKey,
        liveSessionId: sessionId,
        raw: part,
        sourceKind,
        label,
        mode: settings.mode,
        storeRawOutput: true,
        // F30: the recovery footer is built INSIDE record() so the persisted
        // numbers count it; returnedText comes back ready-to-emit.
        includeFooter: true,
        compressFloorBytes: partFloor,
        // P1: content-derived chunk-set id so a re-run at the same position
        // reuses the same id (idempotent store, no orphan chunk sets).
        newId: () => `cs-${partHash.slice(0, 32)}`,
        ...(sessionIntent !== undefined ? { intent: sessionIntent } : {}),
        ...(slot !== undefined ? { streamSlot: slot } : {}),
      }),
    );
  }
  if (!results.some((r) => r.decision === "compressed")) return PASSTHROUGH;

  // P1: mark seen ONLY after a confirmed compression — a passthrough/too-small
  // output stays unmarked so a later larger version at the same position can
  // still compress on its own first sight.
  deps.recordSeenOutput(deps.storeRoot, workspaceKey, sessionId, outputHash);

  // Step 5: a qualifying compression updates the global latestCompression.
  deps.recordCompression(deps.storeRoot, workspaceKey);

  // A part record() declined to compress is delivered verbatim — its slot
  // loses nothing, so it needs no recovery handle.
  const texts = results.map((r, i) =>
    r.decision === "compressed" ? r.returnedText : (parts[i] as string),
  );
  return {
    updatedToolOutput:
      "streams" in shape
        ? shape.rebuild(texts[0] as string, texts[1] as string)
        : shape.rebuild(texts[0] as string),
  };
}
