// packages/pro-analytics/test/firewall-report.test.ts
import { describe, expect, it } from "vitest";
import { FIREWALL_ADVICE, diagnoseFirewall } from "../src/firewall-report.js";

const NOW = Date.parse("2026-07-08T12:00:00.000Z");
const DAY = 86_400_000;
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();

const ev = (over: Partial<Parameters<typeof diagnoseFirewall>[0][number]> = {}) => ({
  at: at(60_000),
  kind: "redacted" as const,
  detector: "credit_card",
  count: 1,
  ...over,
});

describe("diagnoseFirewall", () => {
  it("defaults to a 7-day window and filters older events", () => {
    const r = diagnoseFirewall([ev(), ev({ at: at(8 * DAY) })], { now: NOW });
    expect(r.windowDays).toBe(7);
    expect(r.events).toBe(1);
  });

  it("honors a custom window", () => {
    const r = diagnoseFirewall([ev({ at: at(8 * DAY) })], { now: NOW, days: 30 });
    expect(r.events).toBe(1);
  });

  it("skips unparseable timestamps instead of throwing", () => {
    const r = diagnoseFirewall([ev({ at: "not-a-date" }), ev()], { now: NOW });
    expect(r.events).toBe(1);
  });

  it("aggregates blocked reads per path, sorted by count desc then path, top 10", () => {
    const events = [
      ev({
        kind: "blocked-read" as const,
        detector: "secret-path",
        sourcePath: "/a/.env",
        count: 3,
      }),
      ev({
        kind: "blocked-read" as const,
        detector: "secret-path",
        sourcePath: "/b/id_rsa",
        count: 3,
      }),
      ev({
        kind: "blocked-read" as const,
        detector: "secret-path",
        sourcePath: "/a/.env",
        count: 1,
      }),
      ...Array.from({ length: 12 }, (_, i) =>
        ev({
          kind: "blocked-read" as const,
          detector: "secret-path",
          sourcePath: `/x/${i}.pem`,
          count: 1,
        }),
      ),
    ];
    const r = diagnoseFirewall(events, { now: NOW });
    expect(r.blockedReads[0]).toEqual({ sourcePath: "/a/.env", count: 4 });
    expect(r.blockedReads[1]).toEqual({ sourcePath: "/b/id_rsa", count: 3 });
    expect(r.blockedReads).toHaveLength(10);
  });

  it("aggregates redactions per detector and counts observed emails", () => {
    const r = diagnoseFirewall(
      [
        ev({ detector: "github_token", count: 2 }),
        ev({ detector: "credit_card", count: 1 }),
        ev({ detector: "github_token", count: 1 }),
        ev({ kind: "observed" as const, detector: "email", count: 5 }),
      ],
      { now: NOW },
    );
    expect(r.redactedByDetector).toEqual([
      { detector: "github_token", count: 3 },
      { detector: "credit_card", count: 1 },
    ]);
    expect(r.observedEmails).toBe(5);
  });

  it("emits one advice line per non-empty category (pinned strings)", () => {
    const r = diagnoseFirewall(
      [
        ev({ kind: "blocked-read" as const, detector: "secret-path", sourcePath: "/a/.env" }),
        ev({ detector: "github_token" }),
        ev({ detector: "credit_card" }),
      ],
      { now: NOW },
    );
    expect(r.advice).toEqual([
      FIREWALL_ADVICE.blocked,
      FIREWALL_ADVICE.secrets,
      FIREWALL_ADVICE.pii,
    ]);
  });

  it("returns an all-empty report on no events", () => {
    const r = diagnoseFirewall([], { now: NOW });
    expect(r).toEqual({
      windowDays: 7,
      events: 0,
      blockedReads: [],
      redactedByDetector: [],
      observedEmails: 0,
      advice: [],
    });
  });
});
