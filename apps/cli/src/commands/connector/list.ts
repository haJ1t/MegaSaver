import { join } from "node:path";
import { readTargetFile } from "@megasaver/connectors-shared";
import { defineCommand } from "citty";
import { KNOWN_TARGETS } from "../../known-targets.js";
import { readStoreEnv } from "../../store.js";
import { TARGET_ID_COLUMN_WIDTH, resolveProjectAndRoot } from "./shared.js";

export type RunConnectorListInput = {
  projectName: string;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  json: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

type ListRecord = {
  id: string;
  agent: string;
  relativePath: string;
  present: boolean;
};

export async function runConnectorList(input: RunConnectorListInput): Promise<0 | 1> {
  const resolved = await resolveProjectAndRoot({
    projectName: input.projectName,
    targetFlag: undefined,
    storeFlag: input.storeFlag,
    cwd: input.cwd,
    home: input.home,
    xdgDataHome: input.xdgDataHome,
    platform: input.platform,
    localAppData: input.localAppData,
    stderr: input.stderr,
  });
  if (!resolved.ok) return resolved.exitCode;
  const { project } = resolved;

  const records: ListRecord[] = [];
  for (const target of KNOWN_TARGETS) {
    const existing = await readTargetFile(join(project.rootPath, target.relativePath));
    const present = existing !== null;
    records.push({
      id: target.id,
      agent: target.agentId,
      relativePath: target.relativePath,
      present,
    });
    if (!input.json) {
      input.stdout(
        `${target.id.padEnd(TARGET_ID_COLUMN_WIDTH, " ")}  ${target.agentId.padEnd(
          TARGET_ID_COLUMN_WIDTH,
          " ",
        )}  ${target.relativePath}  ${present ? "present" : "absent"}`,
      );
    }
  }
  if (input.json) input.stdout(JSON.stringify(records));
  return 0;
}

export const connectorListCommand = defineCommand({
  meta: { name: "list", description: "List known connector targets and their presence." },
  args: {
    projectName: {
      type: "positional",
      required: true,
      description: "Project name (must already exist).",
    },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runConnectorList({
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      json: !!args.json,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
