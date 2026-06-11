import { defineCommand } from "citty";
import {
  deleteRequiresConfirmMessage,
  mapErrorToCliMessage,
  memoryEntryNotFoundMessage,
} from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { memoryEntryIdSchema } from "./shared.js";

export type RunMemoryDeleteInput = {
  memoryEntryId: string;
  yes: boolean;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runMemoryDelete(input: RunMemoryDeleteInput): Promise<0 | 1> {
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

  // Destructive op: require explicit --yes (the CLI is non-interactive).
  if (!input.yes) {
    const cli = deleteRequiresConfirmMessage();
    input.stderr(cli.message);
    return cli.exitCode;
  }

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);

    if (registry.getMemoryEntry(parsedId) === null) {
      const cli = memoryEntryNotFoundMessage(parsedId);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    registry.deleteMemoryEntry(parsedId);
    input.stdout(`deleted ${parsedId}`);
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const memoryDeleteCommand = defineCommand({
  meta: { name: "delete", description: "Delete a memory entry (requires --yes)." },
  args: {
    memoryEntryId: {
      type: "positional",
      required: true,
      description: "Memory entry id (UUID).",
    },
    yes: { type: "boolean", default: false, description: "Confirm deletion." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const code = await runMemoryDelete({
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      memoryEntryId: typeof args.memoryEntryId === "string" ? args.memoryEntryId : "",
      yes: args.yes === true,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
