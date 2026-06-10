import { defineCommand } from "citty";
import { mapErrorToCliMessage, memoryEntryNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { formatMemoryShowLines, memoryEntryIdSchema } from "./shared.js";

export type RunMemoryShowInput = {
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
};

export async function runMemoryShow(input: RunMemoryShowInput): Promise<0 | 1> {
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

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    const entry = registry.getMemoryEntry(parsedId);
    if (!entry) {
      const cli = memoryEntryNotFoundMessage(parsedId);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    if (input.jsonFlag) {
      input.stdout(JSON.stringify(entry));
    } else {
      for (const line of formatMemoryShowLines(entry)) input.stdout(line);
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const memoryShowCommand = defineCommand({
  meta: { name: "show", description: "Show a memory entry's full details." },
  args: {
    memoryEntryId: {
      type: "positional",
      required: true,
      description: "Memory entry id (UUID).",
    },
    store: { type: "string", description: "Override store directory." },
    json: {
      type: "boolean",
      default: false,
      description: "Emit JSON output.",
    },
  },
  async run({ args }) {
    const code = await runMemoryShow({
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      memoryEntryId: typeof args.memoryEntryId === "string" ? args.memoryEntryId : "",
      jsonFlag: args.json === true,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
