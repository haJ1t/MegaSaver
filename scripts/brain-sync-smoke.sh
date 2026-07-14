#!/usr/bin/env bash
# brain-sync-smoke.sh — real-endpoint smoke for `mega brain sync` (E7 / PR #282)
#
# Proves the two-machine round-trip against a REAL S3-compatible endpoint:
#   machine A: init (generate key) -> push          (generation 1)
#   machine B: init --join <code>  -> pull -> status (same brainId, DIFFERENT
#              local project id, SAME project name -> B1 cross-machine proof)
#
# It writes a redacted transcript you can paste into the PR (recovery code is
# masked in the saved file).
#
# ---------------------------------------------------------------------------
# PREREQUISITES (set as env before running, or use --minio to auto-start one):
#   SMOKE_ENDPOINT              e.g. https://<acct>.r2.cloudflarestorage.com
#                               (http://127.0.0.1:9000 for local MinIO)
#   SMOKE_BUCKET                e.g. mega-brain-smoke   (created if missing)
#   MEGA_SYNC_ACCESS_KEY_ID     bucket access key   (the CLI reads these too)
#   MEGA_SYNC_SECRET_ACCESS_KEY bucket secret key
#   MEGA_LICENSE_KEY            your msp_ Pro license key (activated per store)
#
# OPTIONS:
#   --minio     start a throwaway MinIO in docker on :9000 + create the bucket,
#               and override SMOKE_ENDPOINT/BUCKET/creds to the MinIO defaults.
#   --keep      do not delete the temp store dirs / MinIO container on exit.
#   --seed      also create+approve one project memory on A (non-empty brain).
#
# USAGE:
#   # bring-your-own endpoint (R2/S3/MinIO already running):
#   SMOKE_ENDPOINT=... SMOKE_BUCKET=... MEGA_SYNC_ACCESS_KEY_ID=... \
#   MEGA_SYNC_SECRET_ACCESS_KEY=... MEGA_LICENSE_KEY=msp_... ./brain-sync-smoke.sh
#
#   # local MinIO in one shot (needs docker):
#   MEGA_LICENSE_KEY=msp_... ./brain-sync-smoke.sh --minio
# ---------------------------------------------------------------------------
set -euo pipefail

# --- locate the repo (this script lives at <repo>/scripts/) ------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WT="${BRAIN_SYNC_WORKTREE:-$(cd "$SCRIPT_DIR/.." && pwd)}"
CLI_JS="$WT/apps/cli/dist/cli.js"
PROJECT_NAME="smoke-brain"
KEEP=0; USE_MINIO=0; SEED=0
for a in "$@"; do case "$a" in
  --keep) KEEP=1;; --minio) USE_MINIO=1;; --seed) SEED=1;;
  *) echo "unknown option: $a" >&2; exit 2;; esac; done

fail() { echo "SMOKE FAIL: $*" >&2; exit 1; }
[ -d "$WT" ] || fail "worktree not found at $WT (set BRAIN_SYNC_WORKTREE)"
cd "$WT"

# --- transcript (redacted copy of everything below; temp file, not the repo) -
TS="${SMOKE_TRANSCRIPT:-$(mktemp -t brain-sync-smoke-transcript.XXXXXX.txt)}"
: > "$TS"
say() { echo "$@" | tee -a "$TS"; }
run() { # run a CLI command, echo it, capture combined output into the transcript
  local desc="$1"; shift
  say ""; say "### $desc"; say "\$ mega $*"
  node "$CLI_JS" "$@" 2>&1 | tee -a "$TS"
  return "${PIPESTATUS[0]}"
}

# --- optional MinIO ----------------------------------------------------------
MINIO_CID=""
if [ "$USE_MINIO" = 1 ]; then
  command -v docker >/dev/null 2>&1 || fail "--minio needs docker"
  say ">> starting throwaway MinIO on :9000"
  MINIO_CID="$(docker run -d --rm -p 9000:9000 -e MINIO_ROOT_USER=minioadmin \
      -e MINIO_ROOT_PASSWORD=minioadmin minio/minio server /data)"
  export SMOKE_ENDPOINT="http://127.0.0.1:9000"
  export SMOKE_BUCKET="${SMOKE_BUCKET:-mega-brain-smoke}"
  export MEGA_SYNC_ACCESS_KEY_ID="minioadmin"
  export MEGA_SYNC_SECRET_ACCESS_KEY="minioadmin"
  sleep 3
fi

cleanup() {
  [ "$KEEP" = 1 ] && { say ">> --keep: leaving stores + minio in place"; return; }
  rm -rf "${STORE_A:-}" "${STORE_B:-}" 2>/dev/null || true
  [ -n "$MINIO_CID" ] && docker stop "$MINIO_CID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# --- required env ------------------------------------------------------------
: "${SMOKE_ENDPOINT:?set SMOKE_ENDPOINT (or use --minio)}"
: "${SMOKE_BUCKET:?set SMOKE_BUCKET}"
: "${MEGA_SYNC_ACCESS_KEY_ID:?set MEGA_SYNC_ACCESS_KEY_ID}"
: "${MEGA_SYNC_SECRET_ACCESS_KEY:?set MEGA_SYNC_SECRET_ACCESS_KEY}"
: "${MEGA_LICENSE_KEY:?set MEGA_LICENSE_KEY (msp_ Pro key)}"

# --- build CLI if needed -----------------------------------------------------
[ -f "$CLI_JS" ] || { say ">> building CLI"; pnpm --filter @megasaver/cli build >/dev/null; }
[ -f "$CLI_JS" ] || fail "CLI entry missing after build: $CLI_JS"

# --- create the bucket (idempotent) via the installed aws-sdk ----------------
say ">> ensuring bucket '$SMOKE_BUCKET' exists at $SMOKE_ENDPOINT"
( cd "$WT/packages/brain-sync" && SMOKE_ENDPOINT="$SMOKE_ENDPOINT" SMOKE_BUCKET="$SMOKE_BUCKET" \
  node --input-type=module -e '
    import { S3Client, CreateBucketCommand } from "@aws-sdk/client-s3";
    const c = new S3Client({ endpoint: process.env.SMOKE_ENDPOINT, region: "auto",
      forcePathStyle: true, credentials: { accessKeyId: process.env.MEGA_SYNC_ACCESS_KEY_ID,
      secretAccessKey: process.env.MEGA_SYNC_SECRET_ACCESS_KEY } });
    try { await c.send(new CreateBucketCommand({ Bucket: process.env.SMOKE_BUCKET }));
      console.log("bucket created"); }
    catch (e) { const n = e?.name ?? ""; if (/BucketAlreadyOwnedByYou|BucketAlreadyExists/.test(n))
      console.log("bucket already exists"); else { console.error("bucket create failed:", n || e); process.exit(1); } }
  ' ) | tee -a "$TS" || fail "could not create/verify bucket"

# --- temp stores = two "machines" -------------------------------------------
STORE_A="$(mktemp -d -t mega-smoke-A.XXXXXX)"
STORE_B="$(mktemp -d -t mega-smoke-B.XXXXXX)"
say ">> store A = $STORE_A"; say ">> store B = $STORE_B"

# --- license both stores (Pro gate) — NEVER echo the key into the transcript -
license_store() { # $1 = store dir ; suppress command echo + key
  local out; out="$(node "$CLI_JS" license activate "$MEGA_LICENSE_KEY" --store "$1" 2>&1)" \
    || { printf '%s\n' "$out" >&2; return 1; }
}
say ""; say "### license A + B (key + command redacted)"
license_store "$STORE_A" || fail "license activate A failed (is MEGA_LICENSE_KEY a valid msp_ key?)"
license_store "$STORE_B" || fail "license activate B failed"
say "activated Pro on both stores"

# --- projects: SAME name, independent local ids (what real machines produce) -
run "project A" project create "$PROJECT_NAME" --store "$STORE_A" || fail "project create A"
run "project B" project create "$PROJECT_NAME" --store "$STORE_B" || fail "project create B"

if [ "$SEED" = 1 ]; then
  run "seed memory A" memory create "$PROJECT_NAME" --scope project \
      --content "smoke: alpha knowledge $(date -u +%FT%TZ)" --store "$STORE_A" || true
  say "   (approve it so exportBrain includes it: mega memory list $PROJECT_NAME --store $STORE_A --json,"
  say "    then: mega memory approve <id> --store $STORE_A)"
fi

# --- A: init (generate) + push ----------------------------------------------
INIT_A_OUT="$(node "$CLI_JS" brain sync init --endpoint "$SMOKE_ENDPOINT" \
    --bucket "$SMOKE_BUCKET" --store "$STORE_A" 2>&1)" || { echo "$INIT_A_OUT"; fail "init A"; }
RECOVERY="$(printf '%s\n' "$INIT_A_OUT" | sed -n 's/^Recovery code: //p' | tr -d '[:space:]')"
[ -n "$RECOVERY" ] || { echo "$INIT_A_OUT"; fail "no recovery code from init A"; }
# transcript gets the REDACTED init output
say ""; say "### init A (generate key)"; say "\$ mega brain sync init --endpoint $SMOKE_ENDPOINT --bucket $SMOKE_BUCKET --store <A>"
printf '%s\n' "$INIT_A_OUT" | sed "s#$RECOVERY#XXXXX-REDACTED-RECOVERY-CODE#g" | tee -a "$TS"

run "push A" brain sync push "$PROJECT_NAME" --store "$STORE_A" || fail "push A"

# --- B: init --join (adopt A's key) + pull + status -------------------------
say ""; say "### init B --join <recovery-code>  (key from A; recovery code redacted here)"
say "\$ mega brain sync init --join <REDACTED> --endpoint $SMOKE_ENDPOINT --bucket $SMOKE_BUCKET --store <B>"
node "$CLI_JS" brain sync init --join "$RECOVERY" --endpoint "$SMOKE_ENDPOINT" \
    --bucket "$SMOKE_BUCKET" --store "$STORE_B" 2>&1 | tee -a "$TS" || fail "init B --join"

run "pull B"   brain sync pull   "$PROJECT_NAME" --store "$STORE_B" || fail "pull B"
run "status B" brain sync status "$PROJECT_NAME" --store "$STORE_B" || fail "status B"

# --- assertions --------------------------------------------------------------
say ""; say ">> checking success markers"
grep -q "pushed generation 1" "$TS"            || fail "A did not push generation 1"
grep -Eq "merged remote generation 1|already up to date \(generation 1\)" "$TS" \
                                               || fail "B did not pull A's generation 1"
grep -q "up to date: yes" "$TS"                || fail "B status not up-to-date"

say ""
say "=========================================================="
say "SMOKE PASS — two machines (different local ids, same name '$PROJECT_NAME')"
say "converged on generation 1 through $SMOKE_ENDPOINT/$SMOKE_BUCKET."
say "Transcript (recovery code redacted): $TS"
say "=========================================================="
