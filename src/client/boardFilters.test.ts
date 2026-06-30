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

// Prevent impossible filters (PROG-75). The board's filters form a hierarchy
// (Initiative → Product → Arc/Repo); changing an ancestor must drop a stranded
// descendant so the board never filters to nothing behind a stale selection.
describe("pruneImpossibleFilters", () => {
  // prd_1, prd_2 live under ini_1; prd_3 under ini_2. Arcs/repos hang off them.
  const parents = {
    productInitiative: new Map([
      ["prd_1", "ini_1"],
      ["prd_2", "ini_1"],
      ["prd_3", "ini_2"],
    ]),
    arcProduct: new Map([
      ["arc_1", "prd_1"],
      ["arc_3", "prd_3"],
    ]),
    repoProduct: new Map([
      ["repo_1", "prd_1"],
      ["repo_3", "prd_3"],
    ]),
  };
  const prune = (search: string) => {
    const params = new URLSearchParams(search);
    pruneImpossibleFilters(params, parents);
    return params.toString();
  };

  it("keeps a consistent hierarchy untouched", () => {
    expect(prune("initiative=ini_1&product=prd_1&arc=arc_1&repo=repo_1")).toBe(
      "initiative=ini_1&product=prd_1&arc=arc_1&repo=repo_1",
    );
  });

  it("drops a Product from a different Initiative", () => {
    expect(prune("initiative=ini_2&product=prd_1")).toBe("initiative=ini_2");
  });

  it("drops an Arc/Repo from a different Product", () => {
    expect(prune("product=prd_3&arc=arc_1&repo=repo_1")).toBe("product=prd_3");
  });

  it("drops an Arc/Repo whose Product left the chosen Initiative (no Product set)", () => {
    expect(prune("initiative=ini_2&arc=arc_1&repo=repo_1")).toBe("initiative=ini_2");
  });

  it("keeps an Arc/Repo consistent with the Initiative when no Product is set", () => {
    expect(prune("initiative=ini_1&arc=arc_1&repo=repo_1")).toBe(
      "initiative=ini_1&arc=arc_1&repo=repo_1",
    );
  });

  it("cascades: changing Initiative strands Product, which strands Arc/Repo", () => {
    // prd_1/arc_1/repo_1 are all under ini_1; switching to ini_2 invalidates all.
    expect(prune("initiative=ini_2&product=prd_1&arc=arc_1&repo=repo_1")).toBe("initiative=ini_2");
  });

  it("leaves unrelated filters (tag, priority, backlog) alone", () => {
    expect(prune("product=prd_3&arc=arc_1&tag=tag_1&priority=high&backlog=1")).toBe(
      "product=prd_3&tag=tag_1&priority=high&backlog=1",
    );
  });

  it("drops an Arc referencing an unknown/archived container under a Product", () => {
    expect(prune("product=prd_1&arc=arc_gone")).toBe("product=prd_1");
  });

  it("is a no-op with no ancestors selected", () => {
    expect(prune("arc=arc_1&repo=repo_3")).toBe("arc=arc_1&repo=repo_3");
  });

  // "No arc/repo" (PROG-76) belongs to no branch, so it's compatible with any
  // ancestor and must survive pruning.
  it("keeps an Arc/Repo 'none' filter under any ancestor selection", () => {
    expect(prune(`product=prd_3&arc=${FILTER_NONE}&repo=${FILTER_NONE}`)).toBe(
      `product=prd_3&arc=${FILTER_NONE}&repo=${FILTER_NONE}`,
    );
    expect(prune(`initiative=ini_2&arc=${FILTER_NONE}`)).toBe(`initiative=ini_2&arc=${FILTER_NONE}`);
  });
});

// The nullable-id filter (Arc / Repo) — the "none" sentinel matches an empty
// field; everything else is plain id equality (PROG-76).
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
