// Unit tests for the Agenda quick-add date math (PROG-89). Deterministic — no
// browser, no clock: `today` is always passed in.
import { describe, expect, it } from "bun:test";
import { quickAddDueDate } from "./agendaQuickAdd";
import { bucketOf } from "./dates";

const TODAY = "2026-07-06";

describe("quickAddDueDate", () => {
  it("Today → due today", () => {
    expect(quickAddDueDate("today", TODAY)).toBe("2026-07-06");
  });

  it("This week → the last day of the rolling window (today+6)", () => {
    expect(quickAddDueDate("week", TODAY)).toBe("2026-07-12");
  });

  it("Later → the first day beyond the window (today+7)", () => {
    expect(quickAddDueDate("later", TODAY)).toBe("2026-07-13");
  });

  it("crosses month ends correctly", () => {
    expect(quickAddDueDate("week", "2026-07-28")).toBe("2026-08-03");
    expect(quickAddDueDate("later", "2026-12-28")).toBe("2027-01-04");
  });

  it("Overdue has no quick-add date", () => {
    expect(quickAddDueDate("overdue", TODAY)).toBeNull();
  });

  it("every minted date lands back in the bucket it was typed under", () => {
    for (const bucket of ["today", "week", "later"] as const) {
      const due = quickAddDueDate(bucket, TODAY)!;
      expect(bucketOf(due, TODAY)).toBe(bucket);
    }
  });
});
