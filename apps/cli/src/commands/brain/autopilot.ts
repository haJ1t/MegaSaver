import {
  type AutopilotPolicy,
  type MemoryType,
  memoryTypeSchema,
  readAutopilotPolicy,
  readDigestState,
  writeAutopilotPolicy,
} from "@megasaver/core";
import { defineCommand } from "citty";
import {
  type EnsureStoreReadyResult,
  ensureStoreReady,
  readStoreEnv,
  resolveStorePath,
} from "../../store.js";

export type RunAutopilotStatusInput = {
  storeRoot: string;
  ensureStore: () => Promise<EnsureStoreReadyResult>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runAutopilotStatus(input: RunAutopilotStatusInput): Promise<0 | 1> {
  const policy = readAutopilotPolicy(input.storeRoot);
  const digest = readDigestState(input.storeRoot);
  const { registry, initialized } = await input.ensureStore();
  if (initialized) input.stderr(`note: initialized store at ${input.storeRoot}`);
  let pendingSuggested = 0;
  for (const project of registry.listProjects()) {
    pendingSuggested += registry
      .listMemoryEntries(project.id)
      .filter((entry) => entry.approval === "suggested").length;
  }
  input.stdout(`enabled: ${policy.enabled ? "yes" : "no"}`);
  input.stdout(`auto-approve types: ${policy.autoApproveTypes.join(", ")}`);
  input.stdout(`min confidence: ${policy.autoApproveMinConfidence}`);
  input.stdout(`max per session: ${policy.maxAutoApprovesPerSession}`);
  // Both lines are store-wide, but `digest` drains ONE project — label the
  // scope so the count is not read as a promise the digest will not keep.
  input.stdout(`pending suggested (all projects): ${pendingSuggested}`);
  input.stdout(`last digest (any project): ${digest.lastDigestAt ?? "never"}`);
  return 0;
}

export type RunAutopilotOnInput = {
  storeRoot: string;
  typesFlag: string | undefined;
  maxFlag: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export function runAutopilotOn(input: RunAutopilotOnInput): 0 | 1 {
  const policy = readAutopilotPolicy(input.storeRoot);
  let autoApproveTypes = policy.autoApproveTypes;
  if (input.typesFlag !== undefined) {
    const items = input.typesFlag
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    if (items.length === 0) {
      input.stderr(
        `--auto-approve-types needs at least one type — valid types: ${memoryTypeSchema.options.join(", ")}`,
      );
      return 1;
    }
    const parsed: MemoryType[] = [];
    for (const item of items) {
      const result = memoryTypeSchema.safeParse(item);
      if (!result.success) {
        input.stderr(
          `invalid memory type "${item}" — valid types: ${memoryTypeSchema.options.join(", ")}`,
        );
        return 1;
      }
      parsed.push(result.data);
    }
    autoApproveTypes = parsed;
  }
  let maxAutoApprovesPerSession = policy.maxAutoApprovesPerSession;
  if (input.maxFlag !== undefined) {
    const parsed = Number(input.maxFlag);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      input.stderr(`invalid --max-per-session "${input.maxFlag}" — must be a positive integer`);
      return 1;
    }
    maxAutoApprovesPerSession = parsed;
  }
  const next: AutopilotPolicy = {
    ...policy,
    enabled: true,
    autoApproveTypes,
    maxAutoApprovesPerSession,
  };
  writeAutopilotPolicy(input.storeRoot, next);
  input.stdout(
    `autopilot on — the next entitled run auto-approves up to ${maxAutoApprovesPerSession} high-confidence ${autoApproveTypes.join("/")} memories per session; everything else stays suggested`,
  );
  return 0;
}

export type RunAutopilotOffInput = {
  storeRoot: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export function runAutopilotOff(input: RunAutopilotOffInput): 0 | 1 {
  const policy = readAutopilotPolicy(input.storeRoot);
  writeAutopilotPolicy(input.storeRoot, { ...policy, enabled: false });
  input.stdout("autopilot off");
  return 0;
}

const autopilotStatusCommand = defineCommand({
  meta: { name: "status", description: "Show the autopilot policy and pending queue size." },
  args: {
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const storeRoot = resolveStorePath(
      readStoreEnv(typeof args.store === "string" ? args.store : undefined),
    );
    const code = await runAutopilotStatus({
      storeRoot,
      ensureStore: () => ensureStoreReady(storeRoot),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});

const autopilotOnCommand = defineCommand({
  meta: { name: "on", description: "Enable autopilot and set the auto-approve policy." },
  args: {
    "auto-approve-types": {
      type: "string",
      description: "Comma-separated memory types eligible for auto-approve.",
    },
    "max-per-session": {
      type: "string",
      description: "Max auto-approves per session run (positive integer).",
    },
    store: { type: "string", description: "Override store directory." },
  },
  run({ args }) {
    const storeRoot = resolveStorePath(
      readStoreEnv(typeof args.store === "string" ? args.store : undefined),
    );
    const code = runAutopilotOn({
      storeRoot,
      typesFlag:
        typeof args["auto-approve-types"] === "string" ? args["auto-approve-types"] : undefined,
      maxFlag: typeof args["max-per-session"] === "string" ? args["max-per-session"] : undefined,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});

const autopilotOffCommand = defineCommand({
  meta: { name: "off", description: "Disable autopilot auto-approval." },
  args: {
    store: { type: "string", description: "Override store directory." },
  },
  run({ args }) {
    const storeRoot = resolveStorePath(
      readStoreEnv(typeof args.store === "string" ? args.store : undefined),
    );
    const code = runAutopilotOff({
      storeRoot,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});

export const brainAutopilotCommand = defineCommand({
  meta: {
    name: "autopilot",
    description: "Grow the brain automatically — policy toggle, status, and manual runs.",
  },
  subCommands: {
    status: autopilotStatusCommand,
    on: autopilotOnCommand,
    off: autopilotOffCommand,
  },
});
