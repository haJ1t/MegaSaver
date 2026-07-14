import { createRequire } from "node:module";
import { defineCommand } from "citty";
import { alertsCommand } from "./commands/alerts.js";
import { auditCommand } from "./commands/audit/index.js";
import { benchCommand } from "./commands/bench.js";
import { brainCommand } from "./commands/brain/index.js";
import { cacheCommand } from "./commands/cache.js";
import { compressCommand } from "./commands/compress.js";
import { connectorCommand } from "./commands/connector/index.js";
import { contextCommand } from "./commands/context/index.js";
import { daemonCommand } from "./commands/daemon/index.js";
import { doctorCommand } from "./commands/doctor.js";
import { failCommand } from "./commands/fail/index.js";
import { firewallCommand } from "./commands/firewall.js";
import { githubCommand } from "./commands/github/index.js";
import { guiCommand } from "./commands/gui.js";
import { hooksCommand } from "./commands/hooks/index.js";
import { indexCommand } from "./commands/index/index.js";
import { initCommand } from "./commands/init.js";
import { learnCommand } from "./commands/learn.js";
import { licenseCommand } from "./commands/license.js";
import { mcpCommand } from "./commands/mcp/index.js";
import { memoryCommand } from "./commands/memory/index.js";
import { officeCommand } from "./commands/office/index.js";
import { outputCommand } from "./commands/output/index.js";
import { packCommand } from "./commands/pack/index.js";
import { projectCommand } from "./commands/project.js";
import { proxyCommand } from "./commands/proxy/index.js";
import { roiCommand } from "./commands/roi.js";
import { rulesCommand } from "./commands/rules/index.js";
import { savingsCommand } from "./commands/savings/index.js";
import { scanCommand } from "./commands/scan.js";
import { sessionCommand } from "./commands/session/index.js";
import { taskCommand } from "./commands/task/index.js";
import { teardownCommand } from "./commands/teardown.js";
import { toolsCommand } from "./commands/tools/index.js";
import { traceCommand } from "./commands/trace/index.js";
import { warmupCommand } from "./commands/warmup.js";

// Version source. The standalone single-file bundle has no sibling package.json
// to require at runtime, so tsup.bundle.config.ts defines __MEGA_CLI_VERSION__ as
// a build-time string literal; esbuild inlines it and dead-code-eliminates the
// createRequire branch. The unbundled dist/cli.js has no such define, so the
// literal is `undefined` and the version is read from the sibling package.json.
// No environment variable is consulted in either build.
declare const __MEGA_CLI_VERSION__: string | undefined;
const version =
  typeof __MEGA_CLI_VERSION__ !== "undefined"
    ? __MEGA_CLI_VERSION__
    : (createRequire(import.meta.url)("../package.json") as { version: string }).version;

export const mainCommand = defineCommand({
  meta: {
    name: "mega",
    version,
    description: "Mega Saver - ContextOps platform CLI.",
  },
  subCommands: {
    init: initCommand,
    audit: auditCommand,
    bench: benchCommand,
    brain: brainCommand,
    alerts: alertsCommand,
    cache: cacheCommand,
    doctor: doctorCommand,
    github: githubCommand,
    gui: guiCommand,
    fail: failCommand,
    firewall: firewallCommand,
    learn: learnCommand,
    license: licenseCommand,
    project: projectCommand,
    proxy: proxyCommand,
    daemon: daemonCommand,
    roi: roiCommand,
    rules: rulesCommand,
    savings: savingsCommand,
    session: sessionCommand,
    compress: compressCommand,
    connector: connectorCommand,
    memory: memoryCommand,
    office: officeCommand,
    output: outputCommand,
    mcp: mcpCommand,
    pack: packCommand,
    hooks: hooksCommand,
    scan: scanCommand,
    index: indexCommand,
    context: contextCommand,
    task: taskCommand,
    teardown: teardownCommand,
    tools: toolsCommand,
    trace: traceCommand,
    warmup: warmupCommand,
  },
});
