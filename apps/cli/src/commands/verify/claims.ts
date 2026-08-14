import { readFile } from "node:fs/promises";
import { readEvents } from "@megasaver/core";
import { sessionIdSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import {
  type CliMessage,
  claimsInputRequiredMessage,
  claimsInputTooLargeMessage,
  fileReadFailedMessage,
  invalidWindowMessage,
  mapErrorToCliMessage,
  sessionNotFoundMessage,
  strictRequiresSessionMessage,
} from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { MAX_CLAIMS_INPUT_BYTES, scanClaims } from "./claim-patterns.js";
import { type VerifiedClaim, joinClaimsToReceipts } from "./join.js";
import { type ReceiptExit, receiptsFromEvents } from "./receipts.js";

export const DEFAULT_WINDOW_MINUTES = 30;

export type RunVerifyClaimsInput = {
  sessionFlag: string | undefined;
  fileFlag: string | undefined;
  windowFlag: string | undefined;
  strict: boolean;
  json: boolean;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdinIsTty: boolean;
  readStdin: () => Promise<string>;
  now?: () => string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

function renderExit(exit: ReceiptExit): string {
  switch (exit.kind) {
    case "code":
      return `exit ${exit.code}`;
    case "terminated":
      return "terminated";
    case "unrecorded":
      return "exit unrecorded";
  }
}

export function formatClaimLines(rows: readonly VerifiedClaim[]): string[] {
  const lines: string[] = [];
  for (const row of rows) {
    lines.push(
      `${row.verdict.toUpperCase().padEnd(16)}${row.claim.patternId.padEnd(15)}"${row.claim.excerpt}"`,
    );
    if (row.receipt !== undefined) {
      lines.push(
        `    receipt: ${row.receipt.command}  ${renderExit(row.receipt.exit)}  ${row.receipt.recordedAt}`,
      );
    }
  }
  return lines;
}

export async function runVerifyClaims(input: RunVerifyClaimsInput): Promise<0 | 1> {
  const fail = (cli: CliMessage): 1 => {
    input.stderr(cli.message);
    return cli.exitCode;
  };

  if (input.strict && input.sessionFlag === undefined) {
    return fail(strictRequiresSessionMessage());
  }

  let windowMinutes = DEFAULT_WINDOW_MINUTES;
  if (input.windowFlag !== undefined) {
    const parsed = Number(input.windowFlag);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1440) {
      return fail(invalidWindowMessage(input.windowFlag));
    }
    windowMinutes = parsed;
  }

  let text: string;
  if (input.fileFlag !== undefined) {
    try {
      text = await readFile(input.fileFlag, "utf8");
    } catch (err) {
      return fail(fileReadFailedMessage(err instanceof Error ? err.message : String(err)));
    }
  } else if (!input.stdinIsTty) {
    text = await input.readStdin();
  } else {
    return fail(claimsInputRequiredMessage());
  }
  if (Buffer.byteLength(text, "utf8") > MAX_CLAIMS_INPUT_BYTES) {
    return fail(claimsInputTooLargeMessage(MAX_CLAIMS_INPUT_BYTES));
  }

  const claims = scanClaims(text);

  if (input.sessionFlag === undefined) {
    // Detection-only (spec Locked Decision 4): claims listed, no verdicts.
    if (input.json) {
      input.stdout(
        JSON.stringify({ sessionId: null, windowMinutes: null, claims, receiptsConsidered: [] }),
      );
    } else {
      input.stdout(`claims: ${claims.length} (detection only — no --session)`);
      for (const claim of claims) {
        input.stdout(`  ${claim.patternId.padEnd(15)}"${claim.excerpt}"`);
      }
    }
    return 0;
  }

  let rootDir: string;
  try {
    rootDir = resolveStorePath(input);
  } catch (err) {
    return fail(mapErrorToCliMessage(err, { kind: "store" }));
  }

  let sessionId: ReturnType<typeof sessionIdSchema.parse>;
  try {
    sessionId = sessionIdSchema.parse(input.sessionFlag);
  } catch (err) {
    return fail(mapErrorToCliMessage(err, { kind: "sessionId" }));
  }

  try {
    const { registry } = await ensureStoreReady(rootDir);
    const session = registry.getSession(sessionId);
    if (session === null) return fail(sessionNotFoundMessage(sessionId));

    const events = readEvents({ root: rootDir }, session.projectId, sessionId);
    const receipts = receiptsFromEvents(events);
    const now = (input.now ?? (() => new Date().toISOString()))();
    const { rows, considered } = joinClaimsToReceipts({ claims, receipts, now, windowMinutes });

    if (input.json) {
      input.stdout(
        JSON.stringify({
          sessionId,
          windowMinutes,
          claims: rows.map(({ claim, verdict, receipt }) => ({
            ...claim,
            verdict,
            receipt: receipt ?? null,
          })),
          receiptsConsidered: considered,
        }),
      );
    } else if (rows.length === 0) {
      input.stdout("no claims detected");
    } else {
      input.stdout(`claims: ${rows.length}  receipts in window: ${considered.length}`);
      for (const line of formatClaimLines(rows)) input.stdout(line);
    }

    // Documented JSON-policy exception (connector-status precedent): the report
    // is already printed; --strict only flips the exit code on missing or
    // contradicting evidence.
    const gateFails = rows.some(
      (row) => row.verdict === "no-receipt" || row.verdict === "exit-mismatch",
    );
    return input.strict && gateFails ? 1 : 0;
  } catch (err) {
    return fail(mapErrorToCliMessage(err));
  }
}

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export const verifyClaimsCommand = defineCommand({
  meta: {
    name: "claims",
    description: "Scan text for success claims and join them to exec receipts.",
  },
  args: {
    session: { type: "string", description: "Session id (UUID) whose receipts to join." },
    file: { type: "string", description: "Read the text from a file instead of stdin." },
    window: { type: "string", description: "Receipt window in minutes (1..1440, default 30)." },
    strict: {
      type: "boolean",
      default: false,
      description: "Exit 1 on any no-receipt or exit-mismatch verdict.",
    },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runVerifyClaims({
      sessionFlag: typeof args.session === "string" ? args.session : undefined,
      fileFlag: typeof args.file === "string" ? args.file : undefined,
      windowFlag: typeof args.window === "string" ? args.window : undefined,
      strict: !!args.strict,
      json: !!args.json,
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdinIsTty: process.stdin.isTTY === true,
      readStdin: readAllStdin,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
