import {
  resolveClaudeCodeSettingsPath,
  uninstallClaudeCodeHook,
} from "@megasaver/connector-claude-code";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { defineCommand } from "citty";
import { mapErrorToCliMessage } from "../errors.js";
import { readStoreEnv, resolveHomeDir, resolveStorePath } from "../store.js";
import { resolveActivationScope, writeActivation } from "@megasaver/context-gate";
import { confirmYesNo } from "./init.js";
import { readUpManifest } from "../up/manifest.js";
import { type DownDeps, runDownReverse } from "../up/reverse.js";

export type RunDownInput = {
  yes: boolean;
  settingsPath: string;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  isTTY: boolean;
  json: boolean;
  deps: DownDeps & {
    prompt: () => Promise<boolean>;
  };
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runDown(input: RunDownInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath({
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
    return cli.exitCode;
  }

  const workspaceKey = encodeWorkspaceKey(input.cwd);
  const read = readUpManifest(rootDir, workspaceKey);

  if (read.kind === "absent") {
    input.stdout("nothing to reverse: no mega up manifest found for this workspace");
    return 0;
  }

  if (read.kind === "corrupt") {
    input.stderr(
      `error: corrupt manifest: ${read.message}\nmanual rollback: mega hooks uninstall, mega session saver workspace disable`,
    );
    return 1;
  }

  if (read.manifest.reversedAt !== undefined) {
    input.stdout(`manifest already reversed at ${read.manifest.reversedAt}`);
    return 0;
  }

  if (!input.yes && !input.isTTY) {
    input.stderr("error: refusing to write without --yes in non-TTY environment");
    return 1;
  }

  if (!input.yes) {
    const ok = await input.deps.prompt();
    if (!ok) return 0;
  }

  const res = runDownReverse({
    manifest: read.manifest,
    storeRoot: rootDir,
    cwd: input.cwd,
    deps: input.deps,
  });

  if (input.json) {
    input.stdout(JSON.stringify({ reversed: true, lines: res.lines }));
  } else {
    for (const line of res.lines) {
      input.stdout(line);
    }
  }

  return res.code;
}

export const downCommand = defineCommand({
  meta: {
    name: "down",
    description: "Reverse activation changes recorded in the workspace up manifest.",
  },
  args: {
    yes: {
      type: "boolean",
      default: false,
      description: "Skip confirmation prompt.",
    },
    settings: {
      type: "string",
      description: "Override Claude Code settings.json path.",
    },
    store: {
      type: "string",
      description: "Override store directory.",
    },
    json: {
      type: "boolean",
      default: false,
      description: "Emit structured JSON output.",
    },
  },
  async run({ args }) {
    const env = readStoreEnv(typeof args.store === "string" ? args.store : undefined);
    const settingsPath =
      typeof args.settings === "string"
        ? args.settings
        : resolveClaudeCodeSettingsPath({ home: resolveHomeDir() });

    const code = await runDown({
      yes: Boolean(args.yes),
      settingsPath,
      storeFlag: env.storeFlag,
      cwd: env.cwd,
      home: env.home,
      xdgDataHome: env.xdgDataHome,
      platform: env.platform,
      localAppData: env.localAppData,
      isTTY: Boolean(process.stdin.isTTY),
      json: Boolean(args.json),
      deps: {
        hooksUninstall: () =>
          uninstallClaudeCodeHook({
            settingsPath,
            platform: env.platform,
          }),
        saverRestore: (enabled, mode, exact) => {
          const scope = resolveActivationScope(env.cwd, exact);
          writeActivation(
            resolveStorePath({
              storeFlag: env.storeFlag,
              cwd: env.cwd,
              home: env.home,
              xdgDataHome: env.xdgDataHome,
              platform: env.platform,
              localAppData: env.localAppData,
            }),
            scope,
            enabled,
            mode,
          );
        },
        prompt: () => confirmYesNo("Reverse changes recorded in manifest? (y/n) "),
        now: () => new Date().toISOString(),
      },
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });

    if (code !== 0) process.exitCode = code;
  },
});
