import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { contractSchema, evaluateContract } from "@megasaver/memory-recall";
import type { ContractFinding } from "@megasaver/memory-recall";
import { mapErrorToCliMessage, projectNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { projectNameSchema } from "../shared/schemas.js";

export type RunContractsRunInput = {
  projectName: string;
  dirFlag: string | undefined;
  contractFlag: string | undefined;
  jsonFlag: boolean;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  now?: () => string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

const repairHintFor = (finding: ContractFinding): string => {
  switch (finding.reason) {
    case "entry-missing":
      return `mega memory create (no entry ${finding.evidence.value} in this project)`;
    case "entry-stale":
      return `mega memory update ${finding.entryId}`;
    case "entry-not-recallable":
      return `mega memory approve ${finding.entryId} (human gate) or mega memory update ${finding.entryId}`;
    case "ranked-below-budget":
      return `raise tokenBudget in the contract file or mega memory update ${finding.entryId} to sharpen keywords`;
    default:
      return `mega memory create or mega memory update so an in-cut entry carries "${finding.evidence.value}"`;
  }
};

const renderReport = (results: readonly { name: string; pass: boolean; findings: readonly ContractFinding[]; cut: { size: number; tokenEstimate: number; rankedTotal: number } }[]): string[] =>
  results.flatMap((result) =>
    result.pass
      ? [`PASS ${result.name} (cut ${result.cut.size}/${result.cut.rankedTotal}, ~${result.cut.tokenEstimate} tokens)`]
      : [
          `FAIL ${result.name}`,
          ...result.findings
            .filter((finding) => finding.status === "fail")
            .flatMap((finding) => [`  ${finding.reason}: ${finding.detail}`, `  repair: ${repairHintFor(finding)}`]),
        ],
  );

export async function runContractsRun(input: RunContractsRunInput): Promise<0 | 1> {
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

  let registry;
  try {
    const ready = await ensureStoreReady(rootDir);
    registry = ready.registry;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }

  const project = registry.listProjects().find((p) => p.name === projectName);
  if (!project) {
    const cli = projectNotFoundMessage(projectName);
    input.stderr(cli.message);
    return cli.exitCode;
  }

  const dir = input.dirFlag ? (input.dirFlag.startsWith("/") ? input.dirFlag : join(input.cwd, input.dirFlag)) : join(input.cwd, "contracts");
  const asOf = (input.now ?? (() => new Date().toISOString()))();

  let files: string[] = [];
  try {
    if (!existsSync(dir)) {
      input.stdout("no contracts found");
      return 0;
    }
    const entries = readdirSync(dir);
    files = entries.filter((f) => f.endsWith(".contract.json")).sort();
    if (files.length === 0) {
      input.stdout("no contracts found");
      return 0;
    }
    if (input.contractFlag) {
      const wanted = `${input.contractFlag}.contract.json`;
      if (!files.includes(wanted)) {
        input.stderr(`error: contract ${input.contractFlag} not found in ${dir}`);
        return 1;
      }
      files = [wanted];
    }
  } catch (err) {
    input.stderr(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const results: Awaited<ReturnType<typeof evaluateContract>>[] = [];
  const entries = registry.listMemoryEntries(project.id as never);

  for (const file of files) {
    const path = join(dir, file);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch (err) {
      input.stderr(`error: malformed contract ${file}: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
    const parsed = contractSchema.safeParse(raw);
    if (!parsed.success) {
      input.stderr(`error: invalid contract ${file}: ${parsed.error.message}`);
      return 1;
    }
    const contract = parsed.data;
    try {
      const result = await evaluateContract({ contract, projectId: project.id as never, entries, storeRoot: rootDir, asOf });
      results.push(result);
    } catch (err) {
      input.stderr(`error: evaluating ${file}: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  }

  const pass = results.every((r) => r.pass);
  if (input.jsonFlag) {
    input.stdout(JSON.stringify({ asOf, pass, contracts: results }));
    return pass ? 0 : 1;
  }

  for (const line of renderReport(results)) input.stdout(line);
  return pass ? 0 : 1;
}


