import {
  type MemoryEntryUpdatePatch,
  captureCodeAnchor,
  isReservedKeyword,
  memoryConfidenceSchema,
  memorySourceSchema,
  memoryTypeSchema,
  stripReservedKeywords,
} from "@megasaver/core";
import { titleSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import { z } from "zod";
import {
  emptyFieldMessage,
  invalidConfidenceMessage,
  invalidExpiresMessage,
  invalidSourceMessage,
  invalidTypeMessage,
  mapErrorToCliMessage,
  memoryEntryNotFoundMessage,
  nothingToUpdateMessage,
} from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { readTestEnv } from "../session/shared.js";
import { contentSchema, memoryEntryIdSchema, toStringArray } from "./shared.js";

export type RunMemoryUpdateInput = {
  memoryEntryId: string;
  typeFlag: string | undefined;
  titleFlag: string | undefined;
  contentFlag: string | undefined;
  confidenceFlag: string | undefined;
  sourceFlag: string | undefined;
  reasonFlag: string | undefined;
  goalFlag: string | undefined;
  keywordFlags: unknown;
  fileFlags: unknown;
  symbolFlags: unknown;
  anchorFlag?: boolean | undefined;
  staleFlag: boolean | undefined;
  expiresFlag: string | undefined;
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

export async function runMemoryUpdate(input: RunMemoryUpdateInput): Promise<0 | 1> {
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
  const updatedAt = readTestEnv("MEGA_TEST_NOW") ?? now();
  const patch: MemoryEntryUpdatePatch = { updatedAt };
  let touched = false;
  let contentBearing = false;

  if (input.typeFlag !== undefined) {
    const result = memoryTypeSchema.safeParse(input.typeFlag);
    if (!result.success) {
      const cli = invalidTypeMessage(input.typeFlag);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    patch.type = result.data;
    touched = true;
  }
  if (input.confidenceFlag !== undefined) {
    const result = memoryConfidenceSchema.safeParse(input.confidenceFlag);
    if (!result.success) {
      const cli = invalidConfidenceMessage(input.confidenceFlag);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    patch.confidence = result.data;
    touched = true;
  }
  if (input.sourceFlag !== undefined) {
    const result = memorySourceSchema.safeParse(input.sourceFlag);
    if (!result.success) {
      const cli = invalidSourceMessage(input.sourceFlag);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    patch.source = result.data;
    touched = true;
  }
  if (input.titleFlag !== undefined) {
    try {
      patch.title = titleSchema.parse(input.titleFlag);
    } catch (err) {
      const cli = mapErrorToCliMessage(err, { kind: "title" });
      input.stderr(cli.message);
      return cli.exitCode;
    }
    touched = true;
    contentBearing = true;
  }
  if (input.contentFlag !== undefined) {
    try {
      patch.content = contentSchema.parse(input.contentFlag);
    } catch (err) {
      const cli = mapErrorToCliMessage(err, { kind: "memory_create" });
      input.stderr(cli.message);
      return cli.exitCode;
    }
    touched = true;
    contentBearing = true;
  }
  if (input.reasonFlag !== undefined) {
    if (input.reasonFlag.trim().length === 0) {
      const cli = emptyFieldMessage("reason");
      input.stderr(cli.message);
      return cli.exitCode;
    }
    patch.reason = input.reasonFlag;
    touched = true;
  }
  if (input.goalFlag !== undefined) {
    if (input.goalFlag.trim().length === 0) {
      const cli = emptyFieldMessage("goal");
      input.stderr(cli.message);
      return cli.exitCode;
    }
    patch.goal = input.goalFlag;
    touched = true;
  }
  if (input.keywordFlags !== undefined) {
    patch.keywords = stripReservedKeywords(toStringArray(input.keywordFlags));
    touched = true;
    contentBearing = true;
  }
  if (input.fileFlags !== undefined) {
    patch.relatedFiles = toStringArray(input.fileFlags);
    touched = true;
    contentBearing = true;
  }
  if (input.symbolFlags !== undefined) {
    patch.relatedSymbols = toStringArray(input.symbolFlags);
    touched = true;
    contentBearing = true;
  }
  if (input.staleFlag !== undefined) {
    patch.stale = input.staleFlag;
    touched = true;
  }
  if (input.expiresFlag !== undefined) {
    if (!z.string().datetime({ offset: true }).safeParse(input.expiresFlag).success) {
      const cli = invalidExpiresMessage(input.expiresFlag);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    patch.expiresAt = input.expiresFlag;
    touched = true;
  }

  // Content-bearing edits refresh the decay anchor (lastActiveAt); metadata-only
  // patches (stale/expires/approval) must not reset a memory's age.
  if (contentBearing) patch.lastActiveAt = updatedAt;

  if (!touched) {
    const cli = nothingToUpdateMessage();
    input.stderr(cli.message);
    return cli.exitCode;
  }

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);

    const existing = registry.getMemoryEntry(parsedId);
    if (existing === null) {
      const cli = memoryEntryNotFoundMessage(parsedId);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    // A keyword replace strips reserved keywords from user input (above); carry
    // the row's existing reserved ledger keyword back so an edit never drops it
    // (which would let autopilot re-capture the row as a duplicate).
    if (patch.keywords !== undefined) {
      patch.keywords = [...existing.keywords.filter(isReservedKeyword), ...patch.keywords];
    }
    // Re-capture when citations change (spec §5.1). Best-effort: a failed
    // capture leaves the stored anchor untouched — verify will contradict or
    // repoint it from repo state if it drifted.
    if (
      input.anchorFlag !== false &&
      (input.fileFlags !== undefined || input.symbolFlags !== undefined)
    ) {
      const project = registry.getProject(existing.projectId);
      if (project !== null) {
        const anchor = await captureCodeAnchor({
          rootPath: project.rootPath,
          relatedFiles: patch.relatedFiles ?? existing.relatedFiles ?? [],
          relatedSymbols: patch.relatedSymbols ?? existing.relatedSymbols ?? [],
          now: updatedAt,
        });
        if (anchor !== undefined) patch.anchor = anchor;
      }
    }
    const updated = registry.updateMemoryEntry(parsedId, patch);
    input.stdout(input.jsonFlag ? JSON.stringify(updated) : updated.id);
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memory_update" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const memoryUpdateCommand = defineCommand({
  meta: { name: "update", description: "Update mutable fields of a memory entry." },
  args: {
    memoryEntryId: {
      type: "positional",
      required: true,
      description: "Memory entry id (UUID).",
    },
    type: { type: "string", description: `Set type (${memoryTypeSchema.options.join(" | ")}).` },
    title: { type: "string", description: "Set title." },
    content: { type: "string", description: "Set content." },
    keyword: { type: "string", description: "Replace keywords (repeatable)." },
    confidence: {
      type: "string",
      description: `Set confidence (${memoryConfidenceSchema.options.join(" | ")}).`,
    },
    source: {
      type: "string",
      description: `Set source (${memorySourceSchema.options.join(" | ")}).`,
    },
    reason: { type: "string", description: "Set reason." },
    goal: { type: "string", description: "Set goal." },
    file: { type: "string", description: "Replace related files (repeatable)." },
    symbol: {
      type: "string",
      description: "Replace related symbols, name or path#name (repeatable).",
    },
    anchor: {
      type: "boolean",
      default: true,
      description: "Re-capture the code anchor when citations change (--no-anchor to skip).",
    },
    stale: { type: "boolean", description: "Mark stale (--no-stale to clear)." },
    expires: { type: "string", description: "Set expiry timestamp (ISO-8601)." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runMemoryUpdate({
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      memoryEntryId: typeof args.memoryEntryId === "string" ? args.memoryEntryId : "",
      typeFlag: typeof args.type === "string" ? args.type : undefined,
      titleFlag: typeof args.title === "string" ? args.title : undefined,
      contentFlag: typeof args.content === "string" ? args.content : undefined,
      confidenceFlag: typeof args.confidence === "string" ? args.confidence : undefined,
      sourceFlag: typeof args.source === "string" ? args.source : undefined,
      reasonFlag: typeof args.reason === "string" ? args.reason : undefined,
      goalFlag: typeof args.goal === "string" ? args.goal : undefined,
      keywordFlags: args.keyword,
      fileFlags: args.file,
      symbolFlags: args.symbol,
      anchorFlag: args.anchor !== false,
      staleFlag: typeof args.stale === "boolean" ? args.stale : undefined,
      expiresFlag: typeof args.expires === "string" ? args.expires : undefined,
      jsonFlag: args.json === true,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
