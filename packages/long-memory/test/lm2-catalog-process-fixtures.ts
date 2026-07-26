import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Lm1Record } from "../src/lm1-model.js";

const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
const repositoryDirectory = fileURLToPath(new URL("../../..", import.meta.url));
const catalogChild = fileURLToPath(new URL("./fixtures/lm2-catalog-child.ts", import.meta.url));
const tsxCli = join(
  repositoryDirectory,
  "node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/cli.mjs",
);

export function holdCatalogLock(path: string): Promise<() => Promise<void>> {
  const script = [
    'import { closeSync, openSync } from "node:fs";',
    'import { flockSync } from "fs-ext";',
    'const descriptor = openSync(process.argv[1], "a+", 0o600);',
    'flockSync(descriptor, "exnb");',
    'process.stdout.write("locked\\n");',
    'process.stdin.once("data", () => { closeSync(descriptor); process.exit(0); });',
  ].join("\n");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", script, path], {
      cwd: packageDirectory,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    let stdout = "";
    let locked = false;
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      const separator = stdout.indexOf("\n");
      if (locked || separator === -1) return;
      if (stdout.slice(0, separator).replace(/\r$/u, "") !== "locked") {
        reject(new Error(`Catalog lock child did not acquire lock: ${stderr}`));
        return;
      }
      locked = true;
      resolve(
        () =>
          new Promise<void>((release, rejectRelease) => {
            child.once("error", rejectRelease);
            child.once("close", (code) => {
              if (code === 0) release();
              else rejectRelease(new Error(stderr));
            });
            child.stdin.end("release\n");
          }),
      );
    });
  });
}

export function runCatalogChild(
  root: string,
  record: Lm1Record,
  mode: "append" | "append-with-anchor-close-failure" = "append",
): Promise<boolean> {
  const encoded = Buffer.from(JSON.stringify({ mode, storeRoot: root, record })).toString(
    "base64url",
  );
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxCli, catalogChild, encoded], {
      cwd: packageDirectory,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) reject(new Error(stderr));
      else resolve((JSON.parse(stdout.trim()) as { result: boolean }).result);
    });
  });
}

export function startBarrierAppender(
  root: string,
  record: Lm1Record,
): Promise<() => Promise<boolean>> {
  const encoded = Buffer.from(
    JSON.stringify({ mode: "append-after-barrier", storeRoot: root, record }),
  ).toString("base64url");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxCli, catalogChild, encoded], {
      cwd: packageDirectory,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let ready = false;
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      const separator = stdout.indexOf("\n");
      if (ready || separator === -1) return;
      if (stdout.slice(0, separator).replace(/\r$/u, "") !== "ready") {
        reject(new Error(`Catalog appender did not reach barrier: ${stderr}`));
        return;
      }
      ready = true;
      resolve(
        () =>
          new Promise<boolean>((finish, rejectFinish) => {
            child.once("error", rejectFinish);
            child.once("close", (code) => {
              if (code !== 0) rejectFinish(new Error(stderr));
              else {
                finish(
                  (JSON.parse(stdout.slice(separator + 1).trim()) as { result: boolean }).result,
                );
              }
            });
            child.stdin.end("go\n");
          }),
      );
    });
  });
}

export function startSignaledAppender(
  root: string,
  record: Lm1Record,
  mode:
    | "append-observe-flock"
    | "append-pause-after-flock"
    | "append-pause-before-publish"
    | "replace-lock-and-append",
  signal: string,
  gatePath?: string,
): Promise<() => Promise<boolean>> {
  const encoded = Buffer.from(JSON.stringify({ mode, storeRoot: root, record, gatePath })).toString(
    "base64url",
  );
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxCli, catalogChild, encoded], {
      cwd: packageDirectory,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let signaled = false;
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    const completed = new Promise<boolean>((finish, rejectFinish) => {
      child.once("error", rejectFinish);
      child.once("close", (code) => {
        if (code !== 0) {
          rejectFinish(new Error(stderr));
          return;
        }
        const separator = stdout.indexOf("\n");
        if (separator === -1) {
          rejectFinish(new Error(`Catalog appender omitted result: ${stderr}`));
          return;
        }
        const result = stdout.slice(separator + 1).trim();
        finish((JSON.parse(result) as { result: boolean }).result);
      });
    });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      const separator = stdout.indexOf("\n");
      if (
        signaled ||
        separator === -1 ||
        stdout.slice(0, separator).replace(/\r$/u, "") !== signal
      ) {
        return;
      }
      signaled = true;
      resolve(() => completed);
    });
  });
}
