import { describe, expect, it } from "vitest";
import { parseGoTest } from "../src/parsers/go-test.js";

// B8 against the A1 contract: a panicking test never prints `--- FAIL:`, so
// its panic message and goroutine stack must not be dropped just because
// another block survives.

const GO_TEST_PANIC = [
  "=== RUN   TestAdd",
  "--- PASS: TestAdd (0.00s)",
  "=== RUN   TestBoom",
  "panic: runtime error: index out of range [3] with length 3 [recovered]",
  "	goroutine 6 [running]:",
  "	example.com/math.Boom(0x3)",
  "		/app/math.go:22 +0x85",
  "=== RUN   TestDivide",
  "    math_test.go:15: Divide(1, 0) = 0; want error",
  "--- FAIL: TestDivide (0.00s)",
  "FAIL",
  "exit status 1",
  "FAIL\texample.com/math\t0.012s",
].join("\n");

describe("parseGoTest — panic survival (B8)", () => {
  it("keeps a panicking test's block: panic line and stack", () => {
    const { chunks } = parseGoTest(GO_TEST_PANIC);
    const boom = chunks.find((c) => c.text.includes("TestBoom"));
    expect(boom).toBeDefined();
    expect(boom?.text).toContain("panic: runtime error: index out of range");
    expect(boom?.text).toContain("goroutine 6");
    expect(boom?.text).toContain("/app/math.go:22");
  });

  it("still keeps the regular FAIL block and collapses the pass", () => {
    const { chunks } = parseGoTest(GO_TEST_PANIC);
    expect(chunks.some((c) => c.text.includes("TestDivide"))).toBe(true);
    expect(chunks.some((c) => c.text.includes("TestAdd"))).toBe(false);
  });

  it("a pure-panic run (no --- FAIL: anywhere) keeps the panic", () => {
    const only = [
      "=== RUN   TestBoom",
      "panic: runtime error: nil pointer dereference",
      "	goroutine 1 [running]:",
      "FAIL\texample.com/x\t0.001s",
    ].join("\n");
    const { chunks } = parseGoTest(only);
    expect(chunks.some((c) => c.text.includes("panic: runtime error"))).toBe(true);
  });
});
