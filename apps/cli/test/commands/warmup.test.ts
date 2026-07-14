import { generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activateLicense } from "@megasaver/entitlement";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findProjectByCwd, runWarmup } from "../../src/commands/warmup.js";
import { ensureStoreReady } from "../../src/store.js";

const NOW = "2026-07-12T10:00:00.000Z";
let root: string;
let out: string[];
let err: string[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-warmup-"));
  out = [];
  err = [];
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function seedProject(rootPath: string) {
  const { registry } = await ensureStoreReady(root);
  const project = registry.createProject({
    id: "11111111-1111-4111-8111-111111111111",
    name: "demo",
    rootPath,
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
  return { registry, project };
}

type LicensePayload = { v: number; tier: string; id: string; iat: number; exp: number | null };
const b64url = (buf: Buffer): string => buf.toString("base64url");
function signTestLicense(
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"],
  payload: LicensePayload,
): string {
  const bytes = Buffer.from(JSON.stringify(payload));
  return `msp_${b64url(bytes)}.${b64url(sign(null, bytes, privateKey))}`;
}

function baseInput(over: Partial<Parameters<typeof runWarmup>[0]> = {}) {
  return {
    storeRoot: root,
    cwd: "/work/demo",
    now: () => Date.parse(NOW),
    json: false,
    write: false,
    gatherDelta: () => null,
    ensureStore: () => ensureStoreReady(root),
    stdout: (l: string) => out.push(l),
    stderr: (l: string) => err.push(l),
    ...over,
  };
}

describe("findProjectByCwd", () => {
  it("picks the longest rootPath match", () => {
    const projects = [{ rootPath: "/work" }, { rootPath: "/work/demo" }] as never[];
    expect(findProjectByCwd(projects as never, "/work/demo/src")).toEqual({
      rootPath: "/work/demo",
    });
    expect(findProjectByCwd(projects as never, "/elsewhere")).toBeNull();
  });

  it("matches on either path separator regardless of the host platform", () => {
    // A store synced across machines (brain-sync) can carry a rootPath whose
    // separator differs from the host's — the boundary check must accept both
    // "/" and "\\" so warm start still resolves the project.
    const win = [{ rootPath: "C:\\work\\demo" }] as never[];
    expect(findProjectByCwd(win as never, "C:\\work\\demo\\src")).toEqual({
      rootPath: "C:\\work\\demo",
    });
    const posix = [{ rootPath: "/work/demo" }] as never[];
    expect(findProjectByCwd(posix as never, "/work/demo/src")).toEqual({
      rootPath: "/work/demo",
    });
    // a sibling that only shares a name prefix must NOT match (boundary intact)
    expect(findProjectByCwd([{ rootPath: "/work" }] as never, "/workshop")).toBeNull();
  });
});

describe("runWarmup", () => {
  it("prints a brief for the cwd-resolved project", async () => {
    await seedProject("/work/demo");
    const code = await runWarmup(baseInput());
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("Warm Start — demo");
  });

  it("wires the real git branch into the header", async () => {
    await seedProject("/work/demo");
    const code = await runWarmup(
      baseInput({ gatherDelta: () => ({ commits: [], changedFiles: [], branch: "feat/x" }) }),
    );
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("feat/x");
  });

  it("errors when no project matches cwd", async () => {
    await seedProject("/work/demo");
    const code = await runWarmup(baseInput({ cwd: "/nowhere" }));
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("no project");
  });

  it("--json emits the WarmStartBrief struct", async () => {
    await seedProject("/work/demo");
    await runWarmup(baseInput({ json: true }));
    const parsed = JSON.parse(out.join("\n")) as { mode: string; tokenEstimate: number };
    expect(parsed.mode).toBe("standard");
    expect(parsed.tokenEstimate).toBeGreaterThan(0);
  });

  it("stamps lastSeenAt after printing", async () => {
    await seedProject("/work/demo");
    const { readWarmStartState } = await import("@megasaver/core");
    await runWarmup(baseInput());
    expect(readWarmStartState(root, "11111111-1111-4111-8111-111111111111")).not.toBeNull();
  });

  it("records a WarmStartEvent", async () => {
    await seedProject("/work/demo");
    const { readWarmStartEvents } = await import("@megasaver/core");
    await runWarmup(baseInput());
    const events = readWarmStartEvents({ root }, "11111111-1111-4111-8111-111111111111" as never);
    expect(events.length).toBe(1);
    expect(events[0]?.estimated).toBe(true);
  });
});

describe("--write", () => {
  it("prints the Pro upsell and exits 0 without a license", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "megasaver-warmup-nowrite-"));
    try {
      await seedProject(projectDir);
      const code = await runWarmup(baseInput({ cwd: projectDir, write: true }));
      expect(code).toBe(0);
      expect(out.join("\n")).toContain("Pro feature");
      expect(existsSync(join(projectDir, "AGENTS.md"))).toBe(false);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("writes the WS block into an existing AGENTS.md for --target codex (entitled)", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "megasaver-warmup-write-"));
    try {
      await seedProject(projectDir);
      writeFileSync(join(projectDir, "AGENTS.md"), "# Project notes\n\nHand-authored line.\n");

      const keys = generateKeyPairSync("ed25519");
      const key = signTestLicense(keys.privateKey, {
        v: 1,
        tier: "pro",
        id: "c1",
        iat: 0,
        exp: null,
      });
      expect(
        activateLicense(root, key, { publicKey: keys.publicKey, now: () => Date.parse(NOW) }).ok,
      ).toBe(true);

      const code = await runWarmup(
        baseInput({
          write: true,
          writeTarget: "codex",
          projectName: "demo",
          publicKey: keys.publicKey,
        }),
      );
      expect(code).toBe(0);
      const written = readFileSync(join(projectDir, "AGENTS.md"), "utf8");
      expect(written).toContain("<!-- MEGA SAVER:WARM_START BEGIN -->");
      expect(written).toContain("Hand-authored line.");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
