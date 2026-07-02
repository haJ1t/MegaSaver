---
title: Persistent Proxy Routing
tags: [proxy, lifecycle, launchd, claude-code]
sources:
  - docs/superpowers/specs/2026-07-02-persistent-proxy-routing-design.md
  - wiki/log.md
status: proposed
created: 2026-07-02
updated: 2026-07-02
---

## Purpose

Persist the operator's proxy opt-in across GUI and terminal lifetimes without
leaving future Claude processes routed to a dead listener. The 2026-07-02 live
diagnosis showed the proxy running while no current client had the route
(source: `wiki/log.md`, 2026-07-02 diagnosis).

## Locked design

- A dedicated `mega proxy supervise` process owns the LLM listener; the existing
  context daemon remains independent.
- `com.megasaver.proxy` provides macOS RunAtLoad/KeepAlive lifecycle only after
  explicit opt-in.
- Nonce health must pass before a leased route is written.
- Foreign routes and LaunchAgents are never overwritten.
- CLI and GUI share one controller; the GUI owns no listener or settings writer.
- Stop removes future routing, then drains for old clients until the operator
  confirms they were restarted.
- Status separates desired state, health, route, traffic, hook invocation, and
  compression evidence.

Source: `docs/superpowers/specs/2026-07-02-persistent-proxy-routing-design.md`.

## Risk

CRITICAL: the proxy carries credentials and complete API traffic. Architect and
critic approved the design; security review remains mandatory before merge.

