import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { computeDiff } from "./diff.ts";
import { ConventionsError } from "./errors.ts";
import type { ConsumerSpec, Mode } from "./manifest.ts";
import { parseFile } from "./parse.ts";
import { applyBlocks, renderBlock } from "./render.ts";
import { resolveSource } from "./source.ts";

export type SyncReport = {
  readonly consumerId: string;
  readonly path: string;
  readonly status: "ok" | "drift" | "wrote" | "error";
  readonly diff: string;
  readonly error?: ConventionsError;
};

export type SyncResult = {
  readonly mode: Mode;
  readonly reports: readonly SyncReport[];
  readonly status: "ok" | "drift" | "error";
};

export type SyncInput = {
  readonly mode: Mode;
  readonly repoRoot: string;
  readonly conventionsDir: string;
  readonly consumers: readonly ConsumerSpec[];
};

export async function runSync(input: SyncInput): Promise<SyncResult> {
  const reports: SyncReport[] = [];
  for (const consumer of input.consumers) {
    const report = await syncOne(input, consumer);
    reports.push(report);
  }
  const hasError = reports.some((r) => r.status === "error");
  const hasDrift = reports.some((r) => r.status === "drift");
  const status: SyncResult["status"] = hasError ? "error" : hasDrift ? "drift" : "ok";
  return { mode: input.mode, reports, status };
}

async function syncOne(input: SyncInput, consumer: ConsumerSpec): Promise<SyncReport> {
  const fullPath = join(input.repoRoot, consumer.path);
  let original: string;
  try {
    original = await readFile(fullPath, "utf8");
  } catch {
    return {
      consumerId: consumer.id,
      path: consumer.path,
      status: "error",
      diff: "",
      error: new ConventionsError("consumer-missing", `cannot read ${fullPath}`),
    };
  }
  const normalized = original.replace(/\r\n/g, "\n");
  let parsed: ReturnType<typeof parseFile>;
  try {
    parsed = parseFile(normalized);
  } catch (err) {
    if (err instanceof ConventionsError) {
      return {
        consumerId: consumer.id,
        path: consumer.path,
        status: "error",
        diff: "",
        error: err,
      };
    }
    throw err;
  }

  const renders = new Map<string, string>();
  for (const blockSpec of consumer.blocks) {
    const parsedBlock = parsed.blocks.find((b) => b.id === blockSpec.id);
    if (!parsedBlock) {
      return {
        consumerId: consumer.id,
        path: consumer.path,
        status: "error",
        diff: "",
        error: new ConventionsError(
          "block-malformed",
          `consumer "${consumer.id}" expects block "${blockSpec.id}" but none was found in ${consumer.path}`,
        ),
      };
    }
    let body: string;
    try {
      body = await resolveSource({
        conventionsDir: input.conventionsDir,
        source: blockSpec.source,
        fragment: blockSpec.fragment,
      });
    } catch (err) {
      if (err instanceof ConventionsError) {
        return {
          consumerId: consumer.id,
          path: consumer.path,
          status: "error",
          diff: "",
          error: err,
        };
      }
      throw err;
    }
    renders.set(blockSpec.id, renderBlock(blockSpec, body));
  }

  const expected = applyBlocks(parsed, renders);
  if (expected === normalized) {
    return { consumerId: consumer.id, path: consumer.path, status: "ok", diff: "" };
  }

  if (input.mode === "write") {
    await writeFile(fullPath, expected);
    return { consumerId: consumer.id, path: consumer.path, status: "wrote", diff: "" };
  }

  // Diff order: on-disk content as the "removed" side (-), canonical as the
  // "added" side (+). Operator sees what to change to reach sync.
  const diff = computeDiff(normalized, expected, consumer.path);
  return { consumerId: consumer.id, path: consumer.path, status: "drift", diff };
}
