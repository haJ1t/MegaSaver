import {
  appendAttestation,
  computeDiffHash,
  reviewAttestationSchema,
  reviewVerdictSchema,
} from "@megasaver/core";
import { redact } from "@megasaver/policy";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, projectNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { readTestEnv } from "../session/shared.js";
import { projectNameSchema } from "../shared/schemas.js";

type ExecGit = (args: string[], cwd: string, input?: string) => string;

export function parseRange(
  raw: string,
): { range: string; baseRef: string; headRef: string } | null {
  const trimmed = raw.trim();
  const idx = trimmed.indexOf("..");
  if (idx === -1) return null;
  const base = trimmed.slice(0, idx).trim();
  let head = trimmed.slice(idx + 2).trim();
  if (head.startsWith(".")) head = head.slice(1).trim();
  if (base === "" || head === "") return null;
  return { range: trimmed, baseRef: base, headRef: head };
}

export type RunReviewAttestInput = {
  projectName: string;
  range: string;
  verdictFlag: string;
  reviewerFlag: string | undefined;
  noteFlag: string | undefined;
  reviewPackFlag: string | undefined;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
  now?: () => string;
  execGit?: ExecGit;
};

export async function runReviewAttest(input: RunReviewAttestInput): Promise<0 | 1> {
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

  const verdictParsed = reviewVerdictSchema.safeParse(input.verdictFlag);
  if (!verdictParsed.success) {
    input.stderr(
      `error: invalid verdict "${input.verdictFlag}", expected: ${reviewVerdictSchema.options.join(" | ")}`,
    );
    return 1;
  }

  const reviewerLabel =
    input.reviewerFlag !== undefined && input.reviewerFlag.trim() !== ""
      ? input.reviewerFlag.trim()
      : "unspecified";

  let diffHash: string;
  try {
    diffHash = computeDiffHash(parsedRange.range, input.cwd, input.execGit);
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

    const now =
      readTestEnv("MEGA_TEST_NOW") ?? (input.now ? input.now() : new Date().toISOString());

    let note: string | undefined;
    if (input.noteFlag !== undefined) {
      note = redact(input.noteFlag).redacted;
    }

    const record = reviewAttestationSchema.parse({
      diffHash,
      baseRef: parsedRange.baseRef,
      headRef: parsedRange.headRef,
      verdict: verdictParsed.data,
      reviewerLabel,
      ...(note !== undefined ? { note } : {}),
      ...(input.reviewPackFlag !== undefined ? { reviewPackId: input.reviewPackFlag } : {}),
      createdAt: now,
    });

    appendAttestation(rootDir, project.id, record);

    if (input.json) {
      input.stdout(JSON.stringify(record));
    } else {
      input.stdout(
        `attested ${diffHash.slice(0, 12)} verdict=${record.verdict} reviewer=${record.reviewerLabel}`,
      );
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const reviewAttestCommand = defineCommand({
  meta: { name: "attest", description: "Record a review verdict against a diff hash." },
  args: {
    range: {
      type: "positional",
      required: true,
      description: "Git range <base>..<head> (e.g. main..HEAD).",
    },
    verdict: {
      type: "string",
      required: true,
      description: `Verdict: ${reviewVerdictSchema.options.join(" | ")}.`,
    },
    reviewer: { type: "string", description: "Reviewer label (e.g. code-reviewer)." },
    note: { type: "string", description: "Optional note (redacted before storage)." },
    "review-pack": { type: "string", description: "Optional review-pack id cross-reference." },
    project: { type: "string", required: true, description: "Project name (must exist)." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runReviewAttest({
      projectName: typeof args.project === "string" ? args.project : "",
      range: typeof args.range === "string" ? args.range : "",
      verdictFlag: typeof args.verdict === "string" ? args.verdict : "",
      reviewerFlag: typeof args.reviewer === "string" ? args.reviewer : undefined,
      noteFlag: typeof args.note === "string" ? args.note : undefined,
      reviewPackFlag:
        typeof args["review-pack"] === "string" ? (args["review-pack"] as string) : undefined,
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
