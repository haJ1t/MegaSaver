import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { contractSchema } from "@megasaver/memory-recall";
import { readSessionDecisionTrace } from "@megasaver/output-filter";
import { sessionIdSchema } from "@megasaver/shared";
import { mapErrorToCliMessage, projectNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { projectNameSchema } from "../shared/schemas.js";

const DEFAULT_CONTRACT_TOKEN_BUDGET = 2000;

const slugify = (intent: string): string =>
  intent
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 64)
    .replace(/-+$/, "");

export type RunContractsAddInput = {
  projectName: string;
  sessionFlag: string;
  nameFlag: string | undefined;
  intentFlag: string | undefined;
  budgetFlag: number | undefined;
  evidenceMemoryFlag: string | undefined;
  evidenceFileFlag: string | undefined;
  evidenceKeywordFlag: string | undefined;
  dirFlag: string | undefined;
  writeFlag: boolean;
  forceFlag: boolean;
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

export async function runContractsAdd(input: RunContractsAddInput): Promise<0 | 1> {
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

  let sessionId: string;
  try {
    sessionId = sessionIdSchema.parse(input.sessionFlag);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "name" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  let registry: Awaited<ReturnType<typeof ensureStoreReady>>["registry"];
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

  const session = registry.getSession(sessionId as never);
  if (!session || session.projectId !== project.id) {
    input.stderr(`error: session ${sessionId} not found in project ${projectName}`);
    return 1;
  }

  let intent = input.intentFlag ?? (session as { title?: string }).title;
  if (!intent || intent.trim().length === 0) {
    input.stderr("error: session has no title; pass --intent");
    return 1;
  }
  intent = intent.trim();

  // Evidence: explicit flags override trace derivation
  const requiredEvidence: { kind: "memory-entry-ref" | "file-ref" | "keyword"; value: string }[] =
    [];
  const hasExplicit =
    input.evidenceMemoryFlag !== undefined ||
    input.evidenceFileFlag !== undefined ||
    input.evidenceKeywordFlag !== undefined;

  if (hasExplicit) {
    const split = (v: string | undefined) =>
      v
        ? v
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
        : [];
    const memIds = [...new Set(split(input.evidenceMemoryFlag))];
    const files = [...new Set(split(input.evidenceFileFlag))];
    const keywords = [...new Set(split(input.evidenceKeywordFlag))];
    for (const id of memIds) requiredEvidence.push({ kind: "memory-entry-ref", value: id });
    for (const f of files) requiredEvidence.push({ kind: "file-ref", value: f });
    for (const k of keywords) requiredEvidence.push({ kind: "keyword", value: k });
  } else {
    // Derive from trace
    let trace: ReturnType<typeof readSessionDecisionTrace> | null = null;
    try {
      trace = readSessionDecisionTrace(
        { root: rootDir },
        {
          projectId: project.id as never,
          sessionId: session.id as never,
          workspaceKey: "0".repeat(16),
        },
      );
    } catch {
      trace = null;
    }
    const ids = [
      ...new Set(trace?.outputs.flatMap((o) => o.memory?.rankedByMemoryIds ?? []) ?? []),
    ];
    if (ids.length === 0) {
      input.stderr("error: no trace evidence; pass --evidence-* flags");
      return 1;
    }
    for (const id of ids) requiredEvidence.push({ kind: "memory-entry-ref", value: id });
  }

  if (requiredEvidence.length === 0) {
    input.stderr("error: no evidence; pass --evidence-* flags");
    return 1;
  }

  const name = input.nameFlag ?? slugify(intent);
  const tokenBudget = input.budgetFlag ?? DEFAULT_CONTRACT_TOKEN_BUDGET;

  const candidate = {
    name,
    intent,
    requiredEvidence,
    tokenBudget,
    createdFrom: session.id,
  };

  const parsed = contractSchema.safeParse(candidate);
  if (!parsed.success) {
    input.stderr(`error: invalid contract: ${parsed.error.message}`);
    return 1;
  }
  const contract = parsed.data;

  if (input.jsonFlag) {
    input.stdout(JSON.stringify(contract));
    if (!input.writeFlag) return 0;
  } else {
    input.stdout(JSON.stringify(contract, null, 2));
    if (!input.writeFlag) return 0;
  }

  const dir = input.dirFlag
    ? isAbsolute(input.dirFlag)
      ? input.dirFlag
      : join(input.cwd, input.dirFlag)
    : join(input.cwd, "contracts");
  const path = join(dir, `${contract.name}.contract.json`);
  if (existsSync(path) && !input.forceFlag) {
    input.stderr(`error: contract file exists at ${path}; use --force to overwrite`);
    return 1;
  }
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, `${JSON.stringify(contract, null, 2)}\n`, "utf8");
  } catch (err) {
    input.stderr(err instanceof Error ? err.message : String(err));
    return 1;
  }
  return 0;
}
