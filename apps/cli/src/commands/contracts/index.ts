import { defineCommand } from "citty";
import { readStoreEnv } from "../../store.js";
import { runContractsRun } from "./run.js";

export const contractsRunCommand = defineCommand({
  meta: { name: "run", description: "Replay contracts through the recall pipeline (deterministic safe profile)." },
  args: {
    projectName: { type: "positional", required: true, description: "Project name." },
    dir: { type: "string", description: "Contracts directory (default: ./contracts)." },
    contract: { type: "string", description: "Run one contract by name." },
    json: { type: "boolean", default: false, description: "Emit JSON report." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const code = await runContractsRun({
      projectName: typeof args.projectName === "string" ? String(args.projectName) : "",
      dirFlag: typeof args.dir === "string" ? String(args.dir) : undefined,
      contractFlag: typeof args.contract === "string" ? String(args.contract) : undefined,
      jsonFlag: args.json === true,
      ...readStoreEnv(typeof args.store === "string" ? String(args.store) : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});

export const contractsCommand = defineCommand({
  meta: { name: "contracts", description: "Context contracts — retrieval regression fixtures." },
  subCommands: { run: contractsRunCommand },
});
