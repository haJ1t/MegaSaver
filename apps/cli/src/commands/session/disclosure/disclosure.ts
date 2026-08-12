import { readFileSync, statSync } from "node:fs";
import { sessionIdSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import {
  disclosureInputTooLargeMessage,
  disclosureInputUnreadableMessage,
  disclosureReceiptNotFoundMessage,
  mapErrorToCliMessage,
  notAGitRepoMessage,
  sessionNotFoundMessage,
} from "../../../errors.js";
import type { ExecGit } from "../../../git-delta.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../../store.js";
import { readTestEnv } from "../shared.js";
import { normalizeClaimedPath } from "./normalize.js";
import { observeTreeDelta } from "./observe.js";
import { MAX_DISCLOSURE_INPUT_BYTES, extractClaimedPaths } from "./path-claims.js";
import {
  type DisclosureReceipt,
  readDisclosureReceipt,
  writeDisclosureReceipt,
} from "./receipt-store.js";
import { reconcileDisclosure } from "./reconcile.js";

export type RunSessionDisclosureInput = {
  sessionId: string;
  textFile: string | undefined;
  json: boolean;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  execGit?: ExecGit;
  now?: () => string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runSessionDisclosure(input: RunSessionDisclosureInput): Promise<0 | 1> {
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

  let id: ReturnType<typeof sessionIdSchema.parse>;
  try {
    id = sessionIdSchema.parse(input.sessionId);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "sessionId" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    const session = registry.getSession(id);
    if (!session) {
      const cli = sessionNotFoundMessage(id);
      input.stderr(cli.message);
      return cli.exitCode;
    }

    // Report mode: no textFile → re-print persisted receipt
    if (input.textFile === undefined) {
      const receipt = readDisclosureReceipt(rootDir, id);
      if (!receipt) {
        const cli = disclosureReceiptNotFoundMessage(id);
        input.stderr(cli.message);
        return cli.exitCode;
      }
      if (input.json) {
        input.stdout(JSON.stringify(receipt, null, 2));
      } else {
        renderReceipt(receipt, input.stdout);
      }
      return 0;
    }

    // Compute mode: read and cap input file
    let statSize: number;
    try {
      const stat = statSync(input.textFile);
      statSize = stat.size;
    } catch {
      const cli = disclosureInputUnreadableMessage(input.textFile);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    if (statSize > MAX_DISCLOSURE_INPUT_BYTES) {
      const cli = disclosureInputTooLargeMessage();
      input.stderr(cli.message);
      return cli.exitCode;
    }

    let text: string;
    try {
      text = readFileSync(input.textFile, "utf8");
    } catch {
      const cli = disclosureInputUnreadableMessage(input.textFile);
      input.stderr(cli.message);
      return cli.exitCode;
    }

    const candidates = extractClaimedPaths(text);
    const claimed: string[] = [];
    let dropped = 0;
    for (const candidate of candidates) {
      const normalized = normalizeClaimedPath(candidate.path, input.cwd);
      if (normalized === null) dropped += 1;
      else claimed.push(normalized);
    }

    const delta =
      input.execGit === undefined
        ? observeTreeDelta({
            cwd: input.cwd,
            startedAt: session.startedAt,
            endedAt: session.endedAt,
          })
        : observeTreeDelta({
            cwd: input.cwd,
            startedAt: session.startedAt,
            endedAt: session.endedAt,
            execGit: input.execGit,
          });
    if (delta === null) {
      const cli = notAGitRepoMessage();
      input.stderr(cli.message);
      return cli.exitCode;
    }

    const report = reconcileDisclosure({ claimed, observed: delta.paths });
    const generatedAt =
      readTestEnv("MEGA_TEST_NOW") ?? (input.now ? input.now() : new Date().toISOString());
    const receipt: DisclosureReceipt = {
      sessionId: id,
      generatedAt,
      claimed: report.claimed,
      observed: report.observed,
      undisclosed: report.undisclosed,
      phantom: report.phantom,
      droppedCandidates: dropped,
      inputBytes: statSize,
    };
    writeDisclosureReceipt(rootDir, receipt);

    if (input.json) {
      input.stdout(JSON.stringify(receipt, null, 2));
    } else {
      renderReceipt(receipt, input.stdout);
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "session", id });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

function renderReceipt(receipt: DisclosureReceipt, stdout: (line: string) => void): void {
  stdout(`session ${receipt.sessionId} disclosure (${receipt.generatedAt})`);
  stdout(
    `  claimed ${receipt.claimed.length} / observed ${receipt.observed.length} / dropped ${receipt.droppedCandidates}`,
  );
  stdout(`  undisclosed (touched, never mentioned): ${receipt.undisclosed.length}`);
  for (const p of receipt.undisclosed) stdout(`    ${p}`);
  stdout(`  phantom (mentioned, untouched): ${receipt.phantom.length}`);
  for (const p of receipt.phantom) stdout(`    ${p}`);
}

export const sessionDisclosureCommand = defineCommand({
  meta: {
    name: "disclosure",
    description: "Reconcile a session's FILE-CHANGE narrative against the observed git delta.",
  },
  args: {
    sessionId: {
      type: "positional",
      required: true,
      description: "Session id (UUID).",
    },
    "text-file": { type: "string", description: "Path to narrative text file." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const code = await runSessionDisclosure({
      sessionId: typeof args.sessionId === "string" ? args.sessionId : "",
      textFile: typeof args["text-file"] === "string" ? (args["text-file"] as string) : undefined,
      json: !!args.json,
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
