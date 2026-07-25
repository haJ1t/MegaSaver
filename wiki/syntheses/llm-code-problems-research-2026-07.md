---
title: LLM Code Problems Research — Feature Mapping (2026-07-20)
source: ~/Desktop/LLM-Code-Problems-Research.docx (593+ articles, multi-batch daily reports)
---

# LLM Code Problems Research → Mega Saver Feature Mapping

Analysis of `LLM-Code-Problems-Research.docx` (~19.4k lines, 593+ article
summaries plus appended daily reports through 2026-07-20), done via 10 parallel
range-analysis agents on 2026-07-20.

## Data-quality caveats

- Heavy cross-report duplication (same paper 2–4×); unique papers ≈ 60–70% of entries.
- Many Problem/Çözüm fields are recycled boilerplate; some title/body mismatches.
- All numeric claims are single-source from the report; arXiv ids noted where given.

## Dominant problem clusters (cross-range consensus)

1. **Package/API hallucination** — called "en yaygın ve çözülememiş sorun";
   LLMs invent packages 3–8% (up to 30% in some ecosystems; crypto code 2.3×);
   slopsquatting = supply-chain attack vector.
2. **Security vulnerabilities in generated code** — 30–40% of LLM code has ≥1
   vuln; 67% of models judge vulnerable code as safe; iterative refinement
   silently strips security properties (SCAFFOLD-CEGIS).
3. **Context-window limits / context quality** — models degrade far below
   advertised windows (MECW); context construction is a quality problem, not
   just cost.
4. **Agent silent failures** — 41% unnoticed; taxonomy: tool-call errors,
   context overflow, partial-completion delusion (34%), permission overreach,
   hallucinated state updates.
5. **Agent memory as attack surface** — KidnapRAG (78% vs RAG defenses),
   memory poisoning (2607.06595), Manufactured Confidence, Distributed
   Attacks on persistent state.
6. **Test generation quality**, **multi-step reasoning drift**,
   **DRY/duplication (+34% vs human)**, **instruction forgetting (40%+
   violations in chained tasks)**.

## Feature proposals (priority order)

1. **Package-hallucination firewall in proxy output-filter** — validate
   imports/package names against npm/PyPI/cargo registries before output
   lands; report: verification layer cuts phantom packages to <0.5%.
   Fits `@megasaver/output-filter` + proxy mode; model-agnostic (model
   editing fixes like BOUND must be re-applied per model version).
2. **Dependency version pinning in context pack** — inject resolved dep
   versions; stale-API calls drop 35% → <10% with retrieval. Fits
   context-pruner/context packer.
3. **Memory write-side verification + trust tiers** — third-party verify
   before persisting failure rules (EDV: −78% false memory writes, +31%
   task success); TTL enforcement (temporal-validity paper: +56%
   consistency). Upgrades FORGE + structured-memory-engine.
4. **Silent-failure monitor in proxy** — detect the 5-category taxonomy;
   context overflow + partial completion are differentiators. Extends
   `mega alerts`.
5. **Security gate per iteration + secret-leak filter** — scan every
   refinement round, not first output; 83% of LLMs leak secrets;
   imperative/security-first prompt priming = +23–35% secure code.
6. **Executable constraints from AGENTS.md (ContextCov direction)** —
   instruction files are passive text, violated under context saturation;
   config-smell linter for AGENTS.md (extends `mega connector doctor`).
7. **Token-budget hard enforcement + loop detection** — 63 budget-overrun
   incidents catalogued; infinite loops = 18% of harness bugs; RecurGuard
   reasoning-token attacks. Proxy metering + stop rules.
8. **Evidence-preserving compaction metadata** — "Compaction as Epistemic
   Failure": attach exit codes + timestamps, flag uncertainty; aligns with
   cache-aware saver spec (2026-07-19).
9. **Cheap-model routing / token arbitrage** — agentic routing −33% cost,
   SWE-Router +20–30% completion; quantization inflates reasoning tokens
   (cheap model ≠ cheap run). Proxy-level.
10. **MCP security layer** — over-privilege audit (scanners catch 23% of
    MCP-specific vulns), tool-clone detection (41% of 5000+ tools are
    clones), security-aware tool descriptions (−67% taint vulns).
    Extends `mega mcp doctor`.

## Validated existing bets

- Evidence-preserving compression: all compression methods lose 8–15%
  semantic info; task-adaptive selection wins → risk-mode stance correct.
- Stateful memory: 45% fewer tokens, +12% success ("Remember, Don't
  Re-read"); memory metadata convention (source/timestamp/confidence/
  expires) quantitatively backed (−67% stale-fact repetition).
- Deterministic control plane thesis (2606.26924): config layer of agents
  "largely unmanaged" — academic mandate for connector sync.
- Failed-run learning closed loop (2607.13091): duplication −47%, DRY
  violations −52%; noted limit — rule set grows unbounded → needs eviction.
