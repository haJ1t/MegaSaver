import { assertProjectRoot } from "@megasaver/connectors-shared";
import { defineCommand } from "citty";
import { z } from "zod";
import {
  NAME_CONTROL_CHARS_MESSAGE,
  invalidTargetMessage,
  mapErrorToCliMessage,
  projectNotFoundMessage,
} from "../errors.js";
import { ensureStoreReady, resolveStorePath } from "../store.js";

const projectNameSchema = z
  .string()
  .trim()
  .min(1)
  // C0/C1 control chars and DEL break the line-oriented output protocol.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional
  .regex(/^[^\x00-\x1f\x7f-\x9f]+$/, NAME_CONTROL_CHARS_MESSAGE)
  .transform((value) => value.normalize("NFC"));

// Keep in sync with KNOWN_TARGET_IDS in apps/cli/src/errors.ts.
const KNOWN_TARGET_IDS = ["claude-code", "codex"] as const;
type KnownTargetId = (typeof KNOWN_TARGET_IDS)[number];

function isKnownTargetId(value: string): value is KnownTargetId {
  return (KNOWN_TARGET_IDS as readonly string[]).includes(value);
}

export type RunConnectorSyncInput = {
  projectName: string;
  targetFlag: string | undefined;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runConnectorSync(input: RunConnectorSyncInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath({
      storeFlag: input.storeFlag,
      cwd: input.cwd,
      home: input.home,
      xdgDataHome: input.xdgDataHome,
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

  if (input.targetFlag !== undefined && !isKnownTargetId(input.targetFlag)) {
    const cli = invalidTargetMessage(input.targetFlag);
    input.stderr(cli.message);
    return cli.exitCode;
  }

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) {
      input.stderr(`note: initialized store at ${rootDir}`);
    }
    const project = registry.listProjects().find((p) => p.name === projectName);
    if (!project) {
      const cli = projectNotFoundMessage(projectName);
      input.stderr(cli.message);
      return cli.exitCode;
    }

    try {
      await assertProjectRoot(project.rootPath);
    } catch (err) {
      const cli = mapErrorToCliMessage(err);
      input.stderr(cli.message);
      return cli.exitCode;
    }

    // Per-target loop lands in T3.
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const connectorSyncCommand = defineCommand({
  meta: { name: "sync", description: "Write Mega Saver context blocks into agent files." },
  args: {
    projectName: {
      type: "positional",
      required: true,
      description: "Project name (must already exist).",
    },
    target: {
      type: "string",
      description: "Optional target id to seed when its file does not exist.",
    },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const code = await runConnectorSync({
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      targetFlag: typeof args.target === "string" ? args.target : undefined,
      storeFlag: typeof args.store === "string" ? args.store : undefined,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      home: process.env["HOME"] ?? "",
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      xdgDataHome: process.env["XDG_DATA_HOME"],
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});

export const connectorCommand = defineCommand({
  meta: { name: "connector", description: "Manage Mega Saver connector targets." },
  subCommands: {
    sync: connectorSyncCommand,
  },
});
