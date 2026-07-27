import { expect, it } from "vitest";
import config from "../vitest.config.js";

it("uses one internal worker fork", () => {
  expect(config.test?.poolOptions?.forks?.singleFork).toBe(true);
});
