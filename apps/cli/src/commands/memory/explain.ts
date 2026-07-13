import { defineCommand } from "citty";
import { mapErrorToCliMessage, memoryEntryNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import {
  formatMemoryExplainLines,
  formatMemoryLineageLines,
  formatMemoryValidationLines,
  memoryEntryIdSchema,
} from "./shared.js";

export type RunMemoryExplainInput = {
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

export async function runMemoryExplain(input: RunMemoryExplainInput): Promise<0 | 1> {
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
    const validation = registry.getMemoryValidation(parsedId);
    if (input.jsonFlag) {
      input.stdout(JSON.stringify({ ...entry, validation: validation ?? null }));
    } else {
      for (const line of formatMemoryExplainLines(entry)) input.stdout(line);
      for (const line of formatMemoryValidationLines(validation)) input.stdout(line);
      const all = registry.listMemoryEntries(entry.projectId);
      for (const line of formatMemoryLineageLines(entry, all)) input.stdout(line);
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const memoryExplainCommand = defineCommand({
  meta: { name: "explain", description: "Explain a memory entry (all fields)." },
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
    const code = await runMemoryExplain({
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      memoryEntryId: typeof args.memoryEntryId === "string" ? args.memoryEntryId : "",
      jsonFlag: args.json === true,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
