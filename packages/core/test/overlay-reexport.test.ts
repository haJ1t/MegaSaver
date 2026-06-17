import { expect, it } from "vitest";
import { readOverlayEvents } from "../src/index.js";

it("re-exports readOverlayEvents from @megasaver/stats via core", () => {
  expect(typeof readOverlayEvents).toBe("function");
});
