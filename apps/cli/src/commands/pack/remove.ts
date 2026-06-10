import { removePack } from "@megasaver/skill-packs";
import { defineCommand } from "citty";
import { type PackEnv, packErrorToCli, resolveWorkspaceRoot } from "./shared.js";

export type RunPackRemoveInput = PackEnv & { name: string; json: boolean };

export async function runPackRemove(input: RunPackRemoveInput): Promise<0 | 1> {
  try {
    await removePack({ name: input.name, workspaceRoot: resolveWorkspaceRoot(input) });
    if (input.json) {
      input.stdout(JSON.stringify({ removed: input.name }));
    } else {
      input.stdout(`Removed ${input.name}`);
    }
    return 0;
  } catch (err) {
    const cli = packErrorToCli(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const packRemoveCommand = defineCommand({
  meta: { name: "remove", description: "Remove an installed skill pack from the workspace." },
  args: {
    name: { type: "positional", required: true, description: "Installed pack name." },
    root: { type: "string", description: "Workspace root (defaults to cwd)." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runPackRemove({
      name: typeof args.name === "string" ? args.name : "",
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
