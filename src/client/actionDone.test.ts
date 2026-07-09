// Tests for the shared closed-action styling helper (PROG-100). Run with `bun test`.
import { describe, expect, it } from "bun:test";
import { ACTION_STATUSES } from "../shared/constants";
import { CLOSED_TITLE_CLASS, closedTitleClass } from "./actionDone";

describe("closedTitleClass", () => {
  it("returns the closed treatment for done and canceled", () => {
    expect(closedTitleClass("done")).toBe(CLOSED_TITLE_CLASS);
    expect(closedTitleClass("canceled")).toBe(CLOSED_TITLE_CLASS);
  });

  it("gives done and canceled the identical look", () => {
    // The owner's requirement: a canceled action reads the same as a done one.
    expect(closedTitleClass("canceled")).toBe(closedTitleClass("done"));
  });

  it("returns an empty string for every open status", () => {
    for (const status of ACTION_STATUSES) {
      if (status === "done" || status === "canceled") continue;
      expect(closedTitleClass(status)).toBe("");
    }
  });
});
