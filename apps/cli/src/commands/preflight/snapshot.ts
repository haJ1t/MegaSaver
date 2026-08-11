import { mkdirSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { atomicWriteFile } from "@megasaver/content-store";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { defineCommand } from "citty";
import { mapErrorToCliMessage } from "../../errors.js";
import { captureGitState } from "../../preflight/git-capture.js";
import { buildPreflightSnapshot } from "../../preflight/snapshot.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { findProjectByCwd } from "../warmup.js";

export type RunPreflightSnapshotInput = {
  cwd: string;
  home: string;
  storeFlag: string | undefined;
  label: string | undefined;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  now: () => number;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runPreflightSnapshot(input: RunPreflightSnapshotInput): Promise<0 | 1> {
  let storeRoot: string;
  try {
    storeRoot = resolveStorePath({
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
    return cli.exitCode as 0 | 1;
  }

  try {
    const { registry } = await ensureStoreReady(storeRoot);
    const projects = registry.listProjects();
    let cwdReal = input.cwd;
    try {
      cwdReal = realpathSync(input.cwd);
    } catch {}
    const normalizedProjects = projects.map((p) => {
      try {
        return { ...p, rootPath: realpathSync(p.rootPath) };
      } catch {
        return p;
      }
    });
    const projectReal = findProjectByCwd(normalizedProjects as never, cwdReal);
    const project = projectReal ? (projects.find((p) => p.id === projectReal.id) ?? null) : null;
    if (!project) {
      input.stderr(`error: no registered project for this workspace; run mega project create`);
      return 1;
    }
    const workspaceKey = encodeWorkspaceKey(project.rootPath);
    const git = await captureGitState(project.rootPath, { timeoutMs: 2000 });
    const snapshot = buildPreflightSnapshot({
      git,
      workspaceKey,
      ...(project.id ? { projectId: project.id } : {}),
      ...(input.label ? { label: input.label } : {}),
      now: input.now,
    });

    // Write to project session dir: need a session id — use a synthetic id or project dir
    // Spec says content/<projectId>/<sessionId>/preflight-*.json for registry layout.
    // We don't have a live session id, so we write under content/<projectId>/__preflight__/
    // For compatibility with listPreflightSnapshots which expects projectId+sessionId,
    // we use a fixed session id "__preflight__" and also write to workspace overlay if possible.
    // Simpler: write to content/<projectId>/__preflight__/preflight-*.json and also to
    // content/<workspaceKey>/__preflight__/ for overlay scans. Use atomicWriteFile.

    const snapshotJson = `${JSON.stringify(snapshot, null, 2)}\n`;
    const fileName = `${snapshot.snapshotId}.json`;

    // Primary: project-scoped
    const primaryPath = join(storeRoot, "content", project.id, "__preflight__", fileName);
    mkdirSync(dirname(primaryPath), { recursive: true });
    atomicWriteFile(primaryPath, snapshotJson);

    // Secondary: workspace-scoped for overlay scans
    try {
      const overlayPath = join(storeRoot, "content", workspaceKey, "__preflight__", fileName);
      mkdirSync(dirname(overlayPath), { recursive: true });
      atomicWriteFile(overlayPath, snapshotJson);
    } catch {
      // overlay is best-effort
    }

    input.stdout(
      `snapshot ${snapshot.snapshotId} (${snapshot.counters?.staged ?? 0} staged, ${snapshot.counters?.unstaged ?? 0} unstaged, ${snapshot.counters?.untracked ?? 0} untracked)`,
    );
    if (input.label) input.stdout(`label: ${input.label}`);
    input.stdout(primaryPath);
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode as 0 | 1;
  }
}

export const preflightSnapshotCommand = defineCommand({
  meta: { name: "snapshot", description: "Capture a workspace preflight snapshot." },
  args: {
    label: { type: "string", description: "Optional label for the snapshot." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const env = readStoreEnv(typeof args.store === "string" ? args.store : undefined);
    const code = await runPreflightSnapshot({
      ...env,
      label: typeof args.label === "string" ? args.label : undefined,
      now: () => Date.now(),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
