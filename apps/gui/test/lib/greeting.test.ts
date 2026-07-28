import { describe, expect, it } from "vitest";
import { greeting } from "../../src/lib/greeting.js";

function at(hour: number): Date {
  const d = new Date(2026, 6, 28, hour, 0, 0);
  return d;
}

describe("greeting", () => {
  it("covers the whole day with no gap at the boundaries", () => {
    expect(greeting(at(0))).toBe("Good morning");
    expect(greeting(at(11))).toBe("Good morning");
    expect(greeting(at(12))).toBe("Good afternoon");
    expect(greeting(at(17))).toBe("Good afternoon");
    expect(greeting(at(18))).toBe("Good evening");
    expect(greeting(at(23))).toBe("Good evening");
  });
});
