import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type OverlaySessionTokenSaverStats,
  createJsonDirectoryCoreRegistry,
  initStore,
} from "@megasaver/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAuditSession } from "../../src/commands/audit/session.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_A = "workspace-aaa";
const WORKSPACE_B = "workspace-bbb";
const OVERLAY_ID = "1af7f8f0-2b3c-4d5e-8f60-718293a4b5c6";
const REGISTERED_ID = "22222222-2222-4222-8222-222222222222";
const TS = "2026-07-03T12:00:00.000Z";

let root: string;
const lines: string[] = [];
const stdout = (l: string) => lines.push(l);
const stderr = (l: string) => lines.push(l);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-cli-session-overlay-"));
  lines.length = 0;
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function env() {
  return {
    storeFlag: root,
    cwd: root,
    home: root,
    xdgDataHome: undefined as string | undefined,
    platform: process.platform as NodeJS.Platform,
    localAppData: undefined as string | undefined,
  };
}

function overlaySummary(
  liveSessionId: string,
  overrides: Partial<OverlaySessionTokenSaverStats> = {},
): OverlaySessionTokenSaverStats {
  return {
    liveSessionId,
    eventsTotal: 5,
    rawBytesTotal: 90650,
    returnedBytesTotal: 17157,
    bytesSavedTotal: 73493,
    savingRatio: 0.811,
    secretsRedactedTotal: 2,
    chunksStoredTotal: 3,
    updatedAt: TS,
    ...overrides,
  };
}

function writeOverlaySummary(workspaceKey: string, summary: OverlaySessionTokenSaverStats): void {
  const dir = join(root, "stats", workspaceKey);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${summary.liveSessionId}.json`), JSON.stringify(summary), "utf8");
}

async function seedRegisteredSession(): Promise<void> {
  await initStore(root);
  const registry = createJsonDirectoryCoreRegistry({ rootDir: root });
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: root,
    createdAt: TS,
    updatedAt: TS,
  } as never);
  registry.createSession({
    id: REGISTERED_ID,
    projectId: PROJECT_ID,
    agentId: "claude-code",
    riskLevel: "medium",
    title: "demo session",
    startedAt: TS,
    endedAt: null,
  } as never);
}

describe("mega audit session — overlay fallback", () => {
  it("renders the overlay card (not 'not found') when only an overlay summary exists", async () => {
    await initStore(root);
    writeOverlaySummary(WORKSPACE_A, overlaySummary(OVERLAY_ID));

    const code = await runAuditSession({
      sessionId: OVERLAY_ID,
      ...env(),
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    const out = lines.join("\n");
    expect(out).not.toContain("not found");
    expect(out).toContain("overlay");
    expect(out).toContain("73493");
    expect(out).toContain("81");
    expect(out).toContain(WORKSPACE_A);
  });

  it("--json emits the overlay summary when only an overlay summary exists", async () => {
    await initStore(root);
    writeOverlaySummary(WORKSPACE_A, overlaySummary(OVERLAY_ID));

    const code = await runAuditSession({
      sessionId: OVERLAY_ID,
      ...env(),
      stdout,
      stderr,
      json: true,
    });

    expect(code).toBe(0);
    const parsed = JSON.parse(lines.join("\n")) as OverlaySessionTokenSaverStats & {
      source: string;
    };
    expect(parsed.source).toBe("overlay");
    expect(parsed.liveSessionId).toBe(OVERLAY_ID);
    expect(parsed.bytesSavedTotal).toBe(73493);
    expect(parsed.savingRatio).toBeCloseTo(0.811, 10);
  });

  it("resolves the overlay summary across multiple workspaces deterministically", async () => {
    await initStore(root);
    writeOverlaySummary(WORKSPACE_B, overlaySummary(OVERLAY_ID, { bytesSavedTotal: 111 }));
    writeOverlaySummary(WORKSPACE_A, overlaySummary(OVERLAY_ID, { bytesSavedTotal: 73493 }));

    const code = await runAuditSession({
      sessionId: OVERLAY_ID,
      ...env(),
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    const out = lines.join("\n");
    expect(out).toContain(WORKSPACE_A);
    expect(out).toContain("73493");
  });

  it("uses the registered card (fallback not taken) when a registered session exists", async () => {
    await seedRegisteredSession();
    // An overlay summary for a DIFFERENT id must not shadow the registered path.
    writeOverlaySummary(WORKSPACE_A, overlaySummary(OVERLAY_ID));

    const code = await runAuditSession({
      sessionId: REGISTERED_ID,
      ...env(),
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    const out = lines.join("\n");
    expect(out).not.toContain("overlay");
    expect(out).toContain("window:");
  });

  it("keeps 'session not found' (exit 1) when neither registered nor overlay exists", async () => {
    await initStore(root);

    const code = await runAuditSession({
      sessionId: OVERLAY_ID,
      ...env(),
      stdout,
      stderr,
    });

    expect(code).toBe(1);
    expect(lines.join("\n")).toContain(`session "${OVERLAY_ID}" not found`);
  });
});
