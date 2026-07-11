import { type KeyObject, randomUUID } from "node:crypto";
import {
  type BrainSyncConfig,
  type SyncDeps,
  createTransport,
  keyfilePath,
  loadConfig,
  loadKeyfile,
  updateLastSeen,
} from "@megasaver/brain-sync";
import { checkEntitlement } from "@megasaver/entitlement";
import { projectNotFoundMessage } from "../../../errors.js";
import type { EnsureStoreReadyResult } from "../../../store.js";
import { PRO_ANALYTICS_URL } from "../../savings/index.js";

export const BRAIN_SYNC_UPSELL = `Brain sync is a Mega Saver Pro feature. Activate a key: mega license activate <key>. Learn more: ${PRO_ANALYTICS_URL}.`;

export type BrainSyncCommonInput = {
  storeRoot: string;
  now: () => number;
  publicKey?: KeyObject | string;
  ensureStore: () => Promise<EnsureStoreReadyResult>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export function gate(input: BrainSyncCommonInput): boolean {
  const ent = checkEntitlement("brain-portability", {
    storeRoot: input.storeRoot,
    now: input.now,
    ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
  });
  if (!ent.entitled) {
    input.stdout(BRAIN_SYNC_UPSELL);
    return false;
  }
  return true;
}

export type ProjectSyncContext = { deps: SyncDeps; config: BrainSyncConfig };

// Resolves the project by name, loads config+keyfile, builds a per-project
// transport (prefix scoped by project id) and the SyncDeps that bridge core's
// export/import into the sync engine. Returns null after writing a stderr
// message (caller returns 1). Throws BrainSyncError for config/keyfile problems
// (the caller maps it to a single-line `error: …`).
export async function buildProjectSyncContext(
  input: BrainSyncCommonInput & { projectName: string },
): Promise<ProjectSyncContext | null> {
  const { registry } = await input.ensureStore();
  const project = registry.listProjects().find((p) => p.name === input.projectName);
  if (project === undefined) {
    input.stderr(projectNotFoundMessage(input.projectName).message);
    return null;
  }
  const projectId = project.id;
  const config = loadConfig(input.storeRoot);
  const key = loadKeyfile(keyfilePath(input.storeRoot));
  const { exportBrain, importBrain } = await import("@megasaver/core");
  const transport = await createTransport({
    endpoint: config.endpoint,
    region: config.region,
    bucket: config.bucket,
    prefix: `${config.prefix}${projectId}/`,
    pathStyle: config.pathStyle,
  });
  const deps: SyncDeps = {
    transport,
    key,
    projectId,
    lastSeenGeneration: () => loadConfig(input.storeRoot).lastSeen[projectId] ?? 0,
    persistLastSeen: (generation) => updateLastSeen(input.storeRoot, projectId, generation),
    exportBundle: () =>
      exportBrain({ registry, projectId, createdAt: new Date(input.now()).toISOString() }),
    importBundle: (bundleText) => {
      const report = importBrain({ registry, projectId, bundleText, newId: randomUUID });
      input.stdout(
        `merged: +${report.imported.memories} memories (suggested), +${report.imported.rules} rules, +${report.imported.failures} failures`,
      );
    },
    now: () => new Date(input.now()),
  };
  return { deps, config };
}
