// Tests for the sticky-board-filter restore decision (PROG-58). The pure logic
// is unit-tested here; the end-to-end persistence (navigate away, come back,
// filter still applied) is covered by e2e/board-filters.spec.ts. Run `bun test`.
import { describe, expect, it } from "bun:test";
import {
  FILTER_NONE,
  filtersToRestore,
  matchesNullableId,
  pruneImpossibleFilters,
  sortByName,
} from "./boardFilters";

describe("filtersToRestore", () => {
  it("restores the saved query when the board opens unfiltered", () => {
    expect(filtersToRestore("", "focus=foc_1")).toBe("focus=foc_1");
    expect(filtersToRestore("", "focus=foc_1&priority=high")).toBe("focus=foc_1&priority=high");
  });

  it("does not restore when nothing is saved", () => {
    expect(filtersToRestore("", "")).toBeNull();
  });

  it("leaves the URL alone when it already carries filters (bookmark / deep link)", () => {
    expect(filtersToRestore("focus=foc_2", "focus=foc_1")).toBeNull();
    expect(filtersToRestore("arc=arc_9&backlog=1", "focus=foc_1")).toBeNull();
  });

  it("does not restore over an explicitly cleared selection (saved is empty)", () => {
    // After "Clear filters" the URL is bare and storage is emptied, so a later
    // bare-URL open must stay cleared rather than resurrect old filters.
    expect(filtersToRestore("", "")).toBeNull();
  });
});

// Prevent impossible filters (PROG-75). The board's filters form a hierarchy
// (Workspace → Focus → Arc); changing an ancestor must drop a stranded
// descendant so the board never filters to nothing behind a stale selection.
describe("pruneImpossibleFilters", () => {
  // foc_1, foc_2 live under wsp_1; foc_3 under wsp_2. Arcs hang off them.
  const parents = {
    focusWorkspace: new Map([
      ["foc_1", "wsp_1"],
      ["foc_2", "wsp_1"],
      ["foc_3", "wsp_2"],
    ]),
    arcFocus: new Map([
      ["arc_1", "foc_1"],
      ["arc_3", "foc_3"],
    ]),
  };
  const prune = (search: string) => {
    const params = new URLSearchParams(search);
    pruneImpossibleFilters(params, parents);
    return params.toString();
  };

  it("keeps a consistent hierarchy untouched", () => {
    expect(prune("workspace=wsp_1&focus=foc_1&arc=arc_1")).toBe(
      "workspace=wsp_1&focus=foc_1&arc=arc_1",
    );
  });

  it("drops a Focus from a different Workspace", () => {
    expect(prune("workspace=wsp_2&focus=foc_1")).toBe("workspace=wsp_2");
  });

  it("drops an Arc from a different Focus", () => {
    expect(prune("focus=foc_3&arc=arc_1")).toBe("focus=foc_3");
  });

  it("drops an Arc whose Focus left the chosen Workspace (no Focus set)", () => {
    expect(prune("workspace=wsp_2&arc=arc_1")).toBe("workspace=wsp_2");
  });

  it("keeps an Arc consistent with the Workspace when no Focus is set", () => {
    expect(prune("workspace=wsp_1&arc=arc_1")).toBe("workspace=wsp_1&arc=arc_1");
  });

  it("cascades: changing Workspace strands Focus, which strands Arc", () => {
    // foc_1/arc_1 are all under wsp_1; switching to wsp_2 invalidates all.
    expect(prune("workspace=wsp_2&focus=foc_1&arc=arc_1")).toBe("workspace=wsp_2");
  });

  it("leaves unrelated filters (tag, priority, backlog) alone", () => {
    expect(prune("focus=foc_3&arc=arc_1&tag=tag_1&priority=high&backlog=1")).toBe(
      "focus=foc_3&tag=tag_1&priority=high&backlog=1",
    );
  });

  it("drops an Arc referencing an unknown/archived container under a Focus", () => {
    expect(prune("focus=foc_1&arc=arc_gone")).toBe("focus=foc_1");
  });

  it("is a no-op with no ancestors selected", () => {
    expect(prune("arc=arc_1")).toBe("arc=arc_1");
  });

  // "No arc" (PROG-76) belongs to no branch, so it's compatible with any
  // ancestor and must survive pruning.
  it("keeps an Arc 'none' filter under any ancestor selection", () => {
    expect(prune(`focus=foc_3&arc=${FILTER_NONE}`)).toBe(`focus=foc_3&arc=${FILTER_NONE}`);
    expect(prune(`workspace=wsp_2&arc=${FILTER_NONE}`)).toBe(`workspace=wsp_2&arc=${FILTER_NONE}`);
  });
});

// The nullable-id filter (Arc) — the "none" sentinel matches an empty field;
// everything else is plain id equality (PROG-76).
describe("matchesNullableId", () => {
  it("matches only empty fields when the filter is the 'none' sentinel", () => {
    expect(matchesNullableId(null, FILTER_NONE)).toBe(true);
    expect(matchesNullableId("arc_1", FILTER_NONE)).toBe(false);
  });

  it("matches by id equality otherwise (and an empty field never equals an id)", () => {
    expect(matchesNullableId("arc_1", "arc_1")).toBe(true);
    expect(matchesNullableId("arc_1", "arc_2")).toBe(false);
    expect(matchesNullableId(null, "arc_1")).toBe(false);
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
