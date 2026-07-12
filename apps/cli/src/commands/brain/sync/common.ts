import { type KeyObject, randomUUID } from "node:crypto";
import {
  type BrainSyncConfig,
  type SyncDeps,
  assertSafeEndpoint,
  createTransport,
  deriveBrainId,
  keyfilePath,
  loadConfig,
  loadKeyfile,
  updateLastSeen,
} from "@megasaver/brain-sync";
import { checkEntitlement } from "@megasaver/entitlement";
import type { ProjectId } from "@megasaver/shared";
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

export type ProjectSyncContext = {
  deps: SyncDeps;
  config: BrainSyncConfig;
  brainId: string;
  localProjectId: ProjectId;
  registry: EnsureStoreReadyResult["registry"];
};

// Resolves the project by name, loads config+keyfile, derives the cross-machine
// brainId (key-salted hash of the project name), and builds a transport scoped
// by that brainId + the SyncDeps that bridge core's export/import into the sync
// engine. The remote identity (prefix + AAD + lastSeen) is keyed by brainId so
// two machines that share the key and name the project the same resolve to the
// same remote; the LOCAL project.id still keys every registry operation.
// Returns null after writing a stderr message (caller returns 1). Throws
// BrainSyncError for config/keyfile problems (the caller maps it to a
// single-line `error: …`).
export async function buildProjectSyncContext(
  input: BrainSyncCommonInput & { projectName: string },
): Promise<ProjectSyncContext | null> {
  const { registry } = await input.ensureStore();
  const project = registry.listProjects().find((p) => p.name === input.projectName);
  if (project === undefined) {
    input.stderr(projectNotFoundMessage(input.projectName).message);
    return null;
  }
  const localProjectId = project.id;
  const config = loadConfig(input.storeRoot);
  assertSafeEndpoint(config.endpoint);
  const key = loadKeyfile(keyfilePath(input.storeRoot));
  const brainId = deriveBrainId(key, project.name);
  const { exportBrain, importBrain } = await import("@megasaver/core");
  const transport = await createTransport({
    endpoint: config.endpoint,
    region: config.region,
    bucket: config.bucket,
    prefix: `${config.prefix}${brainId}/`,
    pathStyle: config.pathStyle,
  });
  const deps: SyncDeps = {
    transport,
    key,
    brainId,
    lastSeenGeneration: () => loadConfig(input.storeRoot).lastSeen[brainId] ?? 0,
    persistLastSeen: (generation) => updateLastSeen(input.storeRoot, brainId, generation),
    exportBundle: () =>
      exportBrain({
        registry,
        projectId: localProjectId,
        createdAt: new Date(input.now()).toISOString(),
      }),
    importBundle: (bundleText) => {
      const report = importBrain({
        registry,
        projectId: localProjectId,
        bundleText,
        newId: randomUUID,
      });
      input.stdout(
        `merged: +${report.imported.memories} memories (suggested), +${report.imported.rules} rules, +${report.imported.failures} failures`,
      );
    },
    now: () => new Date(input.now()),
  };
  return { deps, config, brainId, localProjectId, registry };
}

// Counts sync-imported memories still awaiting approval: `suggested` entries
// carrying the `brain-import:` provenance tag importBrain writes into evidence.
// push refuses to publish while these are pending (they'd be dropped from the
// remote — exportBrain emits approved-only).
export function pendingSyncSuggestions(
  registry: EnsureStoreReadyResult["registry"],
  localProjectId: ProjectId,
): number {
  return registry
    .listMemoryEntries(localProjectId)
    .filter(
      (m) =>
        m.approval === "suggested" && (m.evidence ?? []).some((e) => e.startsWith("brain-import:")),
    ).length;
}
