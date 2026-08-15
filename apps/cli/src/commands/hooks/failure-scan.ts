import { defineCommand } from "citty";
import { runFailureScanHookFromProcess } from "../../hooks/failure-scan-run.js";
import { readStoreEnv, resolveStorePath } from "../../store.js";

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

// The command the monitor's Stop hook invokes. SAFETY: ALWAYS exits 0; prints
// nothing on any error — a reminder must never break the session's Stop.
// Wired by `mega alerts --failures --enable-hook`, not run by hand.
export const hooksFailureScanCommand = defineCommand({
  meta: {
    name: "failure-scan",
    description: "Internal: warn a stopping session with unresolved failing receipts (stdin payload).",
  },
  args: {
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    let storeRoot: string;
    try {
      storeRoot = resolveStorePath(
        readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      );
    } catch {
      return; // fail-open: no resolvable store, no reminder, exit 0
    }
    await runFailureScanHookFromProcess({
      storeRoot,
      stdin: readAllStdin,
      stdout: (line) => console.log(line),
    });
  },
});
