import { scanRepo } from "@megasaver/indexer";
import { defineCommand } from "citty";
import { mapErrorToCliMessage } from "../errors.js";
import { readStoreEnv } from "../store.js";
import { loadProjectContext } from "./index/shared.js";

export type RunScanInput = {
  projectName: string;
  jsonFlag: boolean;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runScan(input: RunScanInput): Promise<0 | 1> {
  const ctx = await loadProjectContext(input.projectName, input, input.stderr);
  if (!ctx) return 1;
  try {
    const result = scanRepo({ rootDir: ctx.project.rootPath });
    if (input.jsonFlag) {
      input.stdout(JSON.stringify(result));
    } else {
      for (const file of result.files) input.stdout(file.path);
      input.stderr(`# ${result.files.length} files, ${result.skipped.length} skipped`);
    }
    return 0;
  } catch (err) {
    input.stderr(mapErrorToCliMessage(err).message);
    return 1;
  }
}

export const scanCommand = defineCommand({
  meta: { name: "scan", description: "Scan a project's repo for indexable files." },
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
    const code = await runScan({
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      jsonFlag: args.json === true,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
