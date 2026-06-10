import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { packInfoCommand, runPackInfo } from "../src/commands/pack/info.js";
import { packInstallCommand, runPackInstall } from "../src/commands/pack/install.js";
import { packListCommand, runPackList } from "../src/commands/pack/list.js";
import { packRemoveCommand, runPackRemove } from "../src/commands/pack/remove.js";

const MANIFEST = {
  name: "demo-pack",
  version: "1.0.0",
  kind: "skill",
  skills: [{ id: "hello", entry: "skills/hello.md" }],
  capabilities: ["read-memory"],
  description: "A demo pack",
};

async function seedSource(dir: string, manifest: unknown = MANIFEST): Promise<void> {
  await mkdir(join(dir, "skills"), { recursive: true });
  await writeFile(join(dir, "megasaver-pack.json"), JSON.stringify(manifest));
  await writeFile(join(dir, "skills", "hello.md"), "# hello\n");
}

type Sink = { out: string[]; err: string[] };
const sink = (): Sink => ({ out: [], err: [] });

describe("mega pack commands", () => {
  let workspace: string;
  let source: string;
  let s: Sink;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "cli-pack-ws-"));
    source = await mkdtemp(join(tmpdir(), "cli-pack-src-"));
    s = sink();
  });
  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(source, { recursive: true, force: true });
  });

  const env = () => ({
    rootFlag: workspace,
    cwd: workspace,
    home: "/nonexistent-home",
    xdgDataHome: undefined,
    stdout: (l: string) => s.out.push(l),
    stderr: (l: string) => s.err.push(l),
  });

  it("install: text success line", async () => {
    await seedSource(source);
    const code = await runPackInstall({ ...env(), path: source, force: false, json: false });
    expect(code).toBe(0);
    expect(s.out.join("\n")).toContain("Installed demo-pack@1.0.0 (skill, 1 skills)");
  });

  it("install --json: emits manifest payload", async () => {
    await seedSource(source);
    const code = await runPackInstall({ ...env(), path: source, force: false, json: true });
    expect(code).toBe(0);
    const payload = JSON.parse(s.out[0] as string);
    expect(payload.manifest.name).toBe("demo-pack");
  });

  it("install failure: text stderr, exit 1, no stdout (json mode too)", async () => {
    await seedSource(source, { name: "Bad Name" });
    const code = await runPackInstall({ ...env(), path: source, force: false, json: true });
    expect(code).toBe(1);
    expect(s.out).toHaveLength(0);
    expect(s.err.join("\n")).toContain("error: manifest_invalid:");
  });

  it("list: shows installed packs and discovery warnings on stderr", async () => {
    await seedSource(source);
    await runPackInstall({ ...env(), path: source, force: false, json: false });
    const broken = join(workspace, ".megasaver", "packs", "broken");
    await mkdir(broken, { recursive: true });
    await writeFile(join(broken, "megasaver-pack.json"), "{nope");
    const s2 = sink();
    const code = await runPackList({
      ...env(),
      stdout: (l) => s2.out.push(l),
      stderr: (l) => s2.err.push(l),
      json: false,
    });
    expect(code).toBe(0);
    expect(s2.out.join("\n")).toContain("demo-pack@1.0.0 skill workspace");
    expect(s2.err.join("\n")).toContain("broken");
  });

  it("list --json: { packs, warnings } shape", async () => {
    await seedSource(source);
    await runPackInstall({ ...env(), path: source, force: false, json: false });
    const s2 = sink();
    const code = await runPackList({
      ...env(),
      stdout: (l) => s2.out.push(l),
      stderr: (l) => s2.err.push(l),
      json: true,
    });
    expect(code).toBe(0);
    const payload = JSON.parse(s2.out[0] as string);
    expect(payload.packs).toHaveLength(1);
    expect(payload.warnings).toEqual([]);
  });

  it("info: workspace pack renders manifest fields", async () => {
    await seedSource(source);
    await runPackInstall({ ...env(), path: source, force: false, json: false });
    const s2 = sink();
    const code = await runPackInfo({
      ...env(),
      stdout: (l) => s2.out.push(l),
      stderr: (l) => s2.err.push(l),
      name: "demo-pack",
      json: false,
    });
    expect(code).toBe(0);
    const joined = s2.out.join("\n");
    expect(joined).toContain("demo-pack");
    expect(joined).toContain("1.0.0");
    expect(joined).toContain("read-memory");
  });

  it("info: unknown pack → pack_not_found, exit 1", async () => {
    const code = await runPackInfo({ ...env(), name: "ghost", json: false });
    expect(code).toBe(1);
    expect(s.err.join("\n")).toContain("error: pack_not_found:");
  });

  it("remove: removes and reports; second remove → pack_not_found", async () => {
    await seedSource(source);
    await runPackInstall({ ...env(), path: source, force: false, json: false });
    const s2 = sink();
    let code = await runPackRemove({
      ...env(),
      stdout: (l) => s2.out.push(l),
      stderr: (l) => s2.err.push(l),
      name: "demo-pack",
      json: false,
    });
    expect(code).toBe(0);
    expect(s2.out.join("\n")).toContain("Removed demo-pack");
    code = await runPackRemove({ ...env(), name: "demo-pack", json: false });
    expect(code).toBe(1);
  });

  describe("--json flag drift guards", () => {
    const commands = [
      ["install", packInstallCommand],
      ["list", packListCommand],
      ["remove", packRemoveCommand],
      ["info", packInfoCommand],
    ] as const;
    it.each(commands)("%s: json flag shape is pinned", (_name, command) => {
      const arg = (
        command.args as Record<string, { type: string; default?: boolean; description?: string }>
      ).json;
      expect(arg.type).toBe("boolean");
      expect(arg.default).toBe(false);
      expect(arg.description).toBe("Emit JSON output.");
    });
  });

  it("info: workspace pack shadows a same-name global pack", async () => {
    const xdg = await mkdtemp(join(tmpdir(), "cli-pack-xdg-"));
    try {
      await seedSource(source);
      const globalDir = join(xdg, "megasaver", "packs", "demo-pack");
      await mkdir(join(globalDir, "skills"), { recursive: true });
      await writeFile(
        join(globalDir, "megasaver-pack.json"),
        JSON.stringify({ ...MANIFEST, version: "9.9.9" }),
      );
      await writeFile(join(globalDir, "skills", "hello.md"), "# global\n");
      await runPackInstall({ ...env(), path: source, force: false, json: false });
      const s2 = sink();
      const code = await runPackInfo({
        ...env(),
        xdgDataHome: xdg,
        stdout: (l) => s2.out.push(l),
        stderr: (l) => s2.err.push(l),
        name: "demo-pack",
        json: true,
      });
      expect(code).toBe(0);
      const payload = JSON.parse(s2.out[0] as string);
      expect(payload.manifest.version).toBe("1.0.0");
      expect(payload.source).toBe("workspace");
    } finally {
      await rm(xdg, { recursive: true, force: true });
    }
  });
});
