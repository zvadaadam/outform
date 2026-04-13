import { describe, test, expect } from "bun:test";
import { spin } from "./spinner";

describe("spinner", () => {
  test("spin() returns an object with stop and update methods", () => {
    const s = spin("test message");
    expect(typeof s.stop).toBe("function");
    expect(typeof s.update).toBe("function");
    s.stop();
  });

  test("stop() can be called with a final message", () => {
    const s = spin("loading");
    s.stop("done loading");
  });

  test("stop() can be called without arguments", () => {
    const s = spin("loading");
    s.stop();
  });

  test("update() changes the spinner message", () => {
    const s = spin("step 1");
    s.update("step 2");
    s.stop();
  });

  test("multiple spinners can be created sequentially", () => {
    const s1 = spin("first task");
    s1.stop("first done");

    const s2 = spin("second task");
    s2.stop("second done");
  });
});
