import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendGuardEvent, readGuardState } from "@megasaver/core";
import { activateLicense } from "@megasaver/entitlement";
import type { ProjectId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runGuardMode } from "../../src/commands/guard/mode.js";
import { runGuardMute } from "../../src/commands/guard/mute.js";
import { runGuardStatus } from "../../src/commands/guard/status.js";
import { ensureStoreReady } from "../../src/store.js";

const NOW = "2026-07-12T10:00:00.000Z";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
let root: string;
let out: string[];
let err: string[];
let proPublicKey: KeyObject | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-guard-"));
  out = [];
  err = [];
  proPublicKey = undefined;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function seedProject(rootPath: string) {
  const { registry } = await ensureStoreReady(root);
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath,
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
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

function activatePro() {
  const keys = generateKeyPairSync("ed25519");
  const key = signTestLicense(keys.privateKey, { v: 1, tier: "pro", id: "c1", iat: 0, exp: null });
  activateLicense(root, key, { publicKey: keys.publicKey, now: () => Date.parse(NOW) });
  proPublicKey = keys.publicKey;
}

function baseInput<T extends Record<string, unknown>>(over: T) {
  return {
    storeRoot: root,
    cwd: "/work/demo",
    now: () => Date.parse(NOW),
    json: false,
    stdout: (l: string) => out.push(l),
    stderr: (l: string) => err.push(l),
    ...(proPublicKey ? { publicKey: proPublicKey } : {}),
    ...over,
  };
}

function intercept(over: Record<string, unknown> = {}) {
  return {
    type: "intercept" as const,
    id: "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1",
    projectId: PROJECT_ID,
    sessionId: "s1",
    matchedId: "f1",
    matchedKind: "auto-capture" as const,
    normalizedCommand: "pnpm vitest --shard 2",
    tier: "t1" as const,
    action: "warn" as const,
    avoidedTokens: 4200,
    estimated: true as const,
    createdAt: NOW,
    ...over,
  };
}

function outcome(over: Record<string, unknown> = {}) {
  return {
    type: "outcome" as const,
    id: "e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2",
    projectId: PROJECT_ID,
    sessionId: "s1",
    interceptId: "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1",
    outcome: "overridden-ok" as const,
    createdAt: "2026-07-12T10:01:00.000Z",
    ...over,
  };
}

describe("mega guard mode", () => {
  it("strict without a license prints the upsell and exits 0, state unchanged", async () => {
    await seedProject("/work/demo");
    const code = await runGuardMode(baseInput({ mode: "strict" }));
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("Pro feature");
    expect(readGuardState(root, PROJECT_ID)?.mode ?? "warn").toBe("warn");
  });

  it("strict with a license writes state.mode=strict; warn always allowed", async () => {
    await seedProject("/work/demo");
    activatePro();
    expect(await runGuardMode(baseInput({ mode: "strict" }))).toBe(0);
    expect(readGuardState(root, PROJECT_ID)?.mode).toBe("strict");
    expect(await runGuardMode(baseInput({ mode: "warn" }))).toBe(0);
    expect(readGuardState(root, PROJECT_ID)?.mode).toBe("warn");
  });

  it("rejects an invalid mode at the boundary", async () => {
    await seedProject("/work/demo");
    const code = await runGuardMode(baseInput({ mode: "loud" }));
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("warn|strict");
  });
});

describe("mega guard mute/unmute", () => {
  it("mute adds the id; unmute clears both mutedIds and autoMuted strikes", async () => {
    await seedProject("/work/demo");
    await runGuardMute(baseInput({ failureId: "f1", unmute: false }));
    expect(readGuardState(root, PROJECT_ID)?.mutedIds).toContain("f1");
    await runGuardMute(baseInput({ failureId: "f1", unmute: true }));
    const st = readGuardState(root, PROJECT_ID);
    expect(st?.mutedIds).not.toContain("f1");
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    expect(st?.autoMuted["f1"]).toBeUndefined();
  });
});

describe("mega guard status", () => {
  it("prints mode, this-month intercept counts, override counts, and mutes", async () => {
    await seedProject("/work/demo");
    appendGuardEvent({ root }, intercept());
    appendGuardEvent(
      { root },
      intercept({ id: "e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3", matchedId: "f2" }),
    );
    appendGuardEvent({ root }, outcome());
    await runGuardStatus(baseInput({}));
    const text = out.join("\n");
    expect(text).toContain("mode: warn");
    expect(text).toContain("intercepts this month: 2");
    expect(text).toContain("overridden: 1");
  });
});
