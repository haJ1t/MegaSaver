import { readGuardCorpus } from "@megasaver/context-gate";
import { type GuardCandidate, guardCandidateCreatedAt, matchGuard } from "@megasaver/core";
import { defineCommand } from "citty";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { findProjectByCwd } from "../warmup.js";

export type RunGuardCheckInput = {
  storeRoot: string;
  cwd: string;
  now: () => number;
  query: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

function candidateLabel(candidate: GuardCandidate): string {
  return candidate.kind === "failed-attempt" ? candidate.attempt.failedStep : candidate.row.command;
}

export async function runGuardCheck(input: RunGuardCheckInput): Promise<0 | 1> {
  const { registry } = await ensureStoreReady(input.storeRoot);
  const project = findProjectByCwd(registry.listProjects(), input.cwd);
  if (project === null) {
    input.stderr(`error: no project matches ${input.cwd} — run: mega init`);
    return 1;
  }

  const candidates: GuardCandidate[] = [
    ...registry
      .listFailedAttempts(project.id)
      .map((attempt) => ({ kind: "failed-attempt" as const, attempt })),
    ...readGuardCorpus(input.storeRoot, project.id).map((row) => ({
      kind: "auto-capture" as const,
      row,
    })),
  ];

  const match = matchGuard({
    call: { tool: "Bash", command: input.query },
    candidates,
    mutedIds: [],
    firedIds: [],
    asOf: new Date(input.now()).toISOString(),
  });

  if (match === null) {
    input.stdout("no match");
    return 0;
  }

  input.stdout(
    `match: ${match.tier} ${match.action} — ${candidateLabel(match.candidate)} (${guardCandidateCreatedAt(match.candidate)})`,
  );
  return 0;
}

export const guardCheckCommand = defineCommand({
  meta: { name: "check", description: "Dry-run the Mistake Firewall matcher against a command." },
  args: {
    query: { type: "positional", required: true, description: "Command or description to test." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const code = await runGuardCheck({
      storeRoot: resolveStorePath(
        readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      ),
      cwd: process.cwd(),
      now: () => Date.now(),
      query: typeof args.query === "string" ? args.query : "",
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
