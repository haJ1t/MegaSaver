import { type MemoryEntryUpdatePatch, applySupersession } from "@megasaver/core";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, memoryEntryNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { readTestEnv } from "../session/shared.js";
import { memoryEntryIdSchema } from "./shared.js";

export type RunMemoryApproveInput = {
  memoryEntryId: string;
  approval: "approved" | "rejected";
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
    // True no-op: re-approving an already-approved memory must not churn updatedAt.
    if (existing.approval === input.approval) {
      input.stdout(input.jsonFlag ? JSON.stringify(existing) : existing.id);
      return 0;
    }
    const updatedAt = readTestEnv("MEGA_TEST_NOW") ?? now();
    const patch: MemoryEntryUpdatePatch = { approval: input.approval, updatedAt };
    const updated = registry.updateMemoryEntry(parsedId, patch);
    if (input.approval === "approved") {
      const result = applySupersession(registry, updated, () => updatedAt);
      if (result.closed && result.superseded) {
        input.stderr(
          `note: this approval closed ${result.superseded.id} ("${result.superseded.title}") — undo: mega memory reopen ${result.superseded.id}`,
        );
      }
    }
    input.stdout(input.jsonFlag ? JSON.stringify(updated) : updated.id);
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
