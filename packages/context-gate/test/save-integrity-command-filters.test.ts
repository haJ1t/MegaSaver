import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMMAND_FILTER_MARKERS } from "@megasaver/output-filter";
import { redact } from "@megasaver/policy";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetchChunk } from "../src/fetch-chunk.js";
import { recordAndFilterOverlayOutput } from "../src/record-output.js";

const WK = "0123456789abcdef";
const LSID = "44444444-4444-4444-8444-444444444444";

// Copied from save-integrity.property.test.ts:88-94 — that file's warning
// comment forbids widening ITS list in place, so this suite carries its own
// copy and adds the registry's declared markers separately.
const STRUCTURAL_LINE: readonly RegExp[] = [
  /^… \[lines \d+-\d+ omitted\]$/,
  /^… \[remainder omitted — recover any part with the chunk ids below\]$/,
  /^… \[repeated \d+ times\]$/,
  /^… \[\d+ similar: .*\]$/,
  /^\[Mega Saver: compressed \d+→\d+ B .*\]$/,
];

const GIT_STATUS = [
  "On branch main",
  "Changes not staged for commit:",
  '  (use "git add <file>..." to update what will be committed)',
  ...Array.from({ length: 40 }, (_, i) => `\tmodified:   src/w4-mod-${i}.ts`),
].join("\n");

const GIT_LOG = Array.from({ length: 120 }, (_, i) => `${(0x1abc000 + i * 7919).toString(16).padStart(7, "0")} feat(core): change ${i}`).join("\n");

const DOCKER_PS = [
  "CONTAINER ID   IMAGE          COMMAND                  CREATED       STATUS       PORTS                    NAMES",
  "3f8a12bc9d01   postgres:16    \"docker-entrypoint.s…\"   2 hours ago   Up 2 hours   0.0.0.0:8080->8080/tcp   ms-db",
  ...Array.from(
    { length: 40 },
    (_, i) => `aa00000000${i}0   app:latest      \"docker-entrypoint.s…\"   2 hours ago   Up 2 hours   0.0.0.0:8080->8080/tcp   app-${i}`,
  ),
  "9c7b44de0e21   redis:7         \"docker-entrypoint.s…\"   2 hours ago   Up 2 hours   0.0.0.0:6379->6379/tcp   ms-cache",
].join("\n");

const KUBECTL_GET = [
  "NAME                        READY   STATUS             RESTARTS     AGE",
  ...Array.from(
    { length: 60 },
    (_, i) => `api-7f9c65d4b8-${i}xkp       1/1     Running            0            3d2h`,
  ),
  "queue-5f6d7c8b9d-a1b2c      1/1     Running            6 (12m ago)  3d2h",
  "worker-6b7d9c5f4d-9qwzr    0/1     CrashLoopBackOff   12           3d2h",
  "ingest-5d8f7b6c9d-tk2lm    0/1     Pending            0            14m",
].join("\n");

const GH_PR_LIST = Array.from(
  { length: 120 },
  (_, i) => `${100 + i}\tfix: flaky retry in saver ${i}\tfix/flaky-${i}\tOPEN\t2026-08-0${(i % 6) + 1}T10:00:00Z`,
).join("\n");

const NPM_INSTALL = [
  "Lockfile is up to date, resolution step is skipped",
  "Packages: +1247",
  ...Array.from(
    { length: 100 },
    (_, i) => `Progress: resolved ${i * 30}, reused ${i * 28}, downloaded ${i}, added ${i * 30}`,
  ),
  "Progress: resolved 1247, reused 1180, downloaded 67, added 1247, done",
  " WARN  deprecated glob@7.2.3",
  "Done in 24.8s",
].join("\n");

const PIP_INSTALL = [
  "Collecting requests==2.32.3",
  "  Downloading requests-2.32.3-py3-none-any.whl (64 kB)",
  ...Array.from(
    { length: 60 },
    (_, i) =>
      `Requirement already satisfied: dep-${i} in ./venv/lib/python3.12/site-packages (1.0.${i})`,
  ),
  "Installing collected packages: urllib3, requests",
  "Successfully installed requests-2.32.3 urllib3-2.2.2",
].join("\n");

const WARN_BLOCK = [
  "warning: unused variable: `retries`",
  " --> src/net/client.rs:41:9",
  "  |",
  "41 |     let retries = 3;",
  "  |",
  "  = note: `#[warn(unused_variables)]` on by default",
];
const CARGO_BUILD = [
  ...Array.from({ length: 150 }, (_, i) => `   Compiling crate-${i} v0.${i}.0`),
  ...WARN_BLOCK,
  "",
  ...WARN_BLOCK,
  "",
  "    Finished `dev` profile [unoptimized + debuginfo] target(s) in 42.17s",
].join("\n");

const DOCKER_BUILD = [
  "#1 [internal] load build definition from Dockerfile",
  "#1 transferring dockerfile: 1.24kB done",
  "#1 DONE 0.1s",
  "#3 [1/5] FROM docker.io/library/node:22-alpine",
  ...Array.from({ length: 80 }, (_, i) => `#3 sha256:${(0xabc0 + i).toString(16).padStart(12, "0")}deadbeef00 4.19MB / 4.19MB done`),
  ...Array.from({ length: 30 }, (_, i) => `#3 extracting sha256:${(0xfff0 + i).toString(16).padStart(12, "0")}cafe00 0.5s done`),
  "#3 DONE 6.4s",
  "#4 [2/5] WORKDIR /app",
  "#4 CACHED",
  "#6 [4/5] RUN corepack enable && pnpm install --frozen-lockfile",
  "#6 14.02  WARN  deprecated glob@7.2.3",
  "#6 DONE 31.2s",
  "#8 writing image sha256:1f2e3d4c5b6a7980deadbeefcafe0123 done",
  "#8 DONE 0.9s",
].join("\n");

const TERRAFORM_PLAN = [
  "Terraform will perform the following actions:",
  "",
  "  # aws_instance.web will be created",
  '  + resource "aws_instance" "web" {',
  '      + ami                     = "ami-0f1e2d3c4b5a69788"',
  '      + instance_type           = "t3.micro"',
  '      + subnet_id               = "subnet-0aa1bb2cc3dd4ee5f"',
  ...Array.from({ length: 80 }, (_, i) => `      + attribute_${i}            = (known after apply)`),
  "    }",
  "",
  "  # aws_security_group.web will be updated in-place",
  '  ~ resource "aws_security_group" "web" {',
  '      ~ description = "old" -> "new"',
  "    }",
  "",
  "Plan: 1 to add, 1 to change, 0 to destroy.",
].join("\n");

const ROWS: ReadonlyArray<{ command: string; fixture: string }> = [
  { command: "git status", fixture: GIT_STATUS },
  { command: "git log", fixture: GIT_LOG },
  { command: "docker ps", fixture: DOCKER_PS },
  { command: "kubectl get pods", fixture: KUBECTL_GET },
  { command: "gh pr list", fixture: GH_PR_LIST },
  { command: "npm install", fixture: NPM_INSTALL },
  { command: "pip install -r requirements.txt", fixture: PIP_INSTALL },
  { command: "cargo build", fixture: CARGO_BUILD },
  { command: "docker build .", fixture: DOCKER_BUILD },
  { command: "terraform plan", fixture: TERRAFORM_PLAN },
];

function trimmedLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

async function recoverAll(storeRoot: string, chunkSetId: string): Promise<string> {
  const parts: string[] = [];
  for (let i = 0; ; i += 1) {
    const res = await fetchChunk({ storeRoot, chunkSetId, chunkId: String(i) });
    if (!res.ok) break;
    parts.push(res.chunk.text);
  }
  return parts.join("\n");
}

let store: string;
beforeEach(async () => {
  store = await mkdtemp(join(tmpdir(), "cg-w4-filters-"));
});
afterEach(async () => {
  await rm(store, { recursive: true, force: true });
});

describe("W4 reconstruct-or-declare — command filters", () => {
  for (const [i, row] of ROWS.entries()) {
    it(`loses nothing and fabricates nothing for \`${row.command}\``, async () => {
      const result = await recordAndFilterOverlayOutput({
        storeRoot: store,
        workspaceKey: WK,
        liveSessionId: LSID,
        raw: row.fixture,
        sourceKind: "command",
        label: row.command,
        mode: "balanced",
        storeRawOutput: true,
        includeFooter: true,
        compressFloorBytes: 64,
        newId: () => `cs-w4-${i}`,
      });
      expect(result.decision).toBe("compressed");

      // Reconstruct: the chunk store holds the FULL redacted raw regardless
      // of which filter ran.
      const recovered = await recoverAll(store, `cs-w4-${i}`);
      const universe = `${result.returnedText}\n${recovered}`;
      const missing = trimmedLines(redact(row.fixture).redacted).filter(
        (l) => !universe.includes(l),
      );
      expect(missing.slice(0, 5), `${missing.length} line(s) unrecoverable`).toEqual([]);

      // No fabrication: delivered lines are raw lines, base structural forms,
      // or the registry's own declared markers — nothing else.
      const authentic = new Set([
        ...trimmedLines(row.fixture),
        ...trimmedLines(redact(row.fixture).redacted),
      ]);
      const invented = trimmedLines(result.returnedText.slice(result.summary.length)).filter(
        (l) =>
          !authentic.has(l) &&
          !STRUCTURAL_LINE.some((re) => re.test(l)) &&
          !COMMAND_FILTER_MARKERS.some((re) => re.test(l)),
      );
      expect(invented.slice(0, 5), `${invented.length} fabricated line(s)`).toEqual([]);
    });
  }

  it("honest naming: the git-status filter really ran through the record path", async () => {
    const result = await recordAndFilterOverlayOutput({
      storeRoot: store,
      workspaceKey: WK,
      liveSessionId: LSID,
      raw: GIT_STATUS,
      sourceKind: "command",
      label: "git status",
      mode: "balanced",
      storeRawOutput: true,
      includeFooter: true,
      compressFloorBytes: 64,
      newId: () => "cs-w4-honest",
    });
    expect(result.decision).toBe("compressed");
    expect(result.returnedText).toContain("… [1 hint lines]");
  });
});
