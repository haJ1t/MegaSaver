import { defineCommand } from "citty";
import { CONSUMERS } from "./manifest.ts";
import type { Mode } from "./manifest.ts";
import { runSync } from "./sync.ts";

export type RunOptions = {
  readonly repoRoot: string;
  readonly write: boolean;
  readonly fix: boolean;
  readonly check: boolean;
  readonly list: boolean;
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
};

export type RunOutcome = { readonly exitCode: number };

export async function runOnce(opts: RunOptions): Promise<RunOutcome> {
  const flags = [opts.check, opts.write || opts.fix, opts.list].filter(Boolean).length;
  if (flags > 1) {
    opts.stderr("error: --check, --write/--fix, and --list are mutually exclusive");
    return { exitCode: 2 };
  }
  const mode: Mode = opts.list ? "list" : opts.write || opts.fix ? "write" : "check";

  if (mode === "list") {
    opts.stdout("conventions:sync manifest:");
    for (const c of CONSUMERS) {
      opts.stdout(`  ${c.id}  ->  ${c.path}`);
      for (const b of c.blocks) {
        const fragment = "fragment" in b ? (b as { fragment?: string }).fragment : undefined;
        const frag = fragment === undefined ? "" : `#${fragment}`;
        opts.stdout(`    block "${b.id}" <- docs/conventions/${b.source}${frag}`);
      }
    }
    return { exitCode: 0 };
  }

  const result = await runSync({
    mode,
    repoRoot: opts.repoRoot,
    conventionsDir: `${opts.repoRoot}/docs/conventions`,
    consumers: CONSUMERS,
  });

  let drift = 0;
  let errors = 0;
  let wrote = 0;
  for (const r of result.reports) {
    if (r.status === "ok") {
      opts.stdout(`ok      ${r.path}`);
    } else if (r.status === "wrote") {
      opts.stdout(`wrote   ${r.path}`);
      wrote += 1;
    } else if (r.status === "drift") {
      opts.stdout(`drift   ${r.path}`);
      opts.stdout(r.diff);
      drift += 1;
    } else if (r.status === "error") {
      opts.stderr(`error   ${r.path}: ${r.error?.message ?? "unknown"}`);
      errors += 1;
    }
  }

  if (errors > 0) {
    opts.stderr(`conventions:sync failed: ${errors} error(s)`);
    return { exitCode: 1 };
  }
  if (mode === "check" && drift > 0) {
    opts.stderr(`conventions:sync drift: ${drift} file(s) differ from canonical source`);
    opts.stderr("run `pnpm conventions:sync --write` to bring them into sync");
    return { exitCode: 1 };
  }
  if (mode === "write" && wrote > 0) {
    opts.stdout(`conventions:sync wrote ${wrote} file(s)`);
  }
  return { exitCode: 0 };
}

export const conventionsSyncCommand = defineCommand({
  meta: {
    name: "conventions-sync",
    description: "Sync agent-config files from docs/conventions/ canonical source.",
  },
  args: {
    check: { type: "boolean", description: "Exit non-zero if any consumer drifts (default)." },
    write: { type: "boolean", description: "Write canonical content into every consumer block." },
    fix: { type: "boolean", description: "Alias of --write." },
    list: { type: "boolean", description: "Print the consumer manifest and exit." },
    root: { type: "string", description: "Repository root (default: cwd)." },
  },
  async run({ args }) {
    const outcome = await runOnce({
      repoRoot: typeof args.root === "string" && args.root.length > 0 ? args.root : process.cwd(),
      check: args.check === true,
      write: args.write === true,
      fix: args.fix === true,
      list: args.list === true,
      stdout: (line) => process.stdout.write(`${line}\n`),
      stderr: (line) => process.stderr.write(`${line}\n`),
    });
    process.exitCode = outcome.exitCode;
  },
});
