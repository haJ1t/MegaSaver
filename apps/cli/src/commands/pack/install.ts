import { installPack } from "@megasaver/skill-packs";
import { defineCommand } from "citty";
import { type PackEnv, packErrorToCli, resolveWorkspaceRoot } from "./shared.js";

export type RunPackInstallInput = PackEnv & { path: string; force: boolean; json: boolean };

export async function runPackInstall(input: RunPackInstallInput): Promise<0 | 1> {
  try {
    const installed = await installPack({
      sourceDir: input.path,
      workspaceRoot: resolveWorkspaceRoot(input),
      home: input.home,
      xdgDataHome: input.xdgDataHome,
      platform: input.platform,
      localAppData: input.localAppData,
      force: input.force,
    });
    if (input.json) {
      input.stdout(JSON.stringify({ manifest: installed.manifest, root: installed.root }));
    } else {
      const m = installed.manifest;
      input.stdout(`Installed ${m.name}@${m.version} (${m.kind}, ${m.skills.length} skills)`);
    }
    return 0;
  } catch (err) {
    const cli = packErrorToCli(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const packInstallCommand = defineCommand({
  meta: { name: "install", description: "Install a skill pack into the workspace." },
  args: {
    path: { type: "positional", required: true, description: "Path to the pack directory." },
    force: { type: "boolean", default: false, description: "Replace an existing install." },
    root: { type: "string", description: "Workspace root (defaults to cwd)." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runPackInstall({
      path: typeof args.path === "string" ? args.path : "",
      force: !!args.force,
      json: !!args.json,
      rootFlag: typeof args.root === "string" ? args.root : undefined,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      home: process.env["HOME"] ?? process.env["USERPROFILE"] ?? "",
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      xdgDataHome: process.env["XDG_DATA_HOME"],
      platform: process.platform,
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      localAppData: process.env["LOCALAPPDATA"],
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
