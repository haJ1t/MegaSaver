import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BOARD_DELTA_CHECK_INTERVAL_MS,
  BOARD_INJECT_MAX_TOKENS,
  selectBoardDigest,
  selectFactsForInjection,
} from "../src/board/inject.js";
import { postFact, readBoardFacts, resolveFact } from "../src/board/store.js";
import { registerSession } from "../src/presence.js";

describe("board disputed", () => {
  let root = "";
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "board-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  it("cross-session same topic marks both disputed", () => {
    postFact(root, {
      text: "A",
      topic: "  API Z  ",
      confidence: "high",
      scope: { repo: "repo1" },
      expiresAt: null,
      liveSessionId: "a1",
    });
    postFact(root, {
      text: "B",
      topic: "api z",
      confidence: "high",
      scope: { repo: "repo1" },
      expiresAt: null,
      liveSessionId: "b1",
    });
    const facts = readBoardFacts(root, { repo: "repo1" });
    expect(facts.filter((f) => f.status === "disputed")).toHaveLength(2);
    expect(facts[0]?.disputedWith).toHaveLength(1);
  });

  it("same-session supersedes old status:resolved", () => {
    postFact(root, {
      text: "A",
      topic: "topicX",
      confidence: "high",
      scope: { repo: "repo1" },
      expiresAt: null,
      liveSessionId: "a1",
    });
    postFact(root, {
      text: "B",
      topic: "topicX",
      confidence: "high",
      scope: { repo: "repo1" },
      expiresAt: null,
      liveSessionId: "a1",
    });
    const facts = readBoardFacts(root, { repo: "repo1" });
    expect(facts.filter((f) => f.status === "active")).toHaveLength(1);
    expect(facts.filter((f) => f.status === "resolved")).toHaveLength(1);
  });

  it("redacts secret before persist", () => {
    const fact = postFact(root, {
      text: "token: sk-proj-abcdefghijklmnopqrstuvwxyz0123456789",
      topic: "secret",
      confidence: "high",
      scope: { repo: "repo1" },
      expiresAt: null,
      liveSessionId: "a1",
    });
    expect(fact.text).not.toContain("sk-proj");
    const facts = readBoardFacts(root, { repo: "repo1" });
    expect(facts[0]?.text).not.toContain("sk-proj");
  });

  it("normalizeTopic trim+lowercase+collapse whitespace", () => {
    postFact(root, {
      text: "A",
      topic: "  Hello   World  ",
      confidence: "high",
      scope: { repo: "repo1" },
      expiresAt: null,
      liveSessionId: "a1",
    });
    const facts = readBoardFacts(root, { repo: "repo1" });
    expect(facts[0]?.topic).toBe("hello world");
    // query with different whitespace/case should match
    const filtered = readBoardFacts(root, { topic: "hello world" });
    expect(filtered).toHaveLength(1);
    const filtered2 = readBoardFacts(root, { topic: "  HELLO   WORLD " });
    expect(filtered2).toHaveLength(1);
  });

  it("resolve marks resolved with note", () => {
    const fact = postFact(root, {
      text: "A",
      topic: "t1",
      confidence: "high",
      scope: { repo: "repo1" },
      expiresAt: null,
      liveSessionId: "a1",
    });
    resolveFact(root, fact.id, "done");
    const facts = readBoardFacts(root, {});
    expect(facts[0]?.status).toBe("resolved");
    expect(facts[0]?.resolution?.note).toBe("done");
  });

  it("selectFactsForInjection filters active+high+unexpired cap 500 tokens", () => {
    // low confidence filtered
    postFact(root, {
      text: "low",
      topic: "tLow",
      confidence: "low",
      scope: { repo: "repo1" },
      expiresAt: null,
      liveSessionId: "a1",
    });
    // high but expired filtered
    postFact(root, {
      text: "exp",
      topic: "tExp",
      confidence: "high",
      scope: { repo: "repo1" },
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      liveSessionId: "a1",
    });
    // high active should be returned
    postFact(root, {
      text: "x".repeat(100),
      topic: "tGood",
      confidence: "high",
      scope: { repo: "repo1" },
      expiresAt: null,
      liveSessionId: "a1",
    });
    const sel = selectFactsForInjection(root, "newSess");
    expect(sel.facts.some((f) => f.topic === "tgood")).toBe(true);
    expect(sel.facts.some((f) => f.topic === "tlow")).toBe(false);
    expect(sel.facts.some((f) => f.topic === "texp")).toBe(false);
    expect(sel.tokens).toBeLessThanOrEqual(BOARD_INJECT_MAX_TOKENS);
  });

  it("selectFactsForInjection caps 500 tokens estimatedTokens = redactedText.length/4", () => {
    for (let i = 0; i < 10; i++) {
      postFact(root, {
        text: "x".repeat(1000),
        topic: `t${i}`,
        confidence: "high",
        scope: { repo: "repo1" },
        expiresAt: null,
        liveSessionId: `s${i}`,
      });
    }
    const sel = selectFactsForInjection(root, "capSess");
    expect(sel.tokens).toBeLessThanOrEqual(500);
    // 1000/4=250 per fact, so 2 facts =500, third would exceed
    expect(sel.facts.length).toBe(2);
  });

  it("selectFactsForInjection debounce 30s via board-cursor", async () => {
    postFact(root, {
      text: "hello",
      topic: "t1",
      confidence: "high",
      scope: { repo: "repo1" },
      expiresAt: null,
      liveSessionId: "a1",
    });
    const first = selectFactsForInjection(root, "debSess");
    expect(first.facts.length).toBe(1);
    const second = selectFactsForInjection(root, "debSess");
    expect(second.facts.length).toBe(0);
    expect(second.tokens).toBe(0);
    // manipulate cursor to past
    const { readFileSync, writeFileSync } = await import("node:fs");
    const cursorPath = join(root, "mesh", "board-cursor", "debSess.json");
    const raw = JSON.parse(readFileSync(cursorPath, "utf8"));
    raw.lastAt = new Date(Date.now() - BOARD_DELTA_CHECK_INTERVAL_MS - 1000).toISOString();
    writeFileSync(cursorPath, `${JSON.stringify(raw)}\n`);
    const third = selectFactsForInjection(root, "debSess");
    expect(third.facts.length).toBe(1);
  });

  it("sameScope repo filtering: only same repo injected", () => {
    const wkA = encodeWorkspaceKey("/repoA");
    const wkB = encodeWorkspaceKey("/repoB");
    registerSession(root, {
      liveSessionId: "sessA",
      agent: "claude",
      status: "working",
      lastSeenAt: new Date().toISOString(),
      workspaceKey: wkA,
      cwd: "/repoA",
    });
    postFact(root, {
      text: "fact A",
      topic: "topicA",
      confidence: "high",
      scope: { repo: wkA },
      expiresAt: null,
      liveSessionId: "a1",
    });
    postFact(root, {
      text: "fact B",
      topic: "topicB",
      confidence: "high",
      scope: { repo: wkB },
      expiresAt: null,
      liveSessionId: "a1",
    });
    const sel = selectBoardDigest(root, "sessA");
    expect(sel.facts.some((f) => f.topic === "topica")).toBe(true);
    expect(sel.facts.some((f) => f.topic === "topicb")).toBe(false);
  });
});
