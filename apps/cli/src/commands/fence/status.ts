import { loadFenceFile, locateFenceRoot } from "@megasaver/fence";
import { defineCommand } from "citty";

export type RunFenceStatusInput = {
  cwd: string;
  json?: boolean | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runFenceStatus(input: RunFenceStatusInput): Promise<0 | 1> {
  const fenceRoot = locateFenceRoot(input.cwd);
  if (fenceRoot === null) {
    if (input.json) {
      input.stdout(JSON.stringify({ disabled: true }));
    } else {
      input.stdout("no fence.yaml found (fence is disabled)");
    }
    return 0;
  }

  let file: ReturnType<typeof loadFenceFile>;
  try {
    file = loadFenceFile(fenceRoot);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    input.stderr(`fence.yaml is invalid: ${message}`);
    return 1;
  }

  if (file === null) {
    if (input.json) {
      input.stdout(JSON.stringify({ disabled: true }));
    } else {
      input.stdout("no fence.yaml found (fence is disabled)");
    }
    return 0;
  }

  const classCounts = new Map<string, number>();
  let warnCount = 0;
  let denyCount = 0;
  for (const entry of file.entries) {
    classCounts.set(entry.class, (classCounts.get(entry.class) ?? 0) + 1);
    if (entry.mode === "deny") {
      denyCount += 1;
    } else {
      warnCount += 1;
    }
  }

  if (input.json) {
    input.stdout(
      JSON.stringify({
        disabled: false,
        root: fenceRoot,
        allowCount: file.allow.length,
        totalEntries: file.entries.length,
        warnCount,
        denyCount,
        classCounts: Object.fromEntries(classCounts),
      }),
    );
    return 0;
  }

  input.stdout(`fence root: ${fenceRoot}`);
  input.stdout(`allow entries: ${file.allow.length}`);
  input.stdout(`total entries: ${file.entries.length} (warn: ${warnCount}, deny: ${denyCount})`);
  for (const [cls, count] of classCounts) {
    input.stdout(`  - ${cls}: ${count}`);
  }

  return 0;
}

export const fenceStatusCommand = defineCommand({
  meta: {
    name: "status",
    description: "Display fence status and summary statistics.",
  },
  args: {
    json: {
      type: "boolean",
      description: "Emit JSON output.",
      default: false,
    },
  },
  async run({ args }) {
    const code = await runFenceStatus({
      cwd: process.cwd(),
      json: Boolean(args.json),
      stdout: (l) => console.log(l),
      stderr: (l) => console.error(l),
    });
    if (code !== 0) process.exit(code);
  },
});
