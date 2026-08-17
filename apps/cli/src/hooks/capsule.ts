import { join } from "node:path";
import { CAPSULE_FILENAME, type ChunkSetSummary } from "@megasaver/content-store";
import { estimateTokens } from "@megasaver/output-filter";
import { z } from "zod";

export const CAPSULE_TOKEN_BUDGET = 2_000;
export const CAPSULE_VERSION = 1;

export const workStateCapsuleSchema = z
  .object({
    version: z.literal(CAPSULE_VERSION),
    capturedAt: z.string().datetime({ offset: true }),
    trigger: z.string().max(32),
    intent: z.object({ prompt: z.string(), ts: z.number() }).optional(),
    filesTouched: z.array(
      z.object({ path: z.string(), chunkSetId: z.string().min(1), createdAt: z.string() }),
    ),
    commandsRun: z.array(
      z.object({ command: z.string(), chunkSetId: z.string().min(1), createdAt: z.string() }),
    ),
    searchCount: z.number().int().nonnegative(),
    fetchCount: z.number().int().nonnegative(),
    // Reserved: no session-scoped decision capture exists yet (spec Non-Goals).
    openDecisions: z.array(z.string()),
  })
  .strict();

export type WorkStateCapsule = z.infer<typeof workStateCapsuleSchema>;

export function capsulePath(
  storeRoot: string,
  workspaceKey: string,
  liveSessionId: string,
): string {
  return join(storeRoot, "content", workspaceKey, liveSessionId, CAPSULE_FILENAME);
}

export type BuildCapsuleInput = {
  summaries: readonly ChunkSetSummary[];
  intent?: { prompt: string; ts: number } | undefined;
  trigger: string;
  now: () => number;
};

export function buildWorkStateCapsule(input: BuildCapsuleInput): WorkStateCapsule {
  const filesTouched: WorkStateCapsule["filesTouched"] = [];
  const commandsRun: WorkStateCapsule["commandsRun"] = [];
  let searchCount = 0;
  let fetchCount = 0;
  // Newest first: budget trimming later drops from the tail (oldest receipts).
  const ordered = [...input.summaries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const seenPaths = new Set<string>();
  for (const s of ordered) {
    if (s.source.kind === "file") {
      if (seenPaths.has(s.source.path)) continue;
      seenPaths.add(s.source.path);
      filesTouched.push({
        path: s.source.path,
        chunkSetId: s.chunkSetId,
        createdAt: s.createdAt,
      });
    } else if (s.source.kind === "command") {
      commandsRun.push({
        command: s.source.command,
        chunkSetId: s.chunkSetId,
        createdAt: s.createdAt,
      });
    } else if (s.source.kind === "grep") {
      searchCount += 1;
    } else {
      fetchCount += 1;
    }
  }
  return {
    version: CAPSULE_VERSION,
    capturedAt: new Date(input.now()).toISOString(),
    trigger: input.trigger.slice(0, 32),
    ...(input.intent !== undefined ? { intent: input.intent } : {}),
    filesTouched,
    commandsRun,
    searchCount,
    fetchCount,
    openDecisions: [],
  };
}

// Defense in depth over the already-redacted store labels (record-output.ts
// redacts labels before persist; intent-run redacts prompts at capture).
export function redactCapsule(
  capsule: WorkStateCapsule,
  redactString: (s: string) => string,
): WorkStateCapsule {
  return {
    ...capsule,
    ...(capsule.intent !== undefined
      ? { intent: { ...capsule.intent, prompt: redactString(capsule.intent.prompt) } }
      : {}),
    filesTouched: capsule.filesTouched.map((f) => ({ ...f, path: redactString(f.path) })),
    commandsRun: capsule.commandsRun.map((c) => ({ ...c, command: redactString(c.command) })),
    openDecisions: capsule.openDecisions.map(redactString),
  };
}

// Intent files store the full redacted prompt (intent-run's writeIntentAt has
// no length clamp; UserPromptSubmit stdin caps at 256 KB), so an unclamped
// intent line alone could exceed the whole token budget no matter how far
// entry trimming goes. Clamp at render time; the capsule file keeps the full prompt.
const INTENT_RENDER_MAX_CHARS = 500;

function truncateIntent(prompt: string): string {
  if (prompt.length <= INTENT_RENDER_MAX_CHARS) return prompt;
  return `${prompt.slice(0, INTENT_RENDER_MAX_CHARS)}…`;
}

function renderWith(capsule: WorkStateCapsule, maxEntries: number): string {
  const lines: string[] = [
    "MEGA SAVER — WORK ALREADY DONE THIS SESSION (pre-compact snapshot).",
    "Trust these receipts; do not redo them. Expand any receipt with:",
    '  mega output chunk "<chunkSetId>" "<i>"  (or MCP proxy_expand_chunk).',
  ];
  if (capsule.intent !== undefined) {
    lines.push(`Task intent: ${truncateIntent(capsule.intent.prompt)}`);
  }
  const files = capsule.filesTouched.slice(0, maxEntries);
  if (files.length > 0) {
    lines.push(`Files touched (${capsule.filesTouched.length}):`);
    for (const f of files) lines.push(`  - ${f.path}  [${f.chunkSetId}]`);
    const dropped = capsule.filesTouched.length - files.length;
    if (dropped > 0) lines.push(`  … +${dropped} more in store`);
  }
  const commands = capsule.commandsRun.slice(0, maxEntries);
  if (commands.length > 0) {
    lines.push(`Commands run (${capsule.commandsRun.length}):`);
    for (const c of commands) lines.push(`  - ${c.command}  [${c.chunkSetId}]`);
    const dropped = capsule.commandsRun.length - commands.length;
    if (dropped > 0) lines.push(`  … +${dropped} more in store`);
  }
  if (capsule.searchCount > 0 || capsule.fetchCount > 0) {
    lines.push(
      `Also this session: ${capsule.searchCount} searches, ${capsule.fetchCount} fetches (in store).`,
    );
  }
  if (capsule.openDecisions.length > 0) {
    lines.push("Open decisions:");
    for (const d of capsule.openDecisions) lines.push(`  - ${d}`);
  }
  lines.push(
    "Unchanged re-reads return unchanged-markers pointing at prior chunk-sets; expand instead of re-reading.",
  );
  return lines.join("\n");
}

export function renderCapsuleContext(capsule: WorkStateCapsule): string {
  let maxEntries = 40;
  for (;;) {
    const text = renderWith(capsule, maxEntries);
    if (estimateTokens(text) <= CAPSULE_TOKEN_BUDGET || maxEntries === 0) return text;
    maxEntries = maxEntries > 4 ? Math.floor(maxEntries / 2) : maxEntries - 1;
  }
}
