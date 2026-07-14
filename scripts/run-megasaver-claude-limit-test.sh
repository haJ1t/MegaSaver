#!/usr/bin/env bash
# Test MegaSaver's token savings directly inside Claude Code usage limits.
# Run this script from your terminal (inside or outside a Claude session).
# It runs the same 4 coding tasks twice:
#   - WITH MegaSaver: your normal Claude settings (proxy + hooks active)
#   - WITHOUT MegaSaver: same settings but proxy removed and MegaSaver hooks stripped
# Requires: claude, git, npm, python3

set -euo pipefail

REPO=/tmp/megasaver-claude-limit-test-repo
RESULTS=/tmp/megasaver-claude-limit-test-results
DEFAULT_SETTINGS="${HOME}/.claude/settings.json"
BASELINE_SETTINGS=/tmp/claude-baseline-no-megasaver.json
MEGASAVER_SETTINGS=/tmp/claude-megasaver.json
PROXY_URL="${MEGA_PROXY_URL:-http://127.0.0.1:8787}"
CLAUDE_BIN="${CLAUDE_BIN:-$(command -v claude || true)}"

if [ -z "$CLAUDE_BIN" ] || [ ! -x "$CLAUDE_BIN" ]; then
  echo "ERROR: claude CLI not found in PATH."
  exit 1
fi

for tool in git npm python3; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "ERROR: $tool not found in PATH."
    exit 1
  fi
done

if [ ! -f "$DEFAULT_SETTINGS" ]; then
  echo "ERROR: Claude Code settings not found at $DEFAULT_SETTINGS"
  exit 1
fi

# The megasaver arm is only meaningful if the proxy is actually listening.
if ! curl -s -o /dev/null --max-time 3 "$PROXY_URL" 2>/dev/null; then
  echo "ERROR: MegaSaver proxy not reachable at $PROXY_URL"
  echo "       Start it with: mega proxy start"
  exit 1
fi
echo "Proxy reachable at $PROXY_URL (mega $(mega --version 2>/dev/null || echo '?'))"

# Task prompts (mixed workload).
TASKS=(
  "Add a date picker to the event creation form."
  "Add a completed flag to events with a toggle endpoint and UI checkbox."
  "Add rate limiting to POST /api/events so users can create at most 5 events per minute."
  "Deleting an event does not update the UI list. Find the root cause and fix it."
)

# Create isolated benchmark repo.
rm -rf "$REPO"
mkdir -p "$REPO/src"

cat > "$REPO/package.json" <<'EOF'
{
  "name": "megasaver-claude-limit-test-repo",
  "version": "1.0.0",
  "type": "module",
  "scripts": { "dev": "vite", "server": "node server.js" },
  "dependencies": { "express": "^4.19.2", "react": "^18.3.1", "react-dom": "^18.3.1" },
  "devDependencies": { "@vitejs/plugin-react": "^4.3.1", "vite": "^5.3.4" }
}
EOF

cat > "$REPO/server.js" <<'EOF'
import express from 'express';
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
app.listen(PORT, () => console.log(`Server on http://localhost:${PORT}`));
EOF

cat > "$REPO/index.html" <<'EOF'
<!doctype html><html lang="en"><head><meta charset="UTF-8"/><title>Events</title></head>
<body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>
EOF

cat > "$REPO/src/main.jsx" <<'EOF'
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
ReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
EOF

cat > "$REPO/src/App.jsx" <<'EOF'
import { useEffect, useState } from 'react';
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
    await fetch(`${API}/${id}`, { method: 'DELETE' });
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
EOF

cat > "$REPO/src/App.css" <<'EOF'
.app { font-family: system-ui, sans-serif; max-width: 400px; margin: 2rem auto; }
form { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
input { flex: 1; padding: 0.4rem; }
ul { list-style: none; padding: 0; }
li { display: flex; justify-content: space-between; padding: 0.4rem 0; border-bottom: 1px solid #ddd; }
EOF

cat > "$REPO/.gitignore" <<'EOF'
node_modules
dist
.env
EOF

cd "$REPO"
npm install --quiet
git init --quiet
git add .
git commit -m "chore: baseline event planner" --quiet
BASELINE_COMMIT=$(git rev-parse HEAD)

# Enable the workspace token saver for the bench repo, otherwise the megasaver
# arm pays the proxy overhead without the product's compression benefit.
(cd "$REPO" && mega init --yes --no-gui --mode balanced >/dev/null 2>&1) \
  || { echo "ERROR: mega init failed — saver not enabled for bench repo"; exit 1; }
echo "Workspace saver enabled for $REPO"

# Snapshot both arms only after init has installed the hooks. Claude runs with
# --setting-sources "", so the treatment file must carry those hooks itself.
echo "Creating baseline settings without MegaSaver proxy/hooks..."
python3 - "$DEFAULT_SETTINGS" "$BASELINE_SETTINGS" <<'PY'
import json, sys, copy
src, dst = sys.argv[1], sys.argv[2]
with open(src) as f:
    settings = json.load(f)

baseline = copy.deepcopy(settings)

# Remove MegaSaver proxy routing (and its first-party assertion flag).
if 'env' in baseline:
    baseline['env'].pop('ANTHROPIC_BASE_URL', None)
    baseline['env'].pop('_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL', None)
    if not baseline['env']:
        del baseline['env']

# Remove hooks whose command contains 'mega hooks' (MegaSaver telemetry/saver/intent).
if 'hooks' in baseline:
    cleaned_hooks = {}
    for event, configs in baseline['hooks'].items():
        kept_configs = []
        for cfg in configs:
            kept_inner = []
            for h in cfg.get('hooks', []):
                cmd = h.get('command', '')
                if 'mega hooks' in cmd:
                    continue
                kept_inner.append(h)
            if kept_inner:
                new_cfg = dict(cfg)
                new_cfg['hooks'] = kept_inner
                kept_configs.append(new_cfg)
        if kept_configs:
            cleaned_hooks[event] = kept_configs
    if cleaned_hooks:
        baseline['hooks'] = cleaned_hooks
    else:
        del baseline['hooks']

with open(dst, 'w') as f:
    json.dump(baseline, f, indent=2)
PY

echo "Baseline settings written to $BASELINE_SETTINGS"

# Both arms run with an explicit --settings file and a scrubbed ANTHROPIC_BASE_URL,
# so an inherited env var can never decide which endpoint an arm talks to.
python3 - "$DEFAULT_SETTINGS" "$MEGASAVER_SETTINGS" "$PROXY_URL" <<'PY'
import json, sys
src, dst, proxy_url = sys.argv[1], sys.argv[2], sys.argv[3]
with open(src) as f:
    settings = json.load(f)
env = settings.setdefault('env', {})
env['ANTHROPIC_BASE_URL'] = proxy_url
# Mirrors what the fixed route installer writes: without it Claude Code enters
# non-first-party mode (tools inlined, hook tail uncached, cold-cache rewrites).
env['_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL'] = '1'
with open(dst, 'w') as f:
    json.dump(settings, f, indent=2)
PY

python3 - "$MEGASAVER_SETTINGS" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    settings = json.load(f)
commands = [
    hook.get('command', '')
    for configs in settings.get('hooks', {}).values()
    for config in configs
    for hook in config.get('hooks', [])
]
if not any('mega hooks saver' in command for command in commands):
    raise SystemExit('ERROR: MegaSaver settings snapshot has no saver hook')
PY

echo "MegaSaver settings written to $MEGASAVER_SETTINGS (proxy $PROXY_URL)"
echo ""

# Results dir.
rm -rf "$RESULTS"
mkdir -p "$RESULTS"

run_task() {
  local name=$1
  local prompt=$2
  local mode=$3  # megasaver or baseline
  local outdir="$RESULTS/${name}_${mode}"
  mkdir -p "$outdir"

  cd "$REPO"
  git reset --hard "$BASELINE_COMMIT" --quiet
  git clean -fd --quiet

  local settings_file
  if [ "$mode" = "baseline" ]; then
    settings_file="$BASELINE_SETTINGS"
  else
    settings_file="$MEGASAVER_SETTINGS"
  fi

  echo "=== ${name} / ${mode} ==="
  local start_time end_time elapsed
  start_time=$(date +%s)

  # --settings only ADDS settings, so --setting-sources "" is required to stop
  # ~/.claude/settings.json (proxy route + `mega hooks`) leaking into the baseline arm.
  # -u ANTHROPIC_BASE_URL: the settings file is the only source of routing.
  # --output-format json: emits a real `usage` block (tokens + cost).
  env -u ANTHROPIC_BASE_URL "$CLAUDE_BIN" \
    --settings "$settings_file" \
    --setting-sources "" \
    --add-dir "$REPO" \
    --dangerously-skip-permissions \
    --output-format json \
    -p "$prompt" \
    > "$outdir/result.json" 2> "$outdir/stderr.log" || true

  end_time=$(date +%s)
  elapsed=$((end_time - start_time))

  git diff --stat > "$outdir/diffstat.txt" || true
  git diff > "$outdir/diff.patch" || true

  python3 - "$outdir" "$name" "$mode" "$elapsed" <<'PY'
import json, os, sys
outdir, task, mode, elapsed = sys.argv[1:5]

summary = {"task": task, "mode": mode, "wall_seconds": int(elapsed), "ok": False}
try:
    with open(os.path.join(outdir, 'result.json')) as f:
        r = json.load(f)
except Exception as e:
    summary["error"] = f"unparseable result.json: {e}"
else:
    u = r.get("usage") or {}
    cache_create = u.get("cache_creation_input_tokens", 0)
    cache_read = u.get("cache_read_input_tokens", 0)
    plain_in = u.get("input_tokens", 0)
    summary.update({
        "ok": not r.get("is_error", False),
        "input_tokens": plain_in,
        "cache_creation_input_tokens": cache_create,
        "cache_read_input_tokens": cache_read,
        # What actually burns the context/limit budget on the way in.
        "billable_input_tokens": plain_in + cache_create + cache_read,
        "output_tokens": u.get("output_tokens", 0),
        "total_cost_usd": r.get("total_cost_usd", 0.0),
        "num_turns": r.get("num_turns", 0),
        "duration_ms": r.get("duration_ms", 0),
    })
    if r.get("is_error"):
        summary["error"] = r.get("result", "")[:200]

with open(os.path.join(outdir, 'summary.json'), 'w') as f:
    json.dump(summary, f, indent=2)

if summary["ok"]:
    print(f"  ok  in={summary['billable_input_tokens']} out={summary['output_tokens']} "
          f"cost=${summary['total_cost_usd']:.4f} turns={summary['num_turns']} {elapsed}s")
else:
    print(f"  FAILED: {summary.get('error', 'unknown')}")
PY
}

echo ""
echo "Starting benchmark. This will run 8 Claude Code sessions (4 tasks x 2 modes)."
echo "Cost warning: this consumes real API credits."
echo ""

for i in "${!TASKS[@]}"; do
  task_name="task_$((i+1))"
  prompt="${TASKS[$i]}"
  # Interleave to reduce time-of-day / API drift.
  run_task "$task_name" "$prompt" "megasaver"
  run_task "$task_name" "$prompt" "baseline"
done

# Print results table.
python3 - <<'PY'
import json, math
from pathlib import Path

RESULTS = Path('/tmp/megasaver-claude-limit-test-results')
TASKS = ['task_1', 'task_2', 'task_3', 'task_4']
METRICS = [
    'billable_input_tokens',
    'cache_read_input_tokens',
    'cache_creation_input_tokens',
    'output_tokens',
    'total_cost_usd',
    'wall_seconds',
]

def load(task, mode):
    with open(RESULTS / f'{task}_{mode}' / 'summary.json') as f:
        return json.load(f)

print()
print('=' * 92)
print('CLAUDE CODE LIMIT TEST: MEGASAVER ACTIVE vs MEGASAVER DISABLED')
print('=' * 92)
print()
print('  megasaver = settings with ANTHROPIC_BASE_URL -> local proxy + `mega hooks`')
print('  baseline  = same settings, proxy route and MegaSaver hooks removed')
print('  savings   = baseline / megasaver  (>1.00x means MegaSaver used less)')
print()

# A failed session has no meaningful usage numbers; a ratio built from one is a lie.
failed = [(t, m) for t in TASKS for m in ('megasaver', 'baseline')
          if not load(t, m).get('ok')]
if failed:
    print('!! Sessions failed -- aggregate savings suppressed:')
    for t, m in failed:
        print(f'   {t}/{m}: {load(t, m).get("error", "unknown")[:70]}')
    print()

print(f'{"Task":<8} {"Metric":<28} {"MegaSaver":>14} {"Baseline":>14} {"Savings":>10}')
print('-' * 92)

geo = {m: [] for m in METRICS}
for task in TASKS:
    ms, base = load(task, 'megasaver'), load(task, 'baseline')
    both_ok = ms.get('ok') and base.get('ok')
    for m in METRICS:
        mv, bv = ms.get(m, 0), base.get(m, 0)
        fmt = (lambda v: f'{v:.4f}') if isinstance(mv, float) else (lambda v: f'{v:,}')
        if mv > 0 and bv > 0:
            r = bv / mv
            rs = f'{r:>9.2f}x'
            if both_ok:
                geo[m].append(r)
        else:
            rs = f'{"n/a":>10}'
        print(f'{task:<8} {m:<28} {fmt(mv):>14} {fmt(bv):>14} {rs}')
    print()

print('-' * 92)
if failed:
    print('AGGREGATE SUPPRESSED (see failed sessions above)')
else:
    print('AGGREGATE SAVINGS (geometric mean across tasks)')
    for m in METRICS:
        vals = geo[m]
        g = math.exp(sum(math.log(v) for v in vals) / len(vals)) if vals else 0
        print(f'  {m:<28} {g:>9.2f}x')

print()
print('Tokens and cost come from `claude --output-format json` -> .usage / .total_cost_usd,')
print('i.e. what Anthropic actually billed -- not a stdout-size proxy.')
print()
print('Raw logs and diffs: /tmp/megasaver-claude-limit-test-results')
print('=' * 92)
PY
