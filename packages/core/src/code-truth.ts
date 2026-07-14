import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractBlocksForFile } from "@megasaver/output-filter";
import type { MemoryEntryId, ProjectId } from "@megasaver/shared";
import type { CodeAnchor } from "./memory-anchor.js";
import type { MemoryEntry, MemoryEntryUpdatePatch } from "./memory-entry.js";
import type { CoreRegistry } from "./registry.js";

export type ExtractedBlockLite = {
  name?: string;
  contentHash: string;
  startLine: number;
  endLine: number;
};

export type RepoState = {
  headSha: string;
  // path → current blob sha at HEAD, or "missing"
  blobs: ReadonlyMap<string, string | "missing">;
  // path → extracted blocks of the CURRENT worktree content (only for files
  // cited by symbol anchors, plus rename targets)
  blocks: ReadonlyMap<string, readonly ExtractedBlockLite[]>;
  // path → rename target discovered via `git diff -M` (present only when the
  // anchored path is missing and a rename was detected)
  renames: ReadonlyMap<string, string>;
  // path → falsifying commit sha (last commit touching path since anchor head)
  attribution: ReadonlyMap<string, string>;
  // paths whose worktree content could not be extracted (parser / loadExtractors
  // fault). Their symbols are UNDETERMINED — never contradicted (same rule as a
  // git-unavailable blob). Absent ⇒ empty ⇒ no effect on the pure planner.
  undetermined?: ReadonlySet<string>;
};

export type VerifyPlan = {
  contradicted: Array<{ id: MemoryEntryId; reason: string; commit?: string }>;
  healed: MemoryEntryId[];
  verified: MemoryEntryId[];
  repointed: Array<{ id: MemoryEntryId; from: string; to: string }>;
  unanchored: MemoryEntryId[];
};

type Contradiction = { reason: string; path: string };

// First failing check for one entry, or undefined when every check passes.
// Contradiction policy (spec §6.2): a blob change ALONE never contradicts —
// file anchors are weak claims that only contradict on delete-without-rename;
// the unit of strong contradiction is the symbol hash. Name collisions at
// verify resolve optimistically: ANY same-name block matching the anchored
// hash verifies; contradiction only when none matches.
function firstContradiction(anchor: CodeAnchor, repo: RepoState): Contradiction | undefined {
  const effective = (path: string): string => repo.renames.get(path) ?? path;
  for (const file of anchor.files) {
    const blob = repo.blobs.get(effective(file.path)) ?? "missing";
    if (blob === "missing" && !repo.renames.has(file.path)) {
      return { reason: `${file.path} deleted`, path: file.path };
    }
  }
  for (const symbol of anchor.symbols) {
    const path = effective(symbol.path);
    if (repo.undetermined?.has(path)) {
      // Extraction failed for this file — we can't judge the symbol, so we
      // never contradict on it (a tooling fault is not evidence of deletion).
      continue;
    }
    const candidates = (repo.blocks.get(path) ?? []).filter(
      (candidate) => candidate.name === symbol.name,
    );
    if (candidates.length === 0) {
      return { reason: `${path}#${symbol.name} missing`, path };
    }
    if (!candidates.some((candidate) => candidate.contentHash === symbol.contentHash)) {
      return { reason: `${path}#${symbol.name} hash changed`, path };
    }
  }
  return undefined;
}

// Pure planner (spec §6.1) — fixture-testable, zero git. Heal is keyed
// STRICTLY on lastVerified.result === "contradicted" (architect B1: never
// evidence-string sniffing). The planner never inspects validTo: close
// ownership is an APPLY-time decision (runVerify), not a plan-time one.
// `now` is part of the pinned signature; timestamps are stamped at apply time.
export function verifyAnchors(
  entries: readonly MemoryEntry[],
  repo: RepoState,
  now: string,
): VerifyPlan {
  const plan: VerifyPlan = {
    contradicted: [],
    healed: [],
    verified: [],
    repointed: [],
    unanchored: [],
  };
  for (const entry of entries) {
    const anchor = entry.anchor;
    if (anchor === undefined) {
      plan.unanchored.push(entry.id);
      continue;
    }
    const cited = new Set<string>([
      ...anchor.files.map((file) => file.path),
      ...anchor.symbols.map((symbol) => symbol.path),
    ]);
    for (const path of cited) {
      const target = repo.renames.get(path);
      if (target !== undefined) {
        plan.repointed.push({ id: entry.id, from: path, to: target });
      }
    }
    const failure = firstContradiction(anchor, repo);
    if (failure !== undefined) {
      const commit = repo.attribution.get(failure.path);
      const reason =
        commit === undefined ? `${failure.reason} (uncommitted change)` : failure.reason;
      plan.contradicted.push({
        id: entry.id,
        reason,
        ...(commit !== undefined ? { commit } : {}),
      });
      continue;
    }
    if (entry.lastVerified?.result === "contradicted") {
      plan.healed.push(entry.id);
    } else {
      plan.verified.push(entry.id);
    }
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Impure runner (spec §6.5 + §7)
// ---------------------------------------------------------------------------

// The registry surface the runner needs. There is no standalone
// MemoryRegistry interface in core — memory methods live on CoreRegistry —
// so the contract name is a Pick; any full CoreRegistry satisfies it.
export type MemoryRegistry = Pick<CoreRegistry, "listMemoryEntries" | "applyMemoryEntryMutations">;

// The optional third `input` feeds git's stdin (batched cat-file). A
// contract-shaped (args, cwd) => string function is still assignable, but a
// custom execGit MUST forward `input` or batch-check sees an empty stdin and
// every blob reads as missing. The default forwards it.
export type ExecGit = (args: string[], cwd: string, input?: string) => string;

// timeout so a stuck git (index.lock, slow FS) can't stall a hook run;
// tryGit catches the throw (mirrors apps/cli/src/git-delta.ts).
const defaultExecGit: ExecGit = (args, cwd, input) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "ignore"],
    timeout: 3000,
    maxBuffer: 10 * 1024 * 1024,
    ...(input === undefined ? {} : { input }),
  });

function tryGit(exec: ExecGit, args: string[], cwd: string, input?: string): string | null {
  try {
    return exec(args, cwd, input);
  } catch {
    return null;
  }
}

const sha7 = (sha: string): string => sha.slice(0, 7);

function citedPaths(anchor: CodeAnchor): Set<string> {
  return new Set([
    ...anchor.files.map((file) => file.path),
    ...anchor.symbols.map((symbol) => symbol.path),
  ]);
}

// One spawn for every anchored blob: `HEAD:<path>` lines on stdin,
// `<sha> blob <size>` / `<name> missing` lines out, order preserved.
// Returns null ONLY when git itself is unavailable (fatal / timeout) — the
// caller must degrade, NOT treat it as deletion. The normal per-object "missing"
// token (exit 0) stays a real deletion signal in the returned array.
function batchCheckBlobs(
  exec: ExecGit,
  cwd: string,
  paths: readonly string[],
): Array<[string, string | "missing"]> | null {
  if (paths.length === 0) {
    return [];
  }
  const input = `${paths.map((path) => `HEAD:${path}`).join("\n")}\n`;
  const out = tryGit(exec, ["cat-file", "--batch-check"], cwd, input);
  if (out === null) {
    return null;
  }
  const lines = out.split("\n");
  return paths.map((path, index) => {
    const line = lines[index] ?? "";
    if (line === "" || line.endsWith(" missing")) {
      return [path, "missing"];
    }
    const sha = line.split(" ")[0];
    return [path, sha === undefined || sha === "" ? "missing" : sha];
  });
}

export async function runVerify(opts: {
  registry: MemoryRegistry;
  projectId: ProjectId;
  rootPath: string;
  now: string;
  scope?: { changedPaths: readonly string[] };
  execGit?: ExecGit;
}): Promise<VerifyPlan> {
  const exec: ExecGit = opts.execGit ?? defaultExecGit;
  const entries = opts.registry.listMemoryEntries(opts.projectId);
  const changed = opts.scope === undefined ? undefined : new Set(opts.scope.changedPaths);
  const candidates =
    changed === undefined
      ? entries
      : entries.filter(
          (entry) =>
            entry.anchor !== undefined &&
            [...citedPaths(entry.anchor)].some((path) => changed.has(path)),
        );

  const headRaw = tryGit(exec, ["rev-parse", "HEAD"], opts.rootPath);
  if (headRaw === null) {
    // Non-git project (or broken repo): degrade gracefully — nothing can be
    // checked, so nothing is written (spec §2).
    return {
      contradicted: [],
      healed: [],
      verified: [],
      repointed: [],
      unanchored: candidates.map((entry) => entry.id),
    };
  }
  const headSha = headRaw.trim();

  const anchored = candidates.filter(
    (entry): entry is MemoryEntry & { anchor: CodeAnchor } => entry.anchor !== undefined,
  );

  // 1. One batched cat-file --batch-check for every anchored blob (§6.5).
  const allPaths = [...new Set(anchored.flatMap((entry) => [...citedPaths(entry.anchor)]))];
  const blobResult = batchCheckBlobs(exec, opts.rootPath, allPaths);
  if (blobResult === null) {
    // cat-file failed/timed out — the blob state is UNDETERMINED, not deleted.
    // Degrade the whole run to unanchored with zero writes, exactly like the
    // rev-parse-null path: an undetermined blob must never contradict.
    return {
      contradicted: [],
      healed: [],
      verified: [],
      repointed: [],
      unanchored: candidates.map((entry) => entry.id),
    };
  }
  const blobs = new Map<string, string | "missing">(blobResult);

  // 2. Renames for missing paths, per distinct anchor head (git diff -M).
  //    An unreachable anchor head (rebase/amend — N7) just yields no rename
  //    info; it must never throw the runner.
  const renames = new Map<string, string>();
  if (allPaths.some((path) => blobs.get(path) === "missing")) {
    const heads = new Set(
      anchored
        .filter((entry) => [...citedPaths(entry.anchor)].some((p) => blobs.get(p) === "missing"))
        .map((entry) => entry.anchor.repoHead),
    );
    for (const anchorHead of heads) {
      const out = tryGit(
        exec,
        ["-c", "core.quotePath=off", "diff", "--name-status", "-M", `${anchorHead}..HEAD`],
        opts.rootPath,
      );
      if (out === null) {
        continue;
      }
      for (const line of out.split("\n")) {
        const [status, from, to] = line.split("\t");
        if (
          status?.startsWith("R") &&
          from !== undefined &&
          to !== undefined &&
          blobs.get(from) === "missing"
        ) {
          renames.set(from, to);
        }
      }
    }
    // Rename targets need blobs too — the planner re-checks under the new
    // path in the same pass. A null here (git unavailable on the 2nd spawn)
    // just leaves targets unresolved; the rename guard keeps that non-destructive.
    const targets = [...renames.values()].filter((path) => !blobs.has(path));
    for (const [path, blob] of batchCheckBlobs(exec, opts.rootPath, targets) ?? []) {
      blobs.set(path, blob);
    }
  }

  // 3. Re-extract worktree content for files cited by symbol anchors (§6.4:
  //    symbol existence is a WORKTREE question — disk read, not HEAD blobs).
  const blocks = new Map<string, readonly ExtractedBlockLite[]>();
  const undetermined = new Set<string>();
  const symbolPaths = new Set(
    anchored.flatMap((entry) =>
      entry.anchor.symbols.map((symbol) => renames.get(symbol.path) ?? symbol.path),
    ),
  );
  for (const path of symbolPaths) {
    let source: string;
    try {
      source = readFileSync(join(opts.rootPath, path), "utf8");
    } catch (err) {
      // ENOENT is genuine absence (rename already resolved upstream) ⇒ no
      // blocks ⇒ symbols missing (N6). A transient/unknown fs fault (EMFILE,
      // ENFILE, EACCES, EIO, EBUSY, ELOOP, …) is NOT evidence of deletion ⇒
      // mark undetermined so it never contradicts (same policy as an extractor
      // throw / Finding A's blob degrade).
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        undetermined.add(path);
      }
      continue;
    }
    let extracted: Awaited<ReturnType<typeof extractBlocksForFile>>;
    try {
      extracted = await extractBlocksForFile(path, source);
    } catch {
      // Parser / loadExtractors fault — a TOOLING failure, not evidence the
      // symbol is gone. Mark undetermined so it is never contradicted (mirrors
      // captureCodeAnchor's defensive guard and Finding A's blob degrade).
      undetermined.add(path);
      continue;
    }
    if (extracted === undefined) {
      // Unsupported extension (no extractor) — the worktree can't confirm or
      // deny the symbol, so mark undetermined (never contradict), matching the
      // recall spot-check. Without this, zero candidates read as "symbol gone".
      undetermined.add(path);
      continue;
    }
    blocks.set(
      path,
      extracted.map((block) => ({
        contentHash: block.contentHash,
        startLine: block.startLine,
        endLine: block.endLine,
        ...(block.name !== undefined ? { name: block.name } : {}),
      })),
    );
  }

  // 4. Two-phase plan: a dry pass (pure, cheap) finds contradictions, then
  //    one `git log -n1` per contradicted entry's cited path attributes them,
  //    and the planner re-runs with attribution filled in.
  const dryRepo: RepoState = {
    headSha,
    blobs,
    blocks,
    renames,
    attribution: new Map(),
    undetermined,
  };
  const dryPlan = verifyAnchors(candidates, dryRepo, opts.now);
  const attribution = new Map<string, string>();
  const contradictedIds = new Set(dryPlan.contradicted.map((item) => item.id));
  for (const entry of anchored) {
    if (!contradictedIds.has(entry.id)) {
      continue;
    }
    for (const path of citedPaths(entry.anchor)) {
      const effectivePath = renames.get(path) ?? path;
      if (attribution.has(effectivePath)) {
        continue;
      }
      const out = tryGit(
        exec,
        ["log", "-n1", "--format=%H", `${entry.anchor.repoHead}..HEAD`, "--", effectivePath],
        opts.rootPath,
      );
      // Unreachable anchor head or untouched path ⇒ attribution unavailable
      // (N7) — commit stays absent, never a throw.
      const sha = out?.trim();
      if (sha !== undefined && sha !== "") {
        attribution.set(effectivePath, sha);
      }
    }
  }
  const plan = verifyAnchors(
    candidates,
    { headSha, blobs, blocks, renames, attribution, undetermined },
    opts.now,
  );

  // 5. Mutations (§7) — one closure per entry, applied in ONE batch under the
  //    registry lock. NEVER touches lastActiveAt: verify is observation, not
  //    use. Each closure recomputes its patch from the FRESH in-lock row
  //    (critic F2) so a concurrent writer between this snapshot and the apply is
  //    never clobbered; the snapshot below only decides WHICH entries could
  //    mutate, so an all-no-op run still makes zero apply calls.
  const byId = new Map(candidates.map((entry) => [entry.id, entry] as const));

  const repointsFor = new Map<MemoryEntryId, Array<{ from: string; to: string }>>();
  for (const item of plan.repointed) {
    if (byId.get(item.id)?.anchor === undefined) {
      continue;
    }
    const list = repointsFor.get(item.id) ?? [];
    list.push({ from: item.from, to: item.to });
    repointsFor.set(item.id, list);
  }

  type Action =
    | { kind: "contradict"; evidenceLine: string }
    | { kind: "heal" }
    | { kind: "verify" };
  const actionFor = new Map<MemoryEntryId, Action>();
  for (const item of plan.contradicted) {
    if (!byId.has(item.id)) {
      continue;
    }
    const evidenceLine =
      item.commit === undefined
        ? `code-truth: contradicted — ${item.reason}`
        : `code-truth: contradicted by ${sha7(item.commit)} — ${item.reason}`;
    actionFor.set(item.id, { kind: "contradict", evidenceLine });
  }
  for (const id of plan.healed) {
    if (byId.has(id)) {
      actionFor.set(id, { kind: "heal" });
    }
  }
  for (const id of plan.verified) {
    if (byId.has(id)) {
      actionFor.set(id, { kind: "verify" });
    }
  }

  const rewriteAnchor = (
    anchor: CodeAnchor,
    repoints: ReadonlyArray<{ from: string; to: string }>,
  ): CodeAnchor => {
    let next = anchor;
    for (const { from, to } of repoints) {
      next = {
        ...next,
        files: next.files.map((file) => (file.path === from ? { ...file, path: to } : file)),
        symbols: next.symbols.map((symbol) =>
          symbol.path === from ? { ...symbol, path: to } : symbol,
        ),
      };
    }
    return next;
  };

  const buildPatch = (
    fresh: MemoryEntry,
    repoints: ReadonlyArray<{ from: string; to: string }>,
    action: Action | undefined,
  ): MemoryEntryUpdatePatch | null => {
    const patch: MemoryEntryUpdatePatch = { updatedAt: opts.now };
    let wrote = false;
    if (repoints.length > 0 && fresh.anchor !== undefined) {
      patch.anchor = rewriteAnchor(fresh.anchor, repoints);
      wrote = true;
    }
    if (action?.kind === "contradict") {
      // Idempotence: an already-contradicted row is never re-mutated (BLOCKER A).
      if (fresh.lastVerified?.result !== "contradicted") {
        const open = fresh.validTo == null; // null OR undefined — row still current
        patch.stale = true;
        if (open) {
          patch.validTo = opts.now;
        }
        patch.evidence = [...(fresh.evidence ?? []), action.evidenceLine];
        patch.lastVerified = {
          headSha,
          at: opts.now,
          result: "contradicted",
          // B1 close ownership: own the close when this contradiction closed an
          // open row, OR a prior code-truth contradiction already owned it —
          // never downgrade. A lineage/manual close (flag false, not open) stays
          // false so heal never reopens a close it does not own.
          closedByCodeTruth: open || fresh.lastVerified?.closedByCodeTruth === true,
        };
        wrote = true;
      }
    } else if (action?.kind === "heal") {
      const ownedClose = fresh.lastVerified?.closedByCodeTruth === true;
      patch.stale = false;
      if (ownedClose) {
        patch.validTo = null;
      }
      patch.evidence = [
        ...(fresh.evidence ?? []),
        `code-truth: healed at ${sha7(headSha)} — hash matches again`,
      ];
      patch.lastVerified = { headSha, at: opts.now, result: "healed", closedByCodeTruth: false };
      wrote = true;
    } else if (action?.kind === "verify") {
      // No-op suppression (§7): repeat verifies at an unchanged head write
      // nothing — keeps them free and updatedAt honest.
      if (fresh.lastVerified?.headSha !== headSha) {
        patch.lastVerified = {
          headSha,
          at: opts.now,
          result: "verified",
          closedByCodeTruth: false,
        };
        wrote = true;
      }
    }
    return wrote ? patch : null;
  };

  const mutations: Array<{
    id: MemoryEntryId;
    mutate: (fresh: MemoryEntry) => MemoryEntryUpdatePatch | null;
  }> = [];
  for (const id of new Set<MemoryEntryId>([...repointsFor.keys(), ...actionFor.keys()])) {
    const snapshot = byId.get(id);
    if (snapshot === undefined) {
      continue;
    }
    const repoints = repointsFor.get(id) ?? [];
    const action = actionFor.get(id);
    // Snapshot-level suppression, mirroring the old per-branch guards: skip an
    // entry entirely when nothing would be written, so an all-no-op run makes
    // zero apply calls. The mutator re-checks against the fresh row at apply.
    const actionWrites =
      action !== undefined &&
      (action.kind === "heal" ||
        (action.kind === "contradict" && snapshot.lastVerified?.result !== "contradicted") ||
        (action.kind === "verify" && snapshot.lastVerified?.headSha !== headSha));
    if (repoints.length === 0 && !actionWrites) {
      continue;
    }
    mutations.push({ id, mutate: (fresh) => buildPatch(fresh, repoints, action) });
  }
  if (mutations.length > 0) {
    opts.registry.applyMemoryEntryMutations(opts.projectId, mutations);
  }
  return plan;
}
