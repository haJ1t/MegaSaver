import { isMainThread } from "node:worker_threads";
import { recordTaskKickoffProcessEntry } from "./hooks/task-kickoff-deadline.js";

if (isMainThread) {
  recordTaskKickoffProcessEntry();
  // Handle --worker --on-demand one-shot worker entry (spawned by on-demand path)
  if (process.argv.includes("--worker") && process.argv.includes("--on-demand")) {
    const { runOnDemandWorker } = await import("./core/worker.js");
    const code = await runOnDemandWorker({
      bundlePath: process.argv[1] ?? "",
      stdin: process.stdin,
      stdout: process.stdout,
    });
    process.exit(code);
  }
  // On-demand gate: check flag before dispatch
  const hasOnDemand = process.argv.includes("--on-demand");
  const hasDaemon = process.argv.includes("--daemon");
  if (
    hasOnDemand ||
    hasDaemon ||
    process.argv.some((a) => a.startsWith("--on-demand") || a.startsWith("--daemon"))
  ) {
    const { isOnDemandAllowed } = await import("@megasaver/policy");
    const { readMegaConfig, resolveCoreMode } = await import("./config.js");
    const cfg = readMegaConfig(
      process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: HOME/USERPROFILE index signature requires bracket
      process.env["HOME"] ?? process.env["USERPROFILE"] ?? "",
    );
    const coreMode = resolveCoreMode({
      ...(hasOnDemand ? { flagOnDemand: true } : {}),
      ...(hasDaemon ? { flagDaemon: true } : {}),
      config: cfg,
    });
    if (coreMode === "on-demand") {
      // Derive cmd key from argv: first non-flag, non-node args
      const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
      const cmd = args[0] ? `${args[0]}${args[1] ? `:${args[1]}` : ""}` : "";
      // Normalize: sessions live → sessions:live, context yield → context:yield etc
      const normalized = cmd.replace(" ", ":");
      if (normalized && !isOnDemandAllowed(normalized) && !isOnDemandAllowed(cmd)) {
        // Check both forms
        const allowed =
          isOnDemandAllowed(normalized) ||
          isOnDemandAllowed(cmd) ||
          isOnDemandAllowed(args.join(":"));
        if (!allowed) {
          console.error(
            `error: ${cmd || "this command"} requires daemon (run mega daemon start or omit --on-demand)`,
          );
          process.exit(1);
        }
      }
    }
  }
  const [{ runMain }, { mainCommand }] = await Promise.all([import("citty"), import("./main.js")]);
  runMain(mainCommand);
} else {
  await import("./hooks/task-kickoff-worker.js");
}
