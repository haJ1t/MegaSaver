import { spawnSync } from "node:child_process";
import type { KeyObject } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type MemoryEntry,
  dedupeKeywordFor,
  extractSessionMemories,
  readDigestState,
  writeDigestState,
} from "@megasaver/core";
import { checkEntitlement } from "@megasaver/entitlement";
import type { MemoryEntryId, SessionId } from "@megasaver/shared";
import { defineCommand } from "citty";
import { projectNotFoundMessage } from "../../errors.js";
import {
  type EnsureStoreReadyResult,
  ensureStoreReady,
  readStoreEnv,
  resolveStorePath,
} from "../../store.js";
import { applyApprovalFlip } from "../memory/approve.js";
import { formatMemorySearchLine } from "../memory/shared.js";
import { PRO_ANALYTICS_URL } from "../savings/index.js";
import {
  type DigestAction,
  type DigestActionResult,
  type DigestItem,
  runDigestLoop,
} from "./digest-loop.js";

export const DIGEST_UPSELL = `Brain digest is a Mega Saver Pro feature. Activate a key: mega license activate <key>. Learn more: ${PRO_ANALYTICS_URL}.`;

// Safety invariant §8.3: only autopilot writes this evidence prefix, so it is
// the auditable marker for "auto-approved while you were away".
const AUTOPILOT_EVIDENCE_PREFIX = "autopilot@1";
const DEFAULT_LIMIT = 50;

export type RunBrainDigestInput = {
  storeRoot: string;
  projectName: string;
  limitFlag: string | undefined;
  json: boolean;
  now: () => string;
  nowMs: () => number;
  publicKey?: KeyObject | string;
  ensureStore: () => Promise<EnsureStoreReadyResult>;
  isTTY: boolean;
  stdin: NodeJS.ReadableStream;
  editor: string | undefined;
  spawnEditor?: (editor: string, path: string) => { status: number | null };
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

function defaultSpawnEditor(editor: string, path: string): { status: number | null } {
  // $EDITOR may carry arguments ("code --wait"); mirror doctor-saver's
  // win32-shell vs `sh -c` split. stdio inherit hands the editor the TTY.
  const result =
    process.platform === "win32"
      ? spawnSync(`${editor} "${path}"`, { shell: true, stdio: "inherit" })
      : spawnSync("sh", ["-c", `${editor} "$0"`, path], { stdio: "inherit" });
  return { status: result.status };
}

export async function runBrainDigest(input: RunBrainDigestInput): Promise<0 | 1> {
  const ent = checkEntitlement("brain-autopilot", {
    storeRoot: input.storeRoot,
    now: input.nowMs,
    ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
  });
  if (!ent.entitled) {
    input.stdout(DIGEST_UPSELL);
    return 0;
  }

  let limit = DEFAULT_LIMIT;
  if (input.limitFlag !== undefined) {
    if (!/^[1-9]\d*$/.test(input.limitFlag.trim())) {
      input.stderr(`invalid --limit: expected a positive integer, got "${input.limitFlag}"`);
      return 1;
    }
    limit = Number.parseInt(input.limitFlag.trim(), 10);
  }

  const { registry, initialized } = await input.ensureStore();
  if (initialized) input.stderr(`note: initialized store at ${input.storeRoot}`);
  const project = registry.listProjects().find((p) => p.name === input.projectName);
  if (project === undefined) {
    const { message } = projectNotFoundMessage(input.projectName);
    input.stderr(message);
    return 1;
  }

  const since = readDigestState(input.storeRoot).lastDigestAt;
  const all = registry.listMemoryEntries(project.id);
  const suggested = all.filter((entry) => entry.approval === "suggested");
  const autoApproved = all.filter(
    (entry) =>
      entry.approval === "approved" &&
      entry.evidence?.[0]?.startsWith(AUTOPILOT_EVIDENCE_PREFIX) === true &&
      (since === null || Date.parse(entry.createdAt) > Date.parse(since)),
  );

  const sessions = registry.listSessions(project.id);
  const startedAtOf = (sessionId: string | null): number => {
    if (sessionId === null) return Number.NEGATIVE_INFINITY; // project-scope rows last
    const session = sessions.find((s) => s.id === sessionId);
    return session === undefined ? 0 : Date.parse(session.startedAt);
  };
  // Stable sort: session groups newest first, project-scope rows last;
  // within a group the registry's append order is preserved.
  const ordered = [...suggested].sort(
    (a, b) => startedAtOf(b.sessionId) - startedAtOf(a.sessionId),
  );
  const total = ordered.length;
  const visible = ordered.slice(0, limit);

  if (input.json) {
    input.stdout(
      JSON.stringify({
        total,
        showing: visible.length,
        autoApprovedSinceLastDigest: autoApproved.length,
        lastDigestAt: since,
        pending: visible,
      }),
    );
    return 0;
  }

  if (total === 0) {
    input.stdout(`Nothing to triage — 0 failures recorded since ${since ?? "ever"}.`);
    if (autoApproved.length > 0) {
      input.stdout(`${autoApproved.length} auto-approved while you were away`);
    }
    // A human looked at the (empty) digest — stamp it. Read-only surfaces
    // (--json above, plain non-TTY below) never write.
    if (input.isTTY) writeDigestState(input.storeRoot, { lastDigestAt: input.now() });
    return 0;
  }

  // occurrences is not persisted on MemoryEntry — recompute the display
  // signal ("seen N× this session", spec §5.1) with the same pure extractor
  // and join on the from-session keyword ledger.
  const occurrencesByKeyword = new Map<string, number>();
  const failures = registry.listFailedAttempts(project.id);
  const visibleSessionIds = new Set(
    visible.map((entry) => entry.sessionId).filter((id): id is SessionId => id !== null),
  );
  for (const sessionId of visibleSessionIds) {
    const candidates = extractSessionMemories({
      sessionId,
      projectId: project.id,
      failedAttempts: failures.filter((failure) => failure.sessionId === sessionId),
    });
    for (const candidate of candidates) {
      if (candidate.occurrences >= 2) {
        occurrencesByKeyword.set(dedupeKeywordFor(candidate.dedupeKey), candidate.occurrences);
      }
    }
  }

  const sessionLabelOf = (sessionId: string | null): string => {
    if (sessionId === null) return "project scope";
    const session = sessions.find((s) => s.id === sessionId);
    if (session === undefined) return sessionId;
    const ended = session.endedAt === null ? "open" : `ended ${session.endedAt}`;
    return `${session.title ?? session.id} (${ended})`;
  };
  const items: DigestItem[] = visible.map((entry) => {
    const hit = entry.keywords
      .map((keyword) => occurrencesByKeyword.get(keyword))
      .find((count) => count !== undefined);
    return {
      entry,
      sessionLabel: sessionLabelOf(entry.sessionId),
      ...(hit === undefined ? {} : { occurrencesNote: `seen ${hit}× this session` }),
    };
  });

  const header = `showing ${visible.length} of ${total} pending suggested`;
  const collapsed =
    autoApproved.length > 0
      ? `${autoApproved.length} auto-approved while you were away — press a to review`
      : null;

  if (!input.isTTY) {
    input.stdout(header);
    if (autoApproved.length > 0) {
      input.stdout(`${autoApproved.length} auto-approved while you were away`);
    }
    items.forEach((item, i) => {
      const note = item.occurrencesNote === undefined ? "" : `  ·  ${item.occurrencesNote}`;
      input.stdout(
        `${i + 1}. ${formatMemorySearchLine({
          id: item.entry.id,
          type: item.entry.type,
          confidence: item.entry.confidence,
          title: item.entry.title,
        })}${note}`,
      );
    });
    input.stdout("triage with: mega memory approve <id> · mega memory reject <id>");
    return 0;
  }

  const spawnEditor = input.spawnEditor ?? defaultSpawnEditor;
  const autoApprovedIds = new Set<MemoryEntryId>(autoApproved.map((entry) => entry.id));
  let autoExpanded = false;
  let lastFlip: {
    id: MemoryEntryId;
    previous: MemoryEntry["approval"];
    closedId: MemoryEntryId | null;
  } | null = null;

  const flip = (
    id: MemoryEntryId,
    approval: "approved" | "rejected" | "suggested",
    verb: string,
  ): DigestActionResult => {
    const existing = registry.getMemoryEntry(id);
    if (existing === null) return { lines: [`not found: ${id}`] };
    const outcome = applyApprovalFlip(registry, existing, approval, input.now());
    if (!outcome.changed) return { lines: [`${verb} ${id} (no change)`] };
    lastFlip = { id, previous: existing.approval, closedId: outcome.closedPredecessor?.id ?? null };
    const lines = [`${verb} ${id}`];
    if (outcome.closedPredecessor !== undefined) {
      lines.push(
        `note: closed ${outcome.closedPredecessor.id} ("${outcome.closedPredecessor.title}")`,
      );
    }
    return { lines, decided: true };
  };

  const onAction = async (action: DigestAction): Promise<DigestActionResult> => {
    switch (action.kind) {
      case "approve":
        return flip(action.id, "approved", autoApprovedIds.has(action.id) ? "kept" : "approved");
      case "reject":
        // Spot-review `n` REVOKES an autopilot approval back to suggested —
        // reversibility invariant §8.5; nothing is deleted.
        return autoApprovedIds.has(action.id)
          ? flip(action.id, "suggested", "revoked to suggested")
          : flip(action.id, "rejected", "rejected");
      case "skip":
        return { lines: [] };
      case "undo": {
        // Unreachable in practice: the loop only emits undo when it holds a
        // decision, and it clears lastDecisionIndex (digest-loop.ts:159) in
        // lockstep with the clear below. That lockstep spans a callback
        // boundary and nothing enforces it, so the guard stays — it is also
        // what proves `undone` non-null to the compiler.
        if (lastFlip === null) return { lines: ["nothing to undo"] };
        const undone = lastFlip;
        lastFlip = null;
        const existing = registry.getMemoryEntry(undone.id);
        if (existing === null) return { lines: [`not found: ${undone.id}`] };
        applyApprovalFlip(registry, existing, undone.previous, input.now());
        const lines = [`undid — ${undone.id} back to ${undone.previous}`];
        if (undone.closedId !== null) {
          // Undo reverts ONLY the approval flip; the supersession close is
          // not reverted (spec §6.2) — name the documented recovery.
          lines.push(
            `predecessor ${undone.closedId} stays closed — mega memory reopen ${undone.closedId}`,
          );
        }
        return { lines };
      }
      case "expandAuto": {
        if (autoExpanded || autoApproved.length === 0) {
          return { lines: ["no auto-approved rows to review"] };
        }
        autoExpanded = true;
        return {
          lines: [
            `spot-review: ${autoApproved.length} auto-approved (y keeps · n revokes to suggested)`,
          ],
          insertItems: autoApproved.map((entry) => ({ entry, sessionLabel: "auto-approved" })),
        };
      }
      case "edit": {
        if (input.editor === undefined || input.editor.trim().length === 0) {
          return { lines: ["$EDITOR is not set — skipped"] };
        }
        const existing = registry.getMemoryEntry(action.id);
        if (existing === null) return { lines: [`not found: ${action.id}`] };
        const path = join(tmpdir(), `mega-digest-${action.id}.md`);
        writeFileSync(path, `${existing.title}\n\n${existing.content}\n`);
        try {
          const result = spawnEditor(input.editor, path);
          if (result.status !== 0) {
            return { lines: ["editor exited non-zero — approve aborted (stays suggested)"] };
          }
          const text = readFileSync(path, "utf8");
          const [titleLine, ...rest] = text.split("\n");
          const title = (titleLine ?? "").trim();
          const content = rest.join("\n").trim();
          if (title.length > 0 || content.length > 0) {
            const updatedAt = input.now();
            try {
              registry.updateMemoryEntry(action.id, {
                ...(title.length > 0 ? { title } : {}),
                ...(content.length > 0 ? { content } : {}),
                // Content-bearing edit re-keys decay (i1 lastActiveAt keying).
                lastActiveAt: updatedAt,
                updatedAt,
              });
            } catch {
              // Editor output is a trust boundary — a Zod rejection (e.g.
              // over-long title) aborts the approve instead of crashing the loop.
              return { lines: ["invalid edit — approve aborted (stays suggested)"] };
            }
          }
          return flip(action.id, "approved", "edited + approved");
        } finally {
          rmSync(path, { force: true });
        }
      }
      case "quit": {
        // Only the loop emits quit (on `q` or exhaustion, never on abort),
        // so Ctrl-C mid-digest never stamps lastDigestAt.
        writeDigestState(input.storeRoot, { lastDigestAt: input.now() });
        return { lines: ["digest done — state saved"] };
      }
    }
  };

  input.stdout(header);
  if (collapsed !== null) input.stdout(collapsed);
  await runDigestLoop({
    input: input.stdin,
    output: input.stdout,
    isTTY: input.isTTY,
    queue: items,
    onAction,
  });
  return 0;
}

export const brainDigestCommand = defineCommand({
  meta: {
    name: "digest",
    description: "Single-keystroke triage of pending suggested memories (Mega Saver Pro).",
  },
  args: {
    projectName: { type: "positional", required: true, description: "Project name." },
    limit: { type: "string", description: "Max rows rendered (default 50, newest first)." },
    json: {
      type: "boolean",
      default: false,
      description: "Print the pending queue as JSON (read-only).",
    },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const storeRoot = resolveStorePath(
      readStoreEnv(typeof args.store === "string" ? args.store : undefined),
    );
    const code = await runBrainDigest({
      storeRoot,
      projectName: String(args.projectName),
      limitFlag: typeof args.limit === "string" ? args.limit : undefined,
      json: args.json === true,
      now: () => new Date().toISOString(),
      nowMs: () => Date.now(),
      ensureStore: () => ensureStoreReady(storeRoot),
      isTTY: !!process.stdout.isTTY,
      stdin: process.stdin,
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
      editor: process.env["EDITOR"],
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
