import fs from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";

type ChildInput = {
  mode:
    | "append"
    | "append-after-barrier"
    | "append-observe-flock"
    | "append-pause-after-flock"
    | "append-pause-before-publish"
    | "append-with-anchor-close-failure"
    | "replace-lock-and-append";
  storeRoot: string;
  record: unknown;
  gatePath?: string;
};

const encoded = process.argv[2];
if (encoded === undefined) throw new Error("Missing catalog child input.");
const input = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as ChildInput;

if (
  input.mode === "append-with-anchor-close-failure" ||
  input.mode === "append-observe-flock" ||
  input.mode === "append-pause-after-flock"
) {
  const require = createRequire(import.meta.url);
  const fsExt = require("fs-ext") as { flockSync(descriptor: number, operation: string): void };
  const actualFlock = fsExt.flockSync;
  const actualClose = fs.closeSync;
  let armed = false;
  let injected = false;
  fsExt.flockSync = (descriptor, operation) => {
    if (input.mode === "append-observe-flock" && operation.startsWith("ex") && !armed) {
      armed = true;
      process.stdout.write("flocking\n");
    }
    actualFlock(descriptor, operation);
    if (input.mode === "append-pause-after-flock" && operation.startsWith("ex") && !armed) {
      if (input.gatePath === undefined) throw new Error("Missing post-flock gate.");
      armed = true;
      process.stdout.write("flocked\n");
      const wait = new Int32Array(new SharedArrayBuffer(4));
      while (!fs.existsSync(input.gatePath)) Atomics.wait(wait, 0, 0, 10);
    }
    if (input.mode === "append-with-anchor-close-failure" && operation.startsWith("ex")) {
      armed = true;
    }
  };
  if (input.mode === "append-with-anchor-close-failure") {
    fs.closeSync = (descriptor) => {
      const directory = fs.fstatSync(descriptor).isDirectory();
      actualClose(descriptor);
      if (armed && directory && !injected) {
        injected = true;
        throw new Error("injected catalog anchor close failure");
      }
    };
  }
  syncBuiltinESMExports();
}

if (input.mode === "append-pause-before-publish") {
  if (input.gatePath === undefined) throw new Error("Missing catalog publication gate.");
  const actualOpen = fs.openSync;
  const actualFsync = fs.fsyncSync;
  const replacementDescriptors = new Set<number>();
  fs.openSync = ((path: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
    const descriptor = actualOpen(path, flags, mode);
    if (String(path).endsWith(".replace")) replacementDescriptors.add(descriptor);
    return descriptor;
  }) as typeof fs.openSync;
  fs.fsyncSync = (descriptor) => {
    actualFsync(descriptor);
    if (!replacementDescriptors.delete(descriptor)) return;
    process.stdout.write("prepared\n");
    const wait = new Int32Array(new SharedArrayBuffer(4));
    while (!fs.existsSync(input.gatePath as string)) Atomics.wait(wait, 0, 0, 10);
  };
  syncBuiltinESMExports();
}

if (input.mode === "append-after-barrier") {
  process.stdout.write("ready\n");
  await new Promise<void>((resolve) => process.stdin.once("data", () => resolve()));
}

const { createLm2CandidateCatalog } = await import("../../src/lm2-catalog.js");
if (input.mode === "replace-lock-and-append") {
  const require = createRequire(import.meta.url);
  const { flockSync } = require("fs-ext") as {
    flockSync(descriptor: number, operation: string): void;
  };
  const directory = `${input.storeRoot}/long-memory/v1/0123456789abcdef/.lm2`;
  const lock = `${directory}/candidate-catalog-v2.lock`;
  fs.renameSync(lock, `${lock}.displaced`);
  fs.writeFileSync(lock, `${"d".repeat(64)}\n`, { mode: 0o600 });
  const descriptor = fs.openSync(lock, "r+");
  flockSync(descriptor, "exnb");
  process.stdout.write("replacement-locked\n");
  const result = createLm2CandidateCatalog({ storeRoot: input.storeRoot }).appendPublished(
    input.record as never,
  );
  flockSync(descriptor, "un");
  fs.closeSync(descriptor);
  process.stdout.write(`${JSON.stringify({ result })}\n`);
} else {
  const result = createLm2CandidateCatalog({ storeRoot: input.storeRoot }).appendPublished(
    input.record as never,
  );
  process.stdout.write(`${JSON.stringify({ result })}\n`);
}
