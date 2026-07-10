import {
  nodeResolverDeps,
  readHeartbeatView,
  resolveWorkspaceTokenSaverSettings,
} from "@megasaver/context-gate";
import { defineCommand } from "citty";
import { mapErrorToCliMessage } from "../../../errors.js";
import { type ResolveStorePathInput, readStoreEnv, resolveStorePath } from "../../../store.js";

export type RunSessionSaverResolveInput = ResolveStorePathInput & {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
  now?: number;
};

// Shows what activation the saver hook would resolve for the current cwd, plus
// the metadata-only liveness evidence (configured / invoked / compressed). Never
// mutates; a hook that has not seen an eligible tool is not treated as failed.
export async function runSessionSaverResolve(input: RunSessionSaverResolveInput): Promise<0 | 1> {
  let store: string;
  try {
    store = resolveStorePath(input);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  const resolved = resolveWorkspaceTokenSaverSettings(store, input.cwd, nodeResolverDeps());
  const hb = readHeartbeatView(store, input.now);
  const requested = resolved.requestedWorkspaceKey;
  const lastInvocation = hb.latest;
  const lastCompression = hb.latestCompression;
  const invokedHere = hb.workspaces[requested] ?? null;

  if (input.json) {
    input.stdout(
      JSON.stringify({
        enabled: resolved.enabled,
        mode: resolved.mode,
        source: resolved.source,
        requestedWorkspaceKey: requested,
        repositoryFamilyKey: resolved.repositoryFamilyKey,
        familyUnavailableReason: resolved.familyUnavailableReason,
        familyIdentityDiagnostic: resolved.familyIdentityDiagnostic,
        policyClamp: resolved.policyClamp,
        lastInvocationAt: lastInvocation?.ts ?? null,
        lastInvocationHereAt: invokedHere,
        lastCompressionAt: lastCompression?.ts ?? null,
        completions: hb.completions?.[requested] ?? null,
        failures: hb.failures?.[requested] ?? null,
        daemonFallbacks: hb.daemonFallbacks?.[requested] ?? null,
      }),
    );
    return 0;
  }

  input.stdout(
    `Saver Mode: ${resolved.enabled ? "enabled" : "disabled"} (${resolved.mode}) — source ${resolved.source}`,
  );
  input.stdout(`  workspace: ${requested}`);
  if (resolved.repositoryFamilyKey !== null) {
    input.stdout(`  repository family: ${resolved.repositoryFamilyKey}`);
  }
  if (resolved.policyClamp !== null) {
    input.stdout(
      `  policy floor: ${resolved.policyClamp.floor} (record mode ${resolved.policyClamp.original} clamped by .megasaver/policy.json)`,
    );
  }
  if (resolved.familyUnavailableReason !== null) {
    input.stdout(
      `  family unavailable: ${resolved.familyUnavailableReason} — run \`mega session saver workspace enable\` to create a family record`,
    );
  }
  if (resolved.familyIdentityDiagnostic !== null) {
    input.stdout(`  identity note: ${resolved.familyIdentityDiagnostic}`);
  }
  input.stdout(
    `  hook invocation (this workspace): ${invokedHere ?? "none observed"}${
      lastInvocation ? `  |  global: ${lastInvocation.ts}` : ""
    }`,
  );
  input.stdout(`  last compression (global): ${lastCompression?.ts ?? "none observed"}`);
  const fail = hb.failures?.[requested];
  input.stdout(
    fail !== undefined
      ? `  hook failures (this workspace): ${fail.count} (last ${fail.lastAt}, ${fail.lastKind})`
      : "  hook failures (this workspace): none observed",
  );
  const fallback = hb.daemonFallbacks?.[requested];
  input.stdout(
    fallback !== undefined
      ? `  daemon fallbacks (this workspace): ${fallback.count} (last ${fallback.lastAt})`
      : "  daemon fallbacks (this workspace): none observed",
  );
  return 0;
}

export const sessionSaverResolveCommand = defineCommand({
  meta: {
    name: "resolve",
    description:
      "Show the activation the saver hook resolves for the current directory + liveness.",
  },
  args: {
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runSessionSaverResolve({
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
