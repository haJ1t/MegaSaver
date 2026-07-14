import { execFileSync } from "node:child_process";
import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activateLicense } from "@megasaver/entitlement";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  HOOK_BLOCK_END,
  HOOK_BLOCK_START,
  HOOK_CREATED_MARKER,
} from "../../src/commands/memory/verify-hook.js";
import { MEMORY_VERIFY_UPSELL, runMemoryVerify } from "../../src/commands/memory/verify.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TS = "2026-07-01T00:00:00.000Z";
const NOW = "2026-07-14T00:00:00.000Z";
const FOREIGN = "#!/bin/bash\necho foreign hook\n";

type LicensePayload = { v: number; tier: string; id: string; iat: number; exp: number | null };
const b64url = (buf: Buffer): string => buf.toString("base64url");
function signTestLicense(
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"],
  payload: LicensePayload,
): string {
  const bytes = Buffer.from(JSON.stringify(payload));
  return `msp_${b64url(bytes)}.${b64url(sign(null, bytes, privateKey))}`;
}

let store: string;
let repo: string;
let hookPath: string;
let proPublicKey: KeyObject | undefined;
let lines: string[];
let errLines: string[];

function git(args: string[], cwd: string): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function activatePro(): void {
  const keys = generateKeyPairSync("ed25519");
  const key = signTestLicense(keys.privateKey, { v: 1, tier: "pro", id: "t1", iat: 0, exp: null });
  activateLicense(store, key, { publicKey: keys.publicKey, now: () => Date.parse(NOW) });
  proPublicKey = keys.publicKey;
}

beforeEach(async () => {
  store = await mkdtemp(join(tmpdir(), "megasaver-hook-store-"));
  repo = await mkdtemp(join(tmpdir(), "megasaver-hook-repo-"));
  hookPath = join(repo, ".git", "hooks", "post-commit");
  proPublicKey = undefined;
  lines = [];
  errLines = [];
  git(["init"], repo);
  await mkdir(join(store, "memory"), { recursive: true });
  await writeFile(
    join(store, "projects.json"),
    JSON.stringify([
      { id: PROJECT_ID, name: "demo", rootPath: repo, createdAt: TS, updatedAt: TS },
    ]),
  );
  await writeFile(join(store, "sessions.json"), "[]");
});

afterEach(async () => {
  await rm(store, { recursive: true, force: true });
  await rm(repo, { recursive: true, force: true });
});

function hookInput(
  over: Partial<Parameters<typeof runMemoryVerify>[0]> = {},
): Parameters<typeof runMemoryVerify>[0] {
  return {
    projectId: PROJECT_ID,
    changedFlag: false,
    quietFlag: false,
    jsonFlag: false,
    storeFlag: store,
    cwd: process.cwd(),
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    home: process.env["HOME"] ?? "",
    xdgDataHome: undefined,
    platform: process.platform,
    localAppData: undefined,
    stdout: (line) => lines.push(line),
    stderr: (line) => errLines.push(line),
    now: () => NOW,
    nowMs: () => Date.parse(NOW),
    ...(proPublicKey === undefined ? {} : { publicKey: proPublicKey }),
    ...over,
  };
}

describe("mega memory verify --install-hook / --uninstall-hook", () => {
  it("free tier writes NOTHING and prints the upsell", async () => {
    const code = await runMemoryVerify(hookInput({ installHookFlag: true }));
    expect(code).toBe(0);
    expect(lines).toContain(MEMORY_VERIFY_UPSELL);
    expect(existsSync(hookPath)).toBe(false);
  });

  it("creates the hook 0755 with shebang + marker, idempotently", async () => {
    activatePro();
    let code = await runMemoryVerify(hookInput({ installHookFlag: true }));
    expect(code).toBe(0);
    code = await runMemoryVerify(hookInput({ installHookFlag: true }));
    expect(code).toBe(0);

    const content = await readFile(hookPath, "utf8");
    // double install => exactly one sentinel block
    expect(content.split(HOOK_BLOCK_START).length).toBe(2);
    expect(content.split(HOOK_BLOCK_END).length).toBe(2);
    expect(content.startsWith(`#!/bin/sh\n${HOOK_CREATED_MARKER}\n`)).toBe(true);
    expect(content).toContain(
      `mega memory verify ${PROJECT_ID} --changed --quiet --store '${store}' || true`,
    );
    // owner-executable — Windows has no POSIX permission bits (git runs hooks
    // through sh regardless), so the mode is only meaningful on POSIX hosts.
    if (process.platform !== "win32") {
      expect(statSync(hookPath).mode & 0o100).not.toBe(0);
    }
  });

  it("preserves a foreign hook byte-for-byte and uninstall removes only the block", async () => {
    activatePro();
    await writeFile(hookPath, FOREIGN, { mode: 0o755 });

    let code = await runMemoryVerify(hookInput({ installHookFlag: true }));
    expect(code).toBe(0);
    const installed = await readFile(hookPath, "utf8");
    expect(installed.startsWith(FOREIGN)).toBe(true);
    expect(installed).toContain(HOOK_BLOCK_START);
    expect(installed).not.toContain(HOOK_CREATED_MARKER);

    code = await runMemoryVerify(hookInput({ uninstallHookFlag: true }));
    expect(code).toBe(0);
    expect(existsSync(hookPath)).toBe(true);
    expect(await readFile(hookPath, "utf8")).toBe(FOREIGN);
  });

  it("uninstall deletes the file only when we created it", async () => {
    activatePro();
    await runMemoryVerify(hookInput({ installHookFlag: true }));
    expect(existsSync(hookPath)).toBe(true);
    const code = await runMemoryVerify(hookInput({ uninstallHookFlag: true }));
    expect(code).toBe(0);
    expect(existsSync(hookPath)).toBe(false);
  });

  it("--install-hook and --uninstall-hook are mutually exclusive", async () => {
    activatePro();
    const code = await runMemoryVerify(
      hookInput({ installHookFlag: true, uninstallHookFlag: true }),
    );
    expect(code).toBe(1);
    expect(errLines.join("\n")).toContain("mutually exclusive");
    expect(existsSync(hookPath)).toBe(false);
  });
});
