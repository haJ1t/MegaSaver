import type { TokenSaverMode } from "@megasaver/shared";
import type { UpDetectedState } from "./detect.js";
import { type UpManifest, readUpManifest, writeUpManifest } from "./manifest.js";
import type { UpAction, UpPlan } from "./plan.js";

export type UpApplyDeps = {
  hooksInstall: () => 0 | 1;
  ensureProject: () => Promise<{ code: 0 | 1; name: string; created: boolean }>;
  connectorSync: (projectName: string) => Promise<0 | 1>;
  saverEnable: () => Promise<0 | 1>;
  now: () => string;
};

export type UpApplyResult = {
  code: 0 | 1;
  failedStep?: "hooks-install" | "connector-sync" | "saver-enable";
};

function freshManifest(input: {
  workspaceKey: string;
  cwd: string;
  now: string;
}): UpManifest {
  return {
    version: 1,
    workspaceKey: input.workspaceKey,
    cwd: input.cwd,
    createdAt: input.now,
    updatedAt: input.now,
    steps: [],
  };
}

export async function runUpApply(input: {
  plan: UpPlan;
  state: UpDetectedState;
  storeRoot: string;
  workspaceKey: string;
  cwd: string;
  mode: TokenSaverMode;
  exact: boolean;
  deps: UpApplyDeps;
}): Promise<UpApplyResult> {
  const read = readUpManifest(input.storeRoot, input.workspaceKey);
  if (read.kind === "corrupt") return { code: 1 };

  const nowStr = input.deps.now();
  let manifest =
    read.kind === "ok"
      ? read.manifest
      : freshManifest({
          workspaceKey: input.workspaceKey,
          cwd: input.cwd,
          now: nowStr,
        });

  const stepsToRun: Array<{
    key: "hooks-install" | "connector-sync" | "saver-enable";
    action: UpAction;
    run: () => Promise<0 | 1>;
    createStep: (res: {
      projectName?: string;
      projectCreated?: boolean;
    }) => UpManifest["steps"][number];
  }> = [
    {
      key: "hooks-install",
      action: input.plan.hooks.action,
      run: async () => input.deps.hooksInstall(),
      createStep: () => ({
        kind: "hooks-install" as const,
        at: input.deps.now(),
        settingsPath: input.state.settingsPath,
        priorConnected:
          input.state.hooks.kind === "readable" ? input.state.hooks.priorConnected : false,
        changed: input.state.hooks.kind === "readable" ? input.state.hooks.changed : true,
      }),
    },
    {
      key: "connector-sync",
      action: input.plan.connector.action,
      run: async () => {
        const proj = await input.deps.ensureProject();
        if (proj.code !== 0) return 1;
        const syncRes = await input.deps.connectorSync(proj.name);
        if (syncRes !== 0) return 1;
        // stash to pass to createStep
        (thisRunner as { projectName: string; projectCreated: boolean }).projectName = proj.name;
        (thisRunner as { projectName: string; projectCreated: boolean }).projectCreated =
          proj.created;
        return 0;
      },
      createStep: () => {
        const info = thisRunner as { projectName?: string; projectCreated?: boolean };
        return {
          kind: "connector-sync" as const,
          at: input.deps.now(),
          projectName: info.projectName ?? "project",
          projectCreated: info.projectCreated ?? false,
          targets: input.state.targets.map((t) => ({
            id: t.id,
            relativePath: t.relativePath,
            prior: t.prior,
          })),
        };
      },
    },
    {
      key: "saver-enable",
      action: input.plan.saver.action,
      run: async () => input.deps.saverEnable(),
      createStep: () => ({
        kind: "saver-enable" as const,
        at: input.deps.now(),
        exact: input.exact,
        priorEnabled: input.state.saver.enabled,
        priorMode: input.state.saver.mode,
        mode: input.mode,
      }),
    },
  ];

  const thisRunner: { projectName?: string; projectCreated?: boolean } = {};

  for (const s of stepsToRun) {
    if (s.action !== "install" && s.action !== "repair") continue;

    let code: 0 | 1;
    try {
      code = await s.run();
    } catch {
      code = 1;
    }

    if (code !== 0) {
      writeUpManifest(input.storeRoot, manifest);
      return { code: 1, failedStep: s.key };
    }

    const recordedStep = s.createStep(thisRunner);
    manifest = {
      ...manifest,
      updatedAt: input.deps.now(),
      steps: [...manifest.steps, recordedStep],
    };

    if (!writeUpManifest(input.storeRoot, manifest)) {
      return { code: 1, failedStep: s.key };
    }
  }

  return { code: 0 };
}
