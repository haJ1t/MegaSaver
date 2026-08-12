import { type ReviewAttestation, computeDiffHash, readAttestations } from "@megasaver/core";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, projectNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { projectNameSchema } from "../shared/schemas.js";
import { parseRange } from "./attest.js";

type ExecGit = (args: string[], cwd: string, input?: string) => string;

export type ReviewCheckStatus = "no-attestations" | "current" | "stale";

export type ReviewCheckResult = {
  status: ReviewCheckStatus;
  currentDiffHash: string;
  current: ReviewAttestation[];
  mostRecentStale: ReviewAttestation | null;
};

export function classifyAttestations(
  currentHash: string,
  all: readonly ReviewAttestation[],
): ReviewCheckResult {
  if (all.length === 0) {
    return {
      status: "no-attestations",
      currentDiffHash: currentHash,
      current: [],
      mostRecentStale: null,
    };
  }
  const sorted = [...all].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const current = sorted.filter((r) => r.diffHash === currentHash);
  const mostRecentStale = sorted.find((r) => r.diffHash !== currentHash) ?? null;
  const status: ReviewCheckStatus = current.length > 0 ? "current" : "stale";
  return { status, currentDiffHash: currentHash, current, mostRecentStale };
}

export type RunReviewCheckInput = {
  projectName: string;
  range: string;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
  execGit?: ExecGit;
};

export async function runReviewCheck(input: RunReviewCheckInput): Promise<0 | 1> {
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

  const parsedRange = parseRange(input.range);
  if (!parsedRange) {
    input.stderr("error: invalid range, expected <base>..<head>");
    return 1;
  }

  let currentHash: string;
  try {
    currentHash = computeDiffHash(parsedRange.range, input.cwd, input.execGit);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    input.stderr(`error: git diff failed for range "${parsedRange.range}": ${msg}`);
    return 1;
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

    const all = readAttestations(rootDir, project.id);
    const result = classifyAttestations(currentHash, all);

    if (input.json) {
      input.stdout(JSON.stringify(result));
      return 0;
    }

    if (result.status === "no-attestations") {
      input.stdout("no reviews recorded for this project yet");
      return 0;
    }

    if (result.status === "current") {
      for (const r of result.current) {
        input.stdout(
          `current: ${r.diffHash.slice(0, 12)} verdict=${r.verdict} reviewer=${r.reviewerLabel} at=${r.createdAt}`,
        );
      }
      if (result.mostRecentStale) {
        input.stdout(
          `stale: ${result.mostRecentStale.diffHash.slice(0, 12)} verdict=${result.mostRecentStale.verdict} at=${result.mostRecentStale.createdAt}`,
        );
      }
      return 0;
    }

    // stale
    const stale = result.mostRecentStale;
    if (stale) {
      input.stdout("STALE — diff changed since this review");
      input.stdout(
        `stale: ${stale.diffHash.slice(0, 12)} verdict=${stale.verdict} reviewer=${stale.reviewerLabel} at=${stale.createdAt}`,
      );
      input.stdout(`current: ${currentHash.slice(0, 12)}`);
    } else {
      input.stdout(`stale: no current attestation for diff ${currentHash.slice(0, 12)}`);
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const reviewCheckCommand = defineCommand({
  meta: { name: "check", description: "Check review attestations against the current diff hash." },
  args: {
    range: {
      type: "positional",
      required: true,
      description: "Git range <base>..<head> (e.g. main..HEAD).",
    },
    project: { type: "string", required: true, description: "Project name (must exist)." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runReviewCheck({
      projectName: typeof args.project === "string" ? args.project : "",
      range: typeof args.range === "string" ? args.range : "",
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
