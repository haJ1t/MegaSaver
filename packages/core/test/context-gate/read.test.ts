import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createJsonDirectoryCoreRegistry,
  resolveEffectiveSettings,
  runTwoGates,
} from "../../src/index.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const TS = "2026-05-10T00:00:00.000Z";

type SeedOpts = { withTokenSaver?: boolean };

async function seed(store: string, projectRoot: string, opts: SeedOpts = {}): Promise<void> {
  await mkdir(store, { recursive: true });
  await writeFile(
    join(store, "projects.json"),
    JSON.stringify([
      { id: PROJECT_ID, name: "demo", rootPath: projectRoot, createdAt: TS, updatedAt: TS },
    ]),
  );
  const session: Record<string, unknown> = {
    id: SESSION_ID,
    projectId: PROJECT_ID,
    agentId: "claude-code",
    riskLevel: "medium",
    title: "demo session",
    startedAt: TS,
    endedAt: null,
  };
  if (opts.withTokenSaver !== false) {
    session.tokenSaver = {
      enabled: true,
      mode: "aggressive",
      maxReturnedBytes: 4_000,
      storeRawOutput: false,
      redactSecrets: true,
      autoRepair: true,
      createdAt: TS,
      updatedAt: TS,
    };
  }
  await writeFile(join(store, "sessions.json"), JSON.stringify([session]));
}

describe("resolveEffectiveSettings", () => {
  let store: string;
  let projectRoot: string;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-read-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-read-root-"));
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("returns defaults for a pre-AA session (tokenSaver undefined)", async () => {
    await seed(store, projectRoot, { withTokenSaver: false });
    const registry = createJsonDirectoryCoreRegistry({ rootDir: store });

    const settings = resolveEffectiveSettings(registry, SESSION_ID as SessionId);
    expect(settings).not.toBeNull();
    expect(settings?.mode).toBe("balanced");
    expect(settings?.maxReturnedBytes).toBeUndefined();
    expect(settings?.storeRawOutput).toBe(true);
    expect(settings?.projectRoot).toBe(projectRoot);
  });

  it("reflects the stored tokenSaver settings when present", async () => {
    await seed(store, projectRoot);
    const registry = createJsonDirectoryCoreRegistry({ rootDir: store });

    const settings = resolveEffectiveSettings(registry, SESSION_ID as SessionId);
    expect(settings?.mode).toBe("aggressive");
    expect(settings?.maxReturnedBytes).toBe(4_000);
    expect(settings?.storeRawOutput).toBe(false);
  });

  it("returns null for a missing session", async () => {
    await seed(store, projectRoot);
    const registry = createJsonDirectoryCoreRegistry({ rootDir: store });

    const settings = resolveEffectiveSettings(
      registry,
      "99999999-9999-4999-8999-999999999999" as SessionId,
    );
    expect(settings).toBeNull();
  });
});

describe("runTwoGates", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-gates-root-"));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("gate A denies a .env path before the sandbox resolver runs", () => {
    const gate = runTwoGates({
      path: join(projectRoot, ".env"),
      projectId: PROJECT_ID as never,
      projectRoot,
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.code).toBe("path_denied");
      if (gate.code === "path_denied") expect(gate.reason).toBe("secret_path_read");
    }
  });

  it("gate B rejects a ../ sandbox escape", () => {
    const gate = runTwoGates({
      path: "../../../../../../etc/hosts",
      projectId: PROJECT_ID as never,
      projectRoot,
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.code).toBe("path_unsafe");
  });

  it("allows an in-sandbox path and returns the absolute path", () => {
    const gate = runTwoGates({
      path: join(projectRoot, "log.txt"),
      projectId: PROJECT_ID as never,
      projectRoot,
    });
    expect(gate.ok).toBe(true);
    if (gate.ok) expect(gate.absolute).toBe(join(projectRoot, "log.txt"));
  });
});
