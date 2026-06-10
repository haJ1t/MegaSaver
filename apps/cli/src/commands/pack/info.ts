import { SkillPackError, discoverPacks } from "@megasaver/skill-packs";
import { defineCommand } from "citty";
import { type PackEnv, packErrorToCli, resolveWorkspaceRoot } from "./shared.js";

export type RunPackInfoInput = PackEnv & { name: string; json: boolean };

export async function runPackInfo(input: RunPackInfoInput): Promise<0 | 1> {
  try {
    const result = await discoverPacks({
      workspaceRoot: resolveWorkspaceRoot(input),
      home: input.home,
      xdgDataHome: input.xdgDataHome,
    });
    // discoverPacks already dedupes workspace-over-global (HH §4).
    const pack = result.packs.find((p) => p.manifest.name === input.name);
    if (!pack) {
      throw new SkillPackError("pack_not_found", `no discovered pack named: ${input.name}`);
    }
    if (input.json) {
      input.stdout(JSON.stringify(pack));
      return 0;
    }
    const m = pack.manifest;
    input.stdout(`${m.name}@${m.version} (${m.kind}, ${pack.source})`);
    input.stdout(`root: ${pack.root}`);
    input.stdout(`skills: ${m.skills.map((s) => s.id).join(", ") || "none"}`);
    input.stdout(`capabilities: ${m.capabilities.join(", ") || "none"}`);
    if (m.description) input.stdout(`description: ${m.description}`);
    return 0;
  } catch (err) {
    const cli = packErrorToCli(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const packInfoCommand = defineCommand({
  meta: { name: "info", description: "Show a discovered pack's manifest." },
  args: {
    name: { type: "positional", required: true, description: "Pack name." },
    root: { type: "string", description: "Workspace root (defaults to cwd)." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runPackInfo({
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
