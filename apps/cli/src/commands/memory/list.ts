import type { KeyObject } from "node:crypto";
import { isCurrent } from "@megasaver/core";
import { checkEntitlement } from "@megasaver/entitlement";
import { defineCommand } from "citty";
import { z } from "zod";
import { invalidAsOfMessage, mapErrorToCliMessage, projectNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { projectNameSchema } from "../shared/schemas.js";
import { MEMORY_AS_OF_UPSELL, formatMemoryListLine } from "./shared.js";

export type RunMemoryListInput = {
  projectName: string;
  storeFlag: string | undefined;
  jsonFlag: boolean;
  asOfFlag?: string | undefined;
  nowMs?: () => number;
  publicKey?: KeyObject | string;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runMemoryList(input: RunMemoryListInput): Promise<0 | 1> {
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

  let projectName: string;
  try {
    projectName = projectNameSchema.parse(input.projectName);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "name" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  // --as-of is the only Pro-gated path here; without the flag this command
  // makes no entitlement call and behaves exactly as before.
  if (input.asOfFlag !== undefined) {
    const ent = checkEntitlement("savings-analytics", {
      storeRoot: rootDir,
      now: input.nowMs ?? (() => Date.now()),
      ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
    });
    if (!ent.entitled) {
      input.stdout(MEMORY_AS_OF_UPSELL);
      return 0;
    }
    if (!z.string().datetime({ offset: true }).safeParse(input.asOfFlag).success) {
      const cli = invalidAsOfMessage(input.asOfFlag);
      input.stderr(cli.message);
      return cli.exitCode;
    }
  }

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);

    const project = registry.listProjects().find((p) => p.name === projectName);
    if (!project) {
      const cli = projectNotFoundMessage(projectName);
      input.stderr(cli.message);
      return cli.exitCode;
    }

    const asOf = input.asOfFlag;
    const entries = registry.listMemoryEntries(project.id);
    const visible = asOf === undefined ? entries : entries.filter((e) => isCurrent(e, asOf));
    if (input.jsonFlag) {
      input.stdout(JSON.stringify(visible));
    } else {
      for (const entry of visible) {
        input.stdout(formatMemoryListLine(entry));
      }
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const memoryListCommand = defineCommand({
  meta: { name: "list", description: "List memory entries under a project." },
  args: {
    projectName: {
      type: "positional",
      required: true,
      description: "Project name (must already exist).",
    },
    "as-of": {
      type: "string",
      description: "Only entries valid at this ISO-8601 instant (Pro).",
    },
    store: { type: "string", description: "Override store directory." },
    json: {
      type: "boolean",
      default: false,
      description: "Emit JSON output.",
    },
  },
  async run({ args }) {
    const code = await runMemoryList({
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      asOfFlag: typeof args["as-of"] === "string" ? args["as-of"] : undefined,
      jsonFlag: args.json === true,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
