import { spawn as nodeSpawn } from "node:child_process";
import type { KeyObject } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  type LoadProjectPermissions,
  loadProjectPermissions,
  runChild,
} from "@megasaver/context-gate";
import { checkEntitlement } from "@megasaver/entitlement";
import { classifyOutput, filterOutput, isConfidentClassification } from "@megasaver/output-filter";
import {
  type EvaluateCommandResult,
  type ProjectPermissions,
  evaluateCommand,
} from "@megasaver/policy";
import {
  type ProjectId,
  type TokenSaverMode,
  modeToBudget,
  tokenSaverModeSchema,
} from "@megasaver/shared";
import { defineCommand } from "citty";
import { commandDeniedMessage } from "../errors.js";
import { readStoreEnv, resolveStorePath } from "../store.js";
import { PRO_ANALYTICS_URL } from "./savings/index.js";

// bench-specific upsell (shared strings would misname the feature).
export const BENCH_UPSELL = `The paired benchmark is a Mega Saver Pro feature. Activate a key: mega license activate <key>. Learn more: ${PRO_ANALYTICS_URL}.`;

// Same bounds as `mega output exec` (spec: bench never exceeds exec's powers).
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_BYTES = 20_000_000;

export type BenchPassResult = {
  exitCode: number | null;
  wallMs: number;
  output: string;
};

export type BenchPassRunner = (opts: {
  command: string;
  args: readonly string[];
  cwd: string;
  originPid: string;
}) => Promise<BenchPassResult>;

export function defaultBenchPassRunner(): BenchPassRunner {
  return async (opts) => {
    const started = performance.now();
    const outcome = await runChild({
      spawn: nodeSpawn,
      command: opts.command,
      args: opts.args,
      cwd: opts.cwd,
      originPid: opts.originPid,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxBytes: DEFAULT_MAX_BYTES,
    });
    const wallMs = performance.now() - started;
    if (!outcome.ok) return { exitCode: null, wallMs, output: "" };
    // A bound-killed capture (timeout/max_bytes) surfaces as childExitCode
    // null — the engine's incomplete-pass handling covers it generically.
    return {
      exitCode: outcome.capture.childExitCode,
      wallMs,
      output: outcome.capture.raw,
    };
  };
}

export type BenchEvaluate = (input: {
  command: string;
  args: readonly string[];
  originPid: string;
}) => EvaluateCommandResult;

export function defaultBenchEvaluate(
  cwd: string,
  loadPermissions: LoadProjectPermissions = loadProjectPermissions,
): BenchEvaluate {
  // Mirrors run-command.ts's gate: tighten-only project permissions plus the
  // global allow-list; the recursive_megasaver conjunct rides on originPid.
  // Lazy + memoized: policy IO happens on the FIRST evaluate, never at
  // construction — the free path must reach the upsell without touching
  // permissions.yaml. A throwing loader (present-but-malformed yaml) fails
  // closed as policy_load_failed — the same PolicyDenyCode exec surfaces on
  // its command_denied line (exec.ts maps it identically).
  let loaded: { permissions: ProjectPermissions | null } | "load_failed" | undefined;
  return ({ command, args, originPid }) => {
    if (loaded === undefined) {
      try {
        loaded = { permissions: loadPermissions(cwd) };
      } catch {
        loaded = "load_failed";
      }
    }
    if (loaded === "load_failed") return { allowed: false, reason: "policy_load_failed" };
    return evaluateCommand({
      command,
      args,
      project: "bench" as unknown as ProjectId,
      env: { MEGASAVER_ORIGIN_PID: originPid },
      ...(loaded.permissions !== null ? { permissions: loaded.permissions } : {}),
    });
  };
}

export type RunBenchInput = {
  storeRoot: string;
  now: () => number;
  publicKey?: KeyObject | string;
  command: string;
  commandArgs: readonly string[];
  cwd: string;
  originPid: string;
  evaluate: BenchEvaluate;
  runPass: BenchPassRunner;
  mode: TokenSaverMode;
  md?: string;
  force?: boolean;
  assert?: boolean;
  json?: boolean;
  writeFile: (path: string, content: string) => void;
  fileExists: (path: string) => boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

function signalOf(command: string, args: readonly string[], text: string): string | null {
  const c = classifyOutput({ command: [command, ...args].join(" "), text });
  return isConfidentClassification(c) ? c.category : null;
}

export async function runBench(input: RunBenchInput): Promise<0 | 1> {
  // Entitlement FIRST: the free path evaluates no policy, spawns nothing,
  // writes nothing (spy-enforced).
  const ent = checkEntitlement("savings-analytics", {
    storeRoot: input.storeRoot,
    now: input.now,
    ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
  });
  if (!ent.entitled) {
    input.stdout(BENCH_UPSELL);
    return 0;
  }

  if (input.command === "") {
    input.stderr("usage: mega bench [flags] -- <command> [args...]");
    return 1;
  }

  // Policy gate BEFORE any spawn — bench can never run what exec couldn't.
  const verdict = input.evaluate({
    command: input.command,
    args: input.commandArgs,
    originPid: input.originPid,
  });
  if (!verdict.allowed) {
    input.stderr(commandDeniedMessage(verdict.reason).message);
    return 1;
  }

  const { composeBenchReport, renderBenchMarkdown } = await import("@megasaver/pro-analytics");

  // Fixed order: raw first, then saver (disclosed in the report).
  const rawRun = await input.runPass({
    command: input.command,
    args: input.commandArgs,
    cwd: input.cwd,
    originPid: input.originPid,
  });
  const saverRun = await input.runPass({
    command: input.command,
    args: input.commandArgs,
    cwd: input.cwd,
    originPid: input.originPid,
  });

  // The saver pass filters its capture (unpersisted; recordTrace off — bench
  // must write NOTHING), timed as part of the pass.
  const filterStart = performance.now();
  const filtered = await filterOutput({
    raw: saverRun.output,
    intent: "bench parity check",
    mode: input.mode,
    maxReturnedBytes: modeToBudget(input.mode),
    source: { kind: "command", command: input.command, args: [...input.commandArgs] },
    engineRanking: false,
    recordTrace: false,
  });
  const filterMs = performance.now() - filterStart;
  const rawBytesSaver = Buffer.byteLength(saverRun.output, "utf8");
  // Step-1: FilterOutputResult carries the measured returned size directly, so
  // use `returnedBytes` rather than deriving it from savingRatio (the plan's
  // documented fallback) — the field is exact and never clamp-distorted.
  const returnedBytes = filtered.returnedBytes;

  const report = composeBenchReport(
    [input.command, ...input.commandArgs].join(" "),
    {
      kind: "raw",
      exitCode: rawRun.exitCode,
      wallMs: rawRun.wallMs,
      rawBytes: Buffer.byteLength(rawRun.output, "utf8"),
      returnedBytes: null,
      savingRatio: null,
      signal: signalOf(input.command, input.commandArgs, rawRun.output),
    },
    {
      kind: "saver",
      exitCode: saverRun.exitCode,
      wallMs: saverRun.wallMs + filterMs,
      rawBytes: rawBytesSaver,
      returnedBytes,
      savingRatio: filtered.savingRatio,
      signal: signalOf(input.command, input.commandArgs, saverRun.output),
    },
  );

  if (input.json) {
    input.stdout(JSON.stringify(report));
  } else {
    input.stdout(`bench: ${report.command} · mode ${input.mode} · raw first, then saver`);
    input.stdout(
      `tokens: raw ${report.tokensRaw} → returned ${report.tokensReturned} · saved ${report.tokensSaved} ($${report.dollarsSaved.toFixed(2)} (est.))`,
    );
    if (report.savingsNote !== null) input.stdout(`note: ${report.savingsNote}`);
    input.stdout(
      `time: raw ${Math.round(report.raw.wallMs)}ms · saver ${Math.round(report.saver.wallMs)}ms · overhead ${Math.round(report.overheadMs)}ms`,
    );
    input.stdout(
      `parity: ${report.parity.ok ? "PARITY OK" : "PARITY NOT CONFIRMED"} (exit ${report.raw.exitCode} vs ${report.saver.exitCode}, signal ${report.raw.signal ?? "unknown"} vs ${report.saver.signal ?? "unknown"})`,
    );
    if (report.parity.note !== null) input.stdout(`note: ${report.parity.note}`);
  }

  if (input.md !== undefined) {
    const mdPath = resolve(input.cwd, input.md);
    if (input.fileExists(mdPath) && input.force !== true) {
      input.stderr(`refusing to overwrite ${mdPath} (use --force)`);
      return 1;
    }
    input.writeFile(mdPath, renderBenchMarkdown(report));
    // Under --json, stdout is a single JSON document — confirmations go to
    // stderr so machine consumers can parse stdout verbatim.
    (input.json ? input.stderr : input.stdout)(`wrote ${mdPath}`);
  }

  if (input.assert === true && !report.parity.ok) return 1;
  return 0;
}

export const benchCommand = defineCommand({
  meta: {
    name: "bench",
    description:
      "Run a command twice — raw and through the saver — and report tokens, time, and outcome parity (Mega Saver Pro).",
  },
  args: {
    mode: {
      type: "string",
      description:
        "Saver mode for the filtered pass: safe | balanced | aggressive (default: balanced).",
    },
    md: { type: "string", description: "Write a shareable markdown report to this file." },
    force: { type: "boolean", default: false, description: "Overwrite an existing --md file." },
    assert: {
      type: "boolean",
      default: false,
      description: "Exit 1 when outcome parity is broken (CI gate).",
    },
    json: { type: "boolean", default: false, description: "Emit the report as JSON." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const storeInput = readStoreEnv(typeof args.store === "string" ? args.store : undefined);
    const cwd = process.cwd();
    const positionals = (args._ ?? []).map(String);
    const mode = tokenSaverModeSchema.safeParse(args.mode ?? "balanced");
    if (!mode.success) {
      console.error(
        `error: invalid mode "${String(args.mode)}" (${tokenSaverModeSchema.options.join(" | ")})`,
      );
      process.exitCode = 1;
      return;
    }
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    const originPid = process.env["MEGASAVER_ORIGIN_PID"] ?? String(process.pid);
    const code = await runBench({
      storeRoot: resolveStorePath(storeInput),
      now: () => Date.now(),
      command: positionals[0] ?? "",
      commandArgs: positionals.slice(1),
      cwd,
      originPid,
      evaluate: defaultBenchEvaluate(cwd),
      runPass: defaultBenchPassRunner(),
      mode: mode.data,
      ...(typeof args.md === "string" ? { md: args.md } : {}),
      force: !!args.force,
      assert: !!args.assert,
      json: !!args.json,
      writeFile: (p, c) => writeFileSync(p, c),
      fileExists: (p) => existsSync(p),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
