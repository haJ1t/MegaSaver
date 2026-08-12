import { defineCommand } from "citty";
import { readStoreEnv } from "../../store.js";
import { runContractsAdd } from "./add.js";
import { runContractsRun } from "./run.js";

export const contractsRunCommand = defineCommand({
  meta: {
    name: "run",
    description: "Replay contracts through the recall pipeline (deterministic safe profile).",
  },
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

export const contractsAddCommand = defineCommand({
  meta: { name: "add", description: "Capture a contract from a finished session." },
  args: {
    projectName: { type: "positional", required: true, description: "Project name." },
    session: { type: "string", required: true, description: "Session id." },
    name: { type: "string", description: "Contract name (slug)." },
    intent: { type: "string", description: "Intent override." },
    budget: { type: "string", description: "Token budget." },
    "evidence-memory": { type: "string", description: "Comma-separated memory ids." },
    "evidence-file": { type: "string", description: "Comma-separated file refs." },
    "evidence-keyword": { type: "string", description: "Comma-separated keywords." },
    dir: { type: "string", description: "Contracts directory." },
    write: { type: "boolean", default: false, description: "Persist to file." },
    force: { type: "boolean", default: false, description: "Overwrite existing." },
    json: { type: "boolean", default: false, description: "Emit JSON." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const budget =
      typeof args.budget === "string" ? Number.parseInt(String(args.budget), 10) : undefined;
    const code = await runContractsAdd({
      projectName: typeof args.projectName === "string" ? String(args.projectName) : "",
      sessionFlag: typeof args.session === "string" ? String(args.session) : "",
      nameFlag: typeof args.name === "string" ? String(args.name) : undefined,
      intentFlag: typeof args.intent === "string" ? String(args.intent) : undefined,
      budgetFlag: budget !== undefined && Number.isFinite(budget) ? budget : undefined,
      evidenceMemoryFlag:
        typeof args["evidence-memory"] === "string" ? String(args["evidence-memory"]) : undefined,
      evidenceFileFlag:
        typeof args["evidence-file"] === "string" ? String(args["evidence-file"]) : undefined,
      evidenceKeywordFlag:
        typeof args["evidence-keyword"] === "string" ? String(args["evidence-keyword"]) : undefined,
      dirFlag: typeof args.dir === "string" ? String(args.dir) : undefined,
      writeFlag: args.write === true,
      forceFlag: args.force === true,
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
  subCommands: { run: contractsRunCommand, add: contractsAddCommand },
});
