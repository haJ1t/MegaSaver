import { describe, expect, it } from "vitest";
import {
  MEGA_SAVER_BLOCK_END,
  MEGA_SAVER_BLOCK_START,
} from "../src/constants.js";

describe("connectors-shared constants", () => {
  it("uses HTML comment sentinels", () => {
    expect(MEGA_SAVER_BLOCK_START).toBe("<!-- MEGA SAVER:BEGIN -->");
    expect(MEGA_SAVER_BLOCK_END).toBe("<!-- MEGA SAVER:END -->");
  });
});
