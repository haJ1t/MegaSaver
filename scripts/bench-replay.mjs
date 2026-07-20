#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
// Thin CLI over @megasaver/bench-replay. Every number reported here is decided by
// that package (and covered by its tests); this file only moves bytes, spawns
// processes, and formats. Nothing that could drift a measurement lives in here.
//
//   bench-replay.mjs record  --out <dir> --repo <dir>
//   bench-replay.mjs replay  --recordings <dir> --mode <safe|balanced|aggressive>
//
// `record` drives four real `claude -p` sessions. `replay` sends every recorded
// body to the real API twice per arm. Both spend money.
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  TASK_PROMPTS,
  assembleUsage,
  assertUncompressedRecording,
  baselineDriftSmokeOk,
  buildRecordCommand,
  buildVerdict,
  makeSpawnedSaver,
  modelHistogram,
  pooledCostRatio,
  prepareSaverStore,
  recordedRequestSchema,
  replayBothOrders,
  startCaptureProxy,
} from "../packages/bench-replay/dist/index.js";
import { normalizedCostUsd } from "../packages/stats/dist/index.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_BUFFER_BYTES = 64 * 1024 * 1024;

function fail(message) {
  console.error(`bench-replay: ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------- recordings

// The loaded file is the system boundary the schema exists for: a recording is
// written by one process and read by another, possibly after an edit, a partial
// write, or a tool that reformatted it. Parsing here is what turns a corrupt
// recording into a loud failure instead of a plausible-looking cost number.
function loadRecording(taskDir) {
  const files = readdirSync(taskDir)
    .filter((name) => /^req-\d+\.json$/.test(name))
    // Numeric, not lexicographic: the zero-padding only holds to 999, and replay
    // order decides the entire prompt-cache pattern being measured.
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  if (files.length === 0) fail(`no req-*.json files in ${taskDir}`);

  return files.map((name) => {
    const path = join(taskDir, name);
    let raw;
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch (cause) {
      fail(`${path} is not valid JSON: ${cause.message}`);
    }
    const parsed = recordedRequestSchema.safeParse(raw);
    if (!parsed.success) {
      fail(`${path} is not a valid recorded /v1/messages body: ${parsed.error.message}`);
    }
    return parsed.data;
  });
}

function taskDirs(recordingsRoot) {
  if (!existsSync(recordingsRoot)) fail(`recordings directory ${recordingsRoot} does not exist`);
  const dirs = readdirSync(recordingsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^task_\d+$/.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  if (dirs.length === 0) fail(`no task_N directories in ${recordingsRoot}`);
  return dirs;
}

// ---------------------------------------------------------------- bench repo

const BENCH_REPO_FILES = {
  "package.json": `{
  "name": "megasaver-claude-limit-test-repo",
  "version": "1.0.0",
  "type": "module",
  "scripts": { "dev": "vite", "server": "node server.js" },
  "dependencies": { "express": "^4.19.2", "react": "^18.3.1", "react-dom": "^18.3.1" },
  "devDependencies": { "@vitejs/plugin-react": "^4.3.1", "vite": "^5.3.4" }
}
`,
  "server.js": `import express from 'express';
const app = express();
app.use(express.json());
let events = [{ id: 1, title: 'Demo event', date: '2026-07-14' }];
app.get('/api/events', (_req, res) => res.json(events));
app.post('/api/events', (req, res) => {
  const { title, date } = req.body;
  const event = { id: Date.now(), title, date };
  events.push(event);
  res.status(201).json(event);
});
app.delete('/api/events/:id', (req, res) => {
  const id = Number(req.params.id);
  const before = events.length;
  events = events.filter(e => e.id !== id);
  res.json({ deleted: before - events.length });
});
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(\`Server on http://localhost:\${PORT}\`));
`,
  "index.html": `<!doctype html><html lang="en"><head><meta charset="UTF-8"/><title>Events</title></head>
<body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>
`,
  "src/main.jsx": `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
ReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
`,
  "src/App.jsx": `import { useEffect, useState } from 'react';
import './App.css';
const API = 'http://localhost:3001/api/events';
export default function App() {
  const [events, setEvents] = useState([]);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  async function load() { const res = await fetch(API); setEvents(await res.json()); }
  useEffect(() => { load(); }, []);
  async function add(e) {
    e.preventDefault();
    await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, date }) });
    setTitle(''); setDate(''); load();
  }
  async function remove(id) {
    await fetch(\`\${API}/\${id}\`, { method: 'DELETE' });
    // Bug: list is not refreshed after delete.
  }
  return (
    <div className="app">
      <h1>Events</h1>
      <form onSubmit={add}>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title" required />
        <input value={date} onChange={e => setDate(e.target.value)} placeholder="YYYY-MM-DD" required />
        <button type="submit">Add</button>
      </form>
      <ul>
        {events.map(ev => (
          <li key={ev.id}>{ev.title} ({ev.date}) <button onClick={() => remove(ev.id)}>Delete</button></li>
        ))}
      </ul>
    </div>
  );
}
`,
  "src/App.css": `.app { font-family: system-ui, sans-serif; max-width: 400px; margin: 2rem auto; }
form { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
input { flex: 1; padding: 0.4rem; }
ul { list-style: none; padding: 0; }
li { display: flex; justify-content: space-between; padding: 0.4rem 0; border-bottom: 1px solid #ddd; }
`,
  ".gitignore": `node_modules
dist
.env
`,
};

// Deliberately does NOT run `mega init`: that enables the workspace saver, and a
// recording must be captured with the saver off. (`--setting-sources ""` already
// keeps `mega hooks` from being installed at all — this is the second lock.)
function setupBenchRepo(repoDir) {
  rmSync(repoDir, { recursive: true, force: true });
  mkdirSync(join(repoDir, "src"), { recursive: true });
  for (const [rel, content] of Object.entries(BENCH_REPO_FILES)) {
    writeFileSync(join(repoDir, rel), content);
  }
  const git = (...args) => execFileSync("git", args, { cwd: repoDir, encoding: "utf8" });
  console.log(`Installing bench repo dependencies in ${repoDir} ...`);
  execFileSync("npm", ["install", "--quiet"], {
    cwd: repoDir,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER_BYTES,
  });
  git("init", "--quiet");
  git("add", ".");
  git("commit", "-m", "chore: baseline event planner", "--quiet");
  return git("rev-parse", "HEAD").trim();
}

// ------------------------------------------------------------------- record

async function record(values) {
  const outRoot = values.out;
  const repoDir = values.repo;
  const claudeBin = values["claude-bin"];

  const baselineCommit = setupBenchRepo(repoDir);

  for (const [index, prompt] of TASK_PROMPTS.entries()) {
    const task = `task_${index + 1}`;
    const outDir = join(outRoot, task);
    rmSync(outDir, { recursive: true, force: true });

    const proxy = await startCaptureProxy({ port: 0, upstream: values.upstream, outDir });
    let result;
    try {
      execFileSync("git", ["reset", "--hard", baselineCommit, "--quiet"], { cwd: repoDir });
      execFileSync("git", ["clean", "-fd", "--quiet"], { cwd: repoDir });

      const command = buildRecordCommand({
        claudeBin,
        prompt,
        repoDir,
        proxyUrl: proxy.url,
        baseEnv: process.env,
      });
      console.log(`=== recording ${task} via ${proxy.url} ===`);
      result = spawnSync(command.bin, [...command.args], {
        cwd: repoDir,
        env: command.env,
        encoding: "utf8",
        maxBuffer: MAX_BUFFER_BYTES,
      });
    } finally {
      await proxy.stop();
    }

    if (result.error) fail(`${task}: could not run ${claudeBin}: ${result.error.message}`);
    if (result.status !== 0) {
      fail(`${task}: ${claudeBin} exited ${result.status}: ${String(result.stderr).slice(0, 500)}`);
    }

    // The end-to-end result is this conversation's OWN cost reference, so a
    // recording without a usable one is only half a recording. Validated before
    // it is written rather than left to blow up during replay.
    let endToEnd;
    try {
      endToEnd = JSON.parse(result.stdout);
    } catch (cause) {
      fail(`${task}: claude --output-format json did not emit JSON: ${cause.message}`);
    }
    if (endToEnd.is_error)
      fail(`${task}: the recording session failed: ${String(endToEnd.result).slice(0, 300)}`);
    if (!endToEnd.usage) fail(`${task}: the recording session emitted no usage block`);
    writeFileSync(join(outDir, "end-to-end.json"), `${JSON.stringify(endToEnd, null, 2)}\n`);

    // Fail here, not at replay time: a contaminated recording is cheap to redo
    // now and expensive to discover after four tasks of API spend.
    assertUncompressedRecording(loadRecording(outDir));

    console.log(
      `  ${task}: ${proxy.count()} requests recorded, ${endToEnd.num_turns ?? "?"} turns, reference cost $${normalizedCostUsd(endToEnd.usage).toFixed(6)}`,
    );
  }

  console.log(`\nRecordings written to ${outRoot}`);
}

// ------------------------------------------------------------------- replay

function makeSender(baseUrl, apiKey) {
  return async (body) => {
    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      // Sent exactly as prepared: `"stream": true` stays as recorded (flipping it
      // would change what the API bills and make the replay a different request),
      // and `max_tokens` was already capped identically on both arms upstream in
      // prepareArms — nothing that participates in the prompt-cache key differs
      // from the recording.
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      // Response body only — the request headers carry the API key and must
      // never reach a log line.
      throw new Error(`send: HTTP ${response.status} from /v1/messages: ${text.slice(0, 400)}`);
    }
    return assembleUsage({ contentType: response.headers.get("content-type") ?? "", body: text });
  };
}

function referenceCostUsd(taskDir) {
  const path = join(taskDir, "end-to-end.json");
  if (!existsSync(path)) return null;
  const usage = JSON.parse(readFileSync(path, "utf8")).usage;
  return usage ? normalizedCostUsd(usage) : null;
}

async function replay(values) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    fail("ANTHROPIC_API_KEY is not set — replay talks to the real API and cannot authenticate");
  }

  const send = makeSender(values["base-url"], apiKey);
  const orderTolerance = Number(values["order-tolerance"]);
  const driftTolerance = Number(values["drift-tolerance"]);
  const verdicts = [];

  for (const task of taskDirs(values.recordings)) {
    const taskDir = join(values.recordings, task);
    const requests = loadRecording(taskDir);
    assertUncompressedRecording(requests);

    // A FRESH store per task and per invocation. The saver's seen-hash ledger and
    // its auto-pause verdict both persist, so a store carried over from an earlier
    // replay would have the megasaver arm skipping work it did last time — the
    // exact carry-over that made the previous benchmark round meaningless.
    const storeRoot = mkdtempSync(join(tmpdir(), `bench-replay-${task}-`));
    prepareSaverStore({
      megaBin: values["mega-bin"],
      cwd: values.repo,
      storeRoot,
      mode: values.mode,
    });
    const applySaver = makeSpawnedSaver({
      megaBin: values["mega-bin"],
      cwd: values.repo,
      sessionId: randomUUID(),
      storeRoot,
    });

    console.log(`=== replaying ${task} (${requests.length} requests, mode ${values.mode}) ===`);
    printModelHistogram(requests);
    const base = await replayBothOrders({
      task,
      requests,
      applySaver,
      send,
      orderTolerance,
    });

    // The drift check needs the replayed cost, which only exists after the
    // replay, so the verdict is rebuilt through its one constructor with the
    // order check carried over rather than re-derived. The drift reference is a
    // single end-to-end run, so it is compared against the FIRST pair's baseline
    // arm — and printVerdict says which pair that is.
    const realBaselineUsd = referenceCostUsd(taskDir);
    const driftBaselineUsd = base.pairs[0].baseline.normalizedCostUsd;
    // The order check is NOT carried over — `buildVerdict` re-derives it from the
    // pairs passed here, so the reported ratio and the arms shown beside it
    // cannot come from different data. Only the tolerance crosses.
    const verdict =
      realBaselineUsd === null
        ? base
        : buildVerdict(task, base.pairs, base.transform, {
            orderTolerance,
            baselineDriftSmoke: {
              ok: baselineDriftSmokeOk({
                replayedBaselineUsd: driftBaselineUsd,
                realBaselineUsd,
                tolerance: driftTolerance,
              }),
              tolerance: driftTolerance,
            },
          });
    verdicts.push({ verdict, realBaselineUsd });
    printVerdict(verdict, realBaselineUsd);
  }

  printPooled(verdicts.map((v) => v.verdict));
}

// -------------------------------------------------------------------- output

const usd = (n) => `$${n.toFixed(6)}`;
const int = (n) => n.toLocaleString("en-US");

function printArm(arm) {
  console.log(
    `  ${arm.arm.padEnd(9)} input=${int(arm.inputTokens)} cache_creation=${int(arm.cacheCreationTokens)} ` +
      `cache_read=${int(arm.cacheReadTokens)} output=${int(arm.outputTokens)} cost=${usd(arm.normalizedCostUsd)} ` +
      `wall=${((arm.finishedAtMs - arm.startedAtMs) / 1000).toFixed(1)}s`,
  );
  for (const [i, r] of arm.perRequest.entries()) {
    console.log(
      `    req ${String(i + 1).padStart(3)}  input=${int(r.inputTokens)} cache_creation=${int(r.cacheCreationTokens)} ` +
        `cache_read=${int(r.cacheReadTokens)} output=${int(r.outputTokens)}`,
    );
  }
}

// Every /v1/messages call the agent made is in the recording, including Claude
// Code's sidecar Haiku calls, and normalizedCostUsd prices them all at ONE rate
// card. Those calls carry no tool_result, so they are byte-identical in both arms
// and drag the ratio toward 1.00 while priced at ~6x their true cost. Printed
// rather than corrected: the direction is conservative and a reader who can see
// the split can bound the dilution, whereas repricing means per-model rate cards
// inside a cost function three other benchmarks share.
function printModelHistogram(requests) {
  const histogram = modelHistogram(requests);
  const rows = histogram
    .map((r) => `${r.model}=${r.requests} (${((r.requests / requests.length) * 100).toFixed(1)}%)`)
    .join(" ");
  console.log(`  models: ${rows}`);
  if (histogram.length > 1) {
    console.log(
      `    NOTE: costs below price ALL ${requests.length} requests at one flat rate card` +
        ` (scripts/benchmark-rates.json), but this recording spans ${histogram.length} models.`,
    );
    console.log(
      "    Sidecar calls (titling and similar) carry no tool_result, so they are identical in both",
    );
    console.log(
      "    arms and pull the ratio toward 1.00 at inflated weight — the reported effect is therefore",
    );
    console.log("    UNDERSTATED, by at most the share above.");
  }
}

function printVerdict(verdict, realBaselineUsd) {
  console.log(`\n--- ${verdict.task} ---`);
  // Every pair, not just the first: the ratio below is the mean of all of them,
  // and a reader must be able to see the arms it came from.
  const { saver, bytes } = verdict.transform;
  console.log(
    `  saver applied=${saver.applied} passthrough=${saver.passthrough} failed=${saver.failed} tool_result bytes ${int(bytes.original)}->${int(bytes.transformed)} (one transform, replayed byte-identically by every pair)`,
  );
  for (const pair of verdict.pairs) {
    console.log(`  [${pair.order}] ratio ${pair.costRatio.toFixed(4)}x`);
    printArm(pair.baseline);
    printArm(pair.megasaver);
  }
  console.log(`  cost ratio (baseline / megasaver): ${verdict.costRatio.toFixed(4)}x`);
  console.log(
    `    SCOPE: generation was capped to max_tokens=${verdict.generationCapTokens} on BOTH arms, so the model resampled`,
  );
  console.log(
    "    nothing and the ratio above is an INPUT-SIDE comparison (input + cache_creation + cache_read).",
  );
  console.log(
    "    It is NOT an end-to-end cost comparison: the output tokens counted into it are an artifact of",
  );
  console.log(
    "    the cap, not of real generation. The saver only ever acts on the input side, which is why the",
  );
  console.log(
    "    cap is sound — it removes $25/Mtok of resampling noise that swamped the effect being measured.",
  );
  console.log(
    "    COUNTERFACTUAL TRAJECTORY: the recorded assistant turns were produced by an agent reading",
  );
  console.log(
    "    UNCOMPRESSED tool output, and the megasaver arm replays those same turns while feeding it",
  );
  console.log(
    "    COMPRESSED output. That conversation never happened. It costs the ratio nothing as an",
  );
  console.log(
    "    input-side measurement — the turn sequence is held identical across both arms, so the only",
  );
  console.log(
    "    difference priced is the bytes the saver removed — but it makes the ratio an UPPER BOUND on",
  );
  console.log(
    "    real-session savings, not an estimate: a live compressed agent can spend extra turns fetching",
  );
  console.log(
    "    elided detail (the footer advertises `mega output chunk`), and each recovery turn resends the",
  );
  console.log(
    "    whole history at full price. A frozen trajectory has zero of them. See packages/bench-replay/README.md.",
  );

  const { integrity, order, baselineDriftSmoke } = verdict.verified;
  console.log(
    `  integrity: applied=${integrity.applied}/${saver.applied + saver.passthrough} ` +
      `(fraction ${integrity.appliedFraction.toFixed(4)}) ` +
      `bytes ${int(integrity.originalBytes)}->${int(integrity.transformedBytes)} ` +
      `(byteRatio ${integrity.byteRatio.toFixed(4)}) ok=${integrity.ok}`,
  );

  if (order === null) {
    console.log("  order check: NOT RUN — the reported ratio is unverified for cache-warming bias");
  } else {
    console.log(
      `  order check: baseline-first=${order.ratioBaselineFirst.toFixed(4)}x megasaver-first=${order.ratioMegasaverFirst.toFixed(4)}x ` +
        `spread=${(order.spread * 100).toFixed(2)}% (tolerance ${(order.tolerance * 100).toFixed(0)}%) ` +
        `-> combined ${order.combinedRatio.toFixed(4)}x`,
    );
  }

  if (baselineDriftSmoke === null) {
    console.log("  drift check: NOT RUN (no end-to-end.json reference) — UNVERIFIED, not passed");
  } else {
    console.log(
      `  drift check: replayed baseline ${usd(verdict.pairs[0].baseline.normalizedCostUsd)} vs same-conversation ` +
        `end-to-end reference ${usd(realBaselineUsd)} -> ok=${baselineDriftSmoke.ok} ` +
        `(tolerance ${(baselineDriftSmoke.tolerance * 100).toFixed(0)}%)`,
    );
    console.log(
      `    SCOPE: the replayed figure is the ${verdict.pairs[0].order} pair's baseline arm alone, not the ratio above.`,
    );
    console.log(
      "    LIMITS: the reference is the SAME conversation, so this catches a stale recording, a broken",
    );
    console.log(
      "    cost model, or a mis-assembled usage stream. It CANNOT calibrate the ratio above: the reference",
    );
    console.log(
      "    run paid its own cold-cache pattern, and cache_creation vs cache_read is a 20x price difference,",
    );
    console.log(
      `    so agreement within ${(baselineDriftSmoke.tolerance * 100).toFixed(0)}% is a sanity floor, not evidence for any effect smaller than it.`,
    );
  }
}

function printPooled(verdicts) {
  const pooled = pooledCostRatio(verdicts);
  console.log("\n=== pooled ===");
  for (const v of verdicts) console.log(`  ${v.task}: ${v.costRatio.toFixed(4)}x`);
  const pooledText = Number.isFinite(pooled)
    ? `${pooled.toFixed(4)}x`
    : "n/a — a task ratio was not finite/positive";
  console.log(
    `  pooled (geometric mean of ${verdicts.length} order-combined ratios): ${pooledText}`,
  );
  console.log("  Unweighted: an expensive task counts the same as a cheap one.");

  const unverified = verdicts.filter((v) => v.verified.baselineDriftSmoke === null).length;
  const failedDrift = verdicts.filter((v) => v.verified.baselineDriftSmoke?.ok === false).length;
  if (unverified > 0)
    console.log(`  ${unverified} task(s) have NO drift reference — unverified, not passed.`);
  if (failedDrift > 0)
    console.log(
      `  ${failedDrift} task(s) FAILED the drift smoke check — treat the pooled ratio as suspect.`,
    );
}

// ---------------------------------------------------------------------- main

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string", default: "/tmp/bench-recordings" },
    recordings: { type: "string", default: "/tmp/bench-recordings" },
    repo: { type: "string", default: "/tmp/megasaver-claude-limit-test-repo" },
    upstream: { type: "string", default: "https://api.anthropic.com" },
    "base-url": { type: "string", default: "https://api.anthropic.com" },
    "claude-bin": { type: "string", default: "claude" },
    "mega-bin": { type: "string", default: "mega" },
    mode: { type: "string", default: "balanced" },
    "order-tolerance": { type: "string", default: "0.15" },
    "drift-tolerance": { type: "string", default: "0.25" },
  },
});

const command = positionals[0];
if (command === "record") await record(values);
else if (command === "replay") await replay(values);
else fail(`unknown command ${JSON.stringify(command ?? "")} — expected "record" or "replay"`);
