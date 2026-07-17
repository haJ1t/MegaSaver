import { type KeyObject, randomUUID } from "node:crypto";
import {
  type AutopilotPolicy,
  type MemoryType,
  memoryTypeSchema,
  readAutopilotPolicy,
  readDigestState,
  runAutopilot,
  writeAutopilotPolicy,
} from "@megasaver/core";
import { checkEntitlement } from "@megasaver/entitlement";
import { sessionIdSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import {
  mapErrorToCliMessage,
  projectNotFoundMessage,
  sessionNotFoundMessage,
} from "../../errors.js";
import {
  type EnsureStoreReadyResult,
  ensureStoreReady,
  readStoreEnv,
  resolveStorePath,
} from "../../store.js";
import { PRO_ANALYTICS_URL } from "../savings/index.js";

export const AUTOPILOT_UPSELL = `Brain autopilot is a Mega Saver Pro feature. Activate a key: mega license activate <key>. Learn more: ${PRO_ANALYTICS_URL}.`;

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

export type RunAutopilotRunInput = {
  storeRoot: string;
  sessionId: string;
  projectName: string | undefined;
  dryRunFlag: boolean;
  jsonFlag: boolean;
  now: () => number;
  newId?: () => string;
  publicKey?: KeyObject | string;
  ensureStore: () => Promise<EnsureStoreReadyResult>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runAutopilotRun(input: RunAutopilotRunInput): Promise<0 | 1> {
  let sessionId: ReturnType<typeof sessionIdSchema.parse>;
  try {
    sessionId = sessionIdSchema.parse(input.sessionId);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "sessionId" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  // Real runs only: PRO gate FIRST (zero work when unentitled), then the
  // enabled toggle (architect M3) — both BEFORE ensureStore, which would
  // otherwise initialize the store (a write). --dry-run is the free proof
  // surface and skips both checks.
  if (!input.dryRunFlag) {
    const ent = checkEntitlement("brain-autopilot", {
      storeRoot: input.storeRoot,
      now: input.now,
      ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
    });
    if (!ent.entitled) {
      input.stdout(AUTOPILOT_UPSELL);
      return 0;
    }
  }

  // ONE policy snapshot, read after the PRO gate (unentitled returns first, zero
  // work) and before ensureStore (a disabled run must not initialize the store).
  // Threaded through both the enabled gate AND runAutopilot below so a concurrent
  // `autopilot on/off` in the ensureStore window can't make the run act on a policy
  // the gate never validated (TOCTOU). --dry-run skips the enabled gate but still
  // needs the snapshot to report what it would do.
  const policy = readAutopilotPolicy(input.storeRoot);
  if (!input.dryRunFlag && !policy.enabled) {
    input.stderr("autopilot is off — enable with: mega brain autopilot on");
    return 1;
  }

  try {
    const { registry, initialized } = await input.ensureStore();
    if (initialized) input.stderr(`note: initialized store at ${input.storeRoot}`);
    const session = registry.getSession(sessionId);
    if (!session) {
      const cli = sessionNotFoundMessage(sessionId);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    if (input.projectName !== undefined) {
      const project = registry.listProjects().find((p) => p.name === input.projectName);
      if (!project) {
        const cli = projectNotFoundMessage(input.projectName);
        input.stderr(cli.message);
        return cli.exitCode;
      }
      if (project.id !== session.projectId) {
        input.stderr(`session ${sessionId} does not belong to project "${input.projectName}"`);
        return 1;
      }
    }

    const result = await runAutopilot({
      registry,
      projectId: session.projectId,
      sessionId,
      policy,
      now: new Date(input.now()).toISOString(),
      newId: input.newId ?? (() => randomUUID()),
      dryRun: input.dryRunFlag,
    });

    if (input.dryRunFlag) input.stderr("DRY RUN — nothing written");
    if (input.jsonFlag) {
      input.stdout(JSON.stringify(result));
      return 0;
    }
    input.stdout(
      `auto-approved ${result.autoApproved.length} · staged ${result.staged.length} · skipped ${result.skippedExisting} (already captured) · capped ${result.cappedOut}`,
    );
    for (const entry of result.autoApproved) {
      input.stdout(`auto-approved ${entry.id} ${entry.type} ${entry.title}`);
    }
    for (const entry of result.staged) {
      input.stdout(`staged ${entry.id} ${entry.type} ${entry.title}`);
    }
    if (result.cappedOut > 0) {
      input.stdout(
        `notice: ${result.cappedOut} more qualified — raise --max-per-session or approve in digest`,
      );
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memory_create" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
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

const autopilotRunCommand = defineCommand({
  meta: {
    name: "run",
    description: "Distill a session's failures into memories (Mega Saver Pro; --dry-run is free).",
  },
  args: {
    session: { type: "string", required: true, description: "Session id (UUID)." },
    project: {
      type: "string",
      description: "Project name guard — errors if the session belongs elsewhere.",
    },
    "dry-run": {
      type: "boolean",
      default: false,
      description: "Preview the approve/stage split without writing.",
    },
    json: { type: "boolean", default: false, description: "Emit the run result as JSON." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const storeRoot = resolveStorePath(
      readStoreEnv(typeof args.store === "string" ? args.store : undefined),
    );
    const code = await runAutopilotRun({
      storeRoot,
      sessionId: typeof args.session === "string" ? args.session : "",
      projectName: typeof args.project === "string" ? args.project : undefined,
      dryRunFlag: args["dry-run"] === true,
      jsonFlag: args.json === true,
      now: () => Date.now(),
      ensureStore: () => ensureStoreReady(storeRoot),
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
    run: autopilotRunCommand,
  },
});
