import { loadFenceFile, locateFenceRoot } from "@megasaver/fence";
import { defineCommand } from "citty";

export type RunFenceStatusInput = {
  cwd: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runFenceStatus(
  input: RunFenceStatusInput,
): Promise<0 | 1> {
  const fenceRoot = locateFenceRoot(input.cwd);
  if (fenceRoot === null) {
    input.stdout("no fence.yaml found (fence is disabled)");
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
    input.stdout("no fence.yaml found (fence is disabled)");
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

  input.stdout(`fence root: ${fenceRoot}`);
  input.stdout(`allow entries: ${file.allow.length}`);
  input.stdout(
    `total entries: ${file.entries.length} (warn: ${warnCount}, deny: ${denyCount})`,
  );
  for (const [cls, count] of classCounts) {
    input.stdout(`  - ${cls}: ${count}`);
  }

  return 0;
}

export const fenceStatusCommand = defineCommand({
  meta: {
    name: "status",
    description: "Display fence status and summary statistics",
  },
  async run() {
    const code = await runFenceStatus({
      cwd: process.cwd(),
      stdout: (l) => console.log(l),
      stderr: (l) => console.error(l),
    });
    if (code !== 0) process.exit(code);
  },
});
