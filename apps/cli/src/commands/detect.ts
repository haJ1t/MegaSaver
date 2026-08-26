import { type DetectionProbes, createNodeProbes, detectHarnesses } from "@megasaver/harness-detect";
import { defineCommand } from "citty";
import { resolveHomeDir } from "../store.js";
export type RunDetectInput = {
  home: string;
  cwd: string;
  platform: NodeJS.Platform;
  envPath: string;
  json: boolean;
  /** Injectable probes; defaults to createNodeProbes over home/cwd/PATH. */
  probes: DetectionProbes | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

const ID_COLUMN = 12;
const NAME_COLUMN = 26;
const CATEGORY_COLUMN = 9;

function formatSignal(signal: { kind: string; detail: string }): string {
  return `${signal.kind}:${signal.detail}`;
}

export async function runDetect(input: RunDetectInput): Promise<0 | 1> {
  const probes =
    input.probes ??
    createNodeProbes({
      home: input.home,
      projectRoot: input.cwd,
      platform: input.platform,
      envPath: input.envPath,
    });

  const detections = detectHarnesses({ probes });
  const detectedCount = detections.filter((d) => d.detected).length;

  if (input.json) {
    const records = detections.map((d) => ({
      id: d.id,
      name: d.name,
      category: d.category,
      detected: d.detected,
      signals: d.matchedSignals,
      target: d.effectiveTargetId,
    }));
    input.stdout(JSON.stringify(records));
    return 0;
  }

  for (const d of detections) {
    const signals =
      d.matchedSignals.length === 0 ? "-" : d.matchedSignals.map(formatSignal).join(";");
    const line = [
      d.id.padEnd(ID_COLUMN, " "),
      d.name.padEnd(NAME_COLUMN, " "),
      d.category.padEnd(CATEGORY_COLUMN, " "),
      d.detected ? "detected" : "absent",
      `signals=${signals}`,
      `target=${d.effectiveTargetId ?? "-"}`,
    ].join("  ");
    input.stdout(line);
  }
  input.stdout(`detected ${detectedCount} of ${detections.length} known harnesses`);
  return 0;
}

export const detectCommand = defineCommand({
  meta: {
    name: "detect",
    description: "Detect installed agent harnesses (PATH binaries, config dirs, project markers).",
  },
  args: {
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runDetect({
      home: resolveHomeDir(),
      cwd: process.cwd(),
      platform: process.platform,
      // biome-ignore lint/complexity/useLiteralKeys: tsconfig noPropertyAccessFromIndexSignature requires brackets
      envPath: process.env["PATH"] ?? "",
      json: !!args.json,
      probes: undefined,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});

export type RunHarnessAutoConfigureInput = {
  home: string;
  cwd: string;
  platform: NodeJS.Platform;
  envPath: string;
  /** Injectable probes; defaults to createNodeProbes over home/cwd/PATH. */
  probes: DetectionProbes | undefined;
  /** Resolves the registered project for cwd (null when unregistered). */
  resolveProject: () => Promise<{ name: string } | null>;
  /** Runs `mega connector sync <project> --target <id>` for one target. */
  syncTarget: (projectName: string, targetId: string) => Promise<0 | 1>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

// The init harness step seeds at most a handful of targets but each
// `runConnectorSync` call prints one line per KNOWN_TARGET (15 "skipped"
// noise lines per sync). The init wiring filters its stdout through this
// predicate: drop skipped-status lines, keep every meaningful status
// (created/wrote/noop/error) and every non-status line.
export function filterSyncLine(line: string): boolean {
  return !line.includes("  skipped  session=");
}

// The `mega init` harness step: detect installed harnesses, report them
// honestly, and seed the connector context block for every detected harness
// that maps to a Mega Saver target (deduped by target id — the AGENTS.md
// family folds onto the codex target). Never mutates anything beyond the
// standard sentinel block the connector sync writes.
export async function runHarnessAutoConfigure(input: RunHarnessAutoConfigureInput): Promise<0 | 1> {
  const probes =
    input.probes ??
    createNodeProbes({
      home: input.home,
      projectRoot: input.cwd,
      platform: input.platform,
      envPath: input.envPath,
    });

  const detections = detectHarnesses({ probes });
  const detected = detections.filter((d) => d.detected);

  if (detected.length === 0) {
    input.stdout("no harnesses detected — nothing to auto-configure.");
    return 0;
  }

  input.stdout(`harnesses detected: ${detected.length}`);
  for (const d of detected) {
    input.stdout(`  ${d.id}  ${d.name}  target=${d.effectiveTargetId ?? "-"}`);
  }

  const targetIds = [
    ...new Set(detected.map((d) => d.effectiveTargetId).filter((t): t is string => t !== null)),
  ];

  if (targetIds.length === 0) {
    input.stdout("auto-configure: no detected harness maps to a Mega Saver connector target.");
    return 0;
  }

  let project: { name: string } | null;
  try {
    project = await input.resolveProject();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    input.stderr(`error: harness auto-configure failed to resolve the project: ${detail}`);
    return 1;
  }

  if (project === null) {
    input.stdout(
      `auto-configure: no project registered for ${input.cwd} — skipped connector sync.`,
    );
    input.stdout("next: run `mega project create <name>` here, then `mega connector sync <name>`.");
    return 0;
  }

  input.stdout(
    `auto-configuring ${targetIds.length} connector target(s) for project "${project.name}"…`,
  );
  let failed = false;
  for (const targetId of targetIds) {
    const code = await input.syncTarget(project.name, targetId);
    if (code !== 0) failed = true;
  }
  return failed ? 1 : 0;
}
