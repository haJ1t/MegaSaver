import { discoverPacks } from "@megasaver/skill-packs";
import { defineCommand } from "citty";
import { type PackEnv, packErrorToCli, resolveWorkspaceRoot } from "./shared.js";

export type RunPackListInput = PackEnv & { json: boolean };

export async function runPackList(input: RunPackListInput): Promise<0 | 1> {
  try {
    const result = await discoverPacks({
      workspaceRoot: resolveWorkspaceRoot(input),
      home: input.home,
      xdgDataHome: input.xdgDataHome,
    });
    for (const warning of result.warnings) input.stderr(`warning: ${warning}`);
    if (input.json) {
      input.stdout(JSON.stringify({ packs: result.packs, warnings: result.warnings }));
      return 0;
    }
    if (result.packs.length === 0) {
      input.stdout("No packs installed.");
      return 0;
    }
    for (const pack of result.packs) {
      const m = pack.manifest;
      input.stdout(`${m.name}@${m.version} ${m.kind} ${pack.source}`);
    }
    return 0;
  } catch (err) {
    const cli = packErrorToCli(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const packListCommand = defineCommand({
  meta: { name: "list", description: "List discovered skill packs (workspace + global)." },
  args: {
    root: { type: "string", description: "Workspace root (defaults to cwd)." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runPackList({
      json: !!args.json,
      rootFlag: typeof args.root === "string" ? args.root : undefined,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      home: process.env["HOME"] ?? "",
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      xdgDataHome: process.env["XDG_DATA_HOME"],
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
