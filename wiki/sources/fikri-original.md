---
title: Original Product Idea (fikri.txt)
tags: [source, foundation]
sources: [raw/mega-saver-platform-fikri.txt]
status: active
created: 2026-05-03
updated: 2026-05-03
---

# Original Product Idea — `mega-saver-platform-fikri.txt`

> 1421 lines, Turkish. Authored by user (Halit Ozger). Lives **local-only** at `wiki/raw/mega-saver-platform-fikri.txt` (gitignored — see `.gitignore`). **Do not read whole.** This page is the public index — every claim that future Claude instances need is summarized here. Re-read the raw file only if a question demands a quote or detail this page does not cover.

## One-line summary

Mega Saver is a single ContextOps control panel that connects to all frontier coding agents (Claude Code, Codex, Cursor, Aider, generic CLI), manages context/memory/sessions, reduces token waste, and shares one project memory across every agent.

## Tagline

"Less tokens. More signal. Same or better agent performance."

## Section index

| § | Title (TR)                              | Lines    | Read when…                                  |
|----|------------------------------------------|----------|---------------------------------------------|
| 1  | Kısa Tanım                              | ~9-27    | first-time orientation                       |
| 2  | Problem                                 | ~29-47   | justifying a token-saving feature            |
| 3  | Ürünün Ana Yaklaşımı                    | ~50-83   | architecture decisions                       |
| 4  | Kullanıcı Akışı                         | ~85-118  | UX flows                                     |
| 5  | Sistemin Ana Parçaları (6 subsystems)   | ~120-327 | building any subsystem                       |
| 6  | Özellik Grupları                        | ~374-806 | building a specific feature                  |
| 7  | Feature Toggle Sistemi                  | ~808-877 | designing settings UI                        |
| 8  | Agent Compatibility Matrix              | ~879-895 | per-agent capability mapping                 |
| 9  | Risk Detection ve Compression Modları   | ~898-959 | risk-aware features                          |
| 10 | Performans Düşmemesi İçin Kurallar      | ~961-986 | safe-compression principles                  |
| 11 | Veri Modeli Taslağı                     | ~988-1079| schema/types work                            |
| 12 | Session Çalışma Akışı                   | ~1081-1146| session-runtime work                        |
| 13 | Manuel ve Otomatik Feature Çalıştırma   | ~1148-1202| CLI/UX                                      |
| 14 | Feature as a Service Mantığı            | ~1204-1252| feature interface design                    |
| 15 | MVP Planı (v0.1, v0.2, v0.3, sonraki)   | ~1254-1324| MVP scoping (we picked headless v0.1)       |
| 16 | İlk 30 Ana Özellik Listesi              | ~1326-1359| feature naming                              |
| 17 | Ürünün En Güçlü Farkı                   | ~1361-1387| pitch / positioning                         |
| 18 | Kısa Sonuç                              | ~1389-1421| summary                                      |

## Six subsystems (§5)

See [[syntheses/mega-saver-product]] — single page with all six.

## v0.1 MVP scope (§15.1)

User chose **headless-first** subset, narrower than fikri's original v0.1: Core Engine + CLI + Claude Code Connector + Generic CLI Connector. No GUI yet. See [[decisions/bootstrap-matrix]] decision #3.

## Fikri claims that became locked decisions

- §3: Mega Saver Core agent-agnostic → [[concepts/agent-agnostic-core]]
- §9: Risk levels gate compression / discipline → [[concepts/risk-aware-development]]
- §10: Evidence-preserving compression principle → captured in [[concepts/contextops]]
- §16: 30 features list → backlog, not all in v0.1

## Open / not-yet-decided in fikri

- GUI shell (Tauri vs Electron) — fikri does not specify
- MCP bridge protocol shape — fikri describes the role, not the wire format
- Direct Anthropic API usage policy — fikri silent

These are deferred per [[decisions/bootstrap-matrix]] open questions.

## When to re-read the raw file

- Building a feature whose details I do not remember (use section index above to jump)
- Validating a claim where this page conflicts with code/spec
- Doing a fresh-eyes audit of the product vision

Otherwise: trust this page and the linked syntheses.
