import { describe, it } from "vitest";
import { CONSUMER_IDS, type ConsumerId, MODES, type Mode } from "../src/manifest.ts";

describe("Mode type regression", () => {
  it("each member is assignable to Mode", () => {
    const a: Mode = "check";
    const b: Mode = "write";
    const c: Mode = "list";
    void a;
    void b;
    void c;
  });

  it("non-member is rejected", () => {
    // @ts-expect-error non-member literal is rejected by the closed union
    const bad: Mode = "nope";
    void bad;
  });

  it("MODES is readonly", () => {
    const arr: readonly string[] = MODES;
    void arr;
  });
});

describe("ConsumerId type regression", () => {
  it("each launch-order member is assignable to ConsumerId", () => {
    const a: ConsumerId = "agents-md";
    const b: ConsumerId = "cursor-context";
    const c: ConsumerId = "cursor-conventions";
    const d: ConsumerId = "cursor-discipline";
    const e: ConsumerId = "claude-md";
    void a;
    void b;
    void c;
    void d;
    void e;
  });

  it("non-member is rejected", () => {
    // @ts-expect-error non-member literal is rejected by the closed union
    const bad: ConsumerId = "nope";
    void bad;
  });

  it("CONSUMER_IDS is readonly string[]", () => {
    const arr: readonly string[] = CONSUMER_IDS;
    void arr;
  });
});
