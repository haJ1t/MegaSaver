import {
  type CoreRegistry,
  type MemoryEntry,
  type MemoryEntryUpdatePatch,
  applySupersession,
} from "@megasaver/core";
import type { MemoryEntryId } from "@megasaver/shared";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, memoryEntryNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { readTestEnv } from "../session/shared.js";
import { memoryEntryIdSchema } from "./shared.js";

export type RunMemoryApproveInput = {
  memoryEntryId: string;
  approval: "approved" | "rejected" | "suggested";
  storeFlag: string | undefined;
  jsonFlag: boolean;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  now?: () => string;
};

export type ApprovalFlipOutcome = {
  entry: MemoryEntry;
  changed: boolean;
  closedPredecessor?: { id: MemoryEntryId; title: string };
};

// The core approval flip shared by approve/reject and `mega brain digest`
// (architect m9: the digest opens the registry ONCE and must not re-resolve
// the store per keystroke — runMemoryApprove's signature forces per-call
// resolveStorePath + ensureStoreReady, so the flip is extracted instead).
// Byte-identical behavior: no-op guard, approval patch, supersession close
// only on the approved flip.
export function applyApprovalFlip(
  registry: CoreRegistry,
  existing: MemoryEntry,
  approval: "approved" | "rejected" | "suggested",
  updatedAt: string,
): ApprovalFlipOutcome {
  if (existing.approval === approval) return { entry: existing, changed: false };
  const patch: MemoryEntryUpdatePatch = { approval, updatedAt };
  const updated = registry.updateMemoryEntry(existing.id, patch);
  if (approval === "approved") {
    const result = applySupersession(registry, updated, () => updatedAt);
    if (result.closed && result.superseded) {
      return { entry: updated, changed: true, closedPredecessor: result.superseded };
    }
  }
  return { entry: updated, changed: true };
}

export async function runMemoryApprove(input: RunMemoryApproveInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath({
      storeFlag: input.storeFlag,
      cwd: input.cwd,
      home: input.home,
      xdgDataHome: input.xdgDataHome,
      platform: input.platform,
      localAppData: input.localAppData,
    });
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  let parsedId: ReturnType<typeof memoryEntryIdSchema.parse>;
  try {
    parsedId = memoryEntryIdSchema.parse(input.memoryEntryId);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memoryEntryId" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  const now = input.now ?? (() => new Date().toISOString());

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    const existing = registry.getMemoryEntry(parsedId);
    if (existing === null) {
      const cli = memoryEntryNotFoundMessage(parsedId);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    const updatedAt = readTestEnv("MEGA_TEST_NOW") ?? now();
    const flip = applyApprovalFlip(registry, existing, input.approval, updatedAt);
    if (flip.closedPredecessor !== undefined) {
      input.stderr(
        `note: this approval closed ${flip.closedPredecessor.id} ("${flip.closedPredecessor.title}") — undo: mega memory reopen ${flip.closedPredecessor.id}`,
      );
    }
    input.stdout(input.jsonFlag ? JSON.stringify(flip.entry) : flip.entry.id);
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memory_update" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

function defineApprovalCommand(name: "approve" | "reject", approval: "approved" | "rejected") {
  return defineCommand({
    meta: { name, description: `Set a memory entry's approval to ${approval}.` },
    args: {
      memoryEntryId: { type: "positional", required: true, description: "Memory entry id (UUID)." },
      store: { type: "string", description: "Override store directory." },
      json: { type: "boolean", default: false, description: "Emit JSON output." },
    },
    async run({ args }) {
      const code = await runMemoryApprove({
        ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
        memoryEntryId: typeof args.memoryEntryId === "string" ? args.memoryEntryId : "",
        approval,
        jsonFlag: args.json === true,
        stdout: (line) => console.log(line),
        stderr: (line) => console.error(line),
      });
      if (code !== 0) process.exitCode = code;
    },
  });
}

export const memoryApproveCommand = defineApprovalCommand("approve", "approved");
export const memoryRejectCommand = defineApprovalCommand("reject", "rejected");
