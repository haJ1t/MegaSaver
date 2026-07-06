import type { KeyObject } from "node:crypto";
import { writeFileSync } from "node:fs";
import { checkEntitlement } from "@megasaver/entitlement";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../../store.js";
import {
  PRO_ANALYTICS_UPSELL,
  type SavingsEventReader,
  defaultSavingsEventReader,
} from "./shared.js";

export type ExportFormat = "csv" | "json";

export type RunSavingsExportInput = {
  storeRoot: string;
  now: () => number;
  publicKey?: KeyObject | string;
  readAllEvents: SavingsEventReader;
  format: ExportFormat;
  out?: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runSavingsExport(input: RunSavingsExportInput): Promise<0 | 1> {
  const ent = checkEntitlement("savings-analytics", {
    storeRoot: input.storeRoot,
    now: input.now,
    ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
  });
  if (!ent.entitled) {
    input.stdout(PRO_ANALYTICS_UPSELL);
    return 0;
  }

  const { computeSavingsHistory, exportSavings } = await import("@megasaver/pro-analytics");

  const { events } = await input.readAllEvents();
  const rows = computeSavingsHistory(events, { bucket: "day" });
  const rendered = exportSavings(rows, input.format);

  if (input.out !== undefined) {
    writeFileSync(input.out, rendered);
    input.stdout(`Wrote savings ${input.format} to ${input.out}`);
  } else {
    input.stdout(rendered);
  }
  return 0;
}

export const savingsExportCommand = defineCommand({
  meta: {
    name: "export",
    description: "Export historical savings as CSV or JSON (Mega Saver Pro).",
  },
  args: {
    format: { type: "string", description: "csv | json (default: csv)." },
    out: { type: "string", description: "Write output to a file instead of stdout." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const rawFormat = typeof args.format === "string" ? args.format : "csv";
    if (rawFormat !== "csv" && rawFormat !== "json") {
      console.error(`error: invalid --format "${rawFormat}" (csv | json)`);
      process.exitCode = 1;
      return;
    }
    const code = await runSavingsExport({
      storeRoot: resolveStorePath(
        readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      ),
      now: () => Date.now(),
      readAllEvents: defaultSavingsEventReader(
        readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      ),
      format: rawFormat,
      ...(typeof args.out === "string" ? { out: args.out } : {}),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
