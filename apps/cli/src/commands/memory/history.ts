import type { KeyObject } from "node:crypto";
import { buildLineage } from "@megasaver/core";
import { checkEntitlement } from "@megasaver/entitlement";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, memoryEntryNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { memoryEntryIdSchema } from "./shared.js";

export const MEMORY_HISTORY_UPSELL =
  "Memory history is a Mega Saver Pro feature. Activate a key: mega license activate <key>.";

export type RunMemoryHistoryInput = {
  memoryEntryId: string;
  storeFlag: string | undefined;
  jsonFlag: boolean;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  nowMs?: () => number;
  publicKey?: KeyObject | string;
};

export async function runMemoryHistory(input: RunMemoryHistoryInput): Promise<0 | 1> {
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

  // Gate first: entitlement is decided before any Pro compute runs.
  const ent = checkEntitlement("savings-analytics", {
    storeRoot: rootDir,
    now: input.nowMs ?? (() => Date.now()),
    ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
  });

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    const entry = registry.getMemoryEntry(parsedId);
    if (entry === null) {
      const cli = memoryEntryNotFoundMessage(parsedId);
      input.stderr(cli.message);
      return cli.exitCode;
    }

    const chain = buildLineage(registry.listMemoryEntries(entry.projectId), parsedId);

    if (!ent.entitled) {
      // Chains only form via supersession, so the ancestor count is cheap and
      // honest to disclose on the free tier.
      const priorVersions = chain.findIndex((e) => e.id === parsedId);
      input.stdout(
        priorVersions > 0
          ? `${priorVersions} prior versions. ${MEMORY_HISTORY_UPSELL}`
          : MEMORY_HISTORY_UPSELL,
      );
      return 0;
    }

    if (input.jsonFlag) {
      input.stdout(JSON.stringify(chain));
      return 0;
    }
    for (const e of chain) {
      input.stdout(`${e.id}  ${e.title}`);
      input.stdout(`  ${e.validFrom ?? e.createdAt} -> ${e.validTo ?? "current"}`);
      if (e.reason !== undefined) input.stdout(`  reason: ${e.reason}`);
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const memoryHistoryCommand = defineCommand({
  meta: { name: "history", description: "Show a memory entry's lineage chain (Pro)." },
  args: {
    memoryEntryId: {
      type: "positional",
      required: true,
      description: "Memory entry id (UUID).",
    },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runMemoryHistory({
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      memoryEntryId: typeof args.memoryEntryId === "string" ? args.memoryEntryId : "",
      jsonFlag: args.json === true,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
