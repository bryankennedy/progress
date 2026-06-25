// Tests for the sticky-board-filter restore decision (PROG-58). The pure logic
// is unit-tested here; the end-to-end persistence (navigate away, come back,
// filter still applied) is covered by e2e/board-filters.spec.ts. Run `bun test`.
import { describe, expect, it } from "bun:test";
import { filtersToRestore, sortByName } from "./boardFilters";

describe("filtersToRestore", () => {
  it("restores the saved query when the board opens unfiltered", () => {
    expect(filtersToRestore("", "product=prd_1")).toBe("product=prd_1");
    expect(filtersToRestore("", "product=prd_1&priority=high")).toBe("product=prd_1&priority=high");
  });

  it("does not restore when nothing is saved", () => {
    expect(filtersToRestore("", "")).toBeNull();
  });

  it("leaves the URL alone when it already carries filters (bookmark / deep link)", () => {
    expect(filtersToRestore("product=prd_2", "product=prd_1")).toBeNull();
    expect(filtersToRestore("arc=arc_9&backlog=1", "product=prd_1")).toBeNull();
  });

  it("does not restore over an explicitly cleared selection (saved is empty)", () => {
    // After "Clear filters" the URL is bare and storage is emptied, so a later
    // bare-URL open must stay cleared rather than resurrect old filters.
    expect(filtersToRestore("", "")).toBeNull();
  });
});

// Alphabetical filter-dropdown options (PROG-66).
describe("sortByName", () => {
  it("orders items alphabetically by name, case-insensitively", () => {
    const items = [{ name: "Zebra" }, { name: "apple" }, { name: "Mango" }];
    expect(sortByName(items).map((i) => i.name)).toEqual(["apple", "Mango", "Zebra"]);
  });

  it("does not mutate the input (the store array stays in its original order)", () => {
    const items = [{ name: "b" }, { name: "a" }];
    const sorted = sortByName(items);
    expect(items.map((i) => i.name)).toEqual(["b", "a"]);
    expect(sorted).not.toBe(items);
  });
});
