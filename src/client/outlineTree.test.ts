// Unit tests for the Outline's tree math (PROG-124/PROG-86): sibling ordering,
// the single definition of "sibling group", and forest assembly — including the
// arc scoping rule (arcId gates the top level only; steps inherit their
// parent's arc) and the hide-done subtree-drop semantics.
import { describe, expect, it } from "bun:test";
import type { WireAction } from "../shared/types";
import { buildForest, byRankThenNumber, siblingsOf, type OutlineNode } from "./outlineTree";

const NOW = "2026-07-07T00:00:00.000Z";

function action(over: Partial<WireAction> & Pick<WireAction, "id" | "number">): WireAction {
  return {
    focusId: "foc_1",
    arcId: null,
    parentActionId: null,
    title: over.id,
    description: "",
    status: "todo",
    priority: "none",
    estimate: null,
    dueDate: null,
    rank: "V",
    creatorId: "usr_owner",
    assigneeId: null,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    ...over,
  };
}

// Flatten a forest into [id, depth] pairs in rendered order, for terse asserts.
const flat = (forest: OutlineNode[]): [string, number][] => {
  const rows: [string, number][] = [];
  const walk = (nodes: OutlineNode[]) => {
    for (const n of nodes) {
      rows.push([n.action.id, n.depth]);
      walk(n.children);
    }
  };
  walk(forest);
  return rows;
};

describe("byRankThenNumber", () => {
  it("orders by rank first (code-unit order), number as tiebreak", () => {
    const list = [
      action({ id: "c", number: 1, rank: "W" }),
      action({ id: "b", number: 9, rank: "K" }),
      action({ id: "a", number: 2, rank: "K" }),
    ];
    expect(list.sort(byRankThenNumber).map((a) => a.id)).toEqual(["a", "b", "c"]);
  });
});

describe("siblingsOf", () => {
  const actions = [
    action({ id: "loose_1", number: 1 }),
    action({ id: "loose_2", number: 2, rank: "A" }),
    action({ id: "in_arc", number: 3, arcId: "arc_x" }),
    action({ id: "other_focus", number: 4, focusId: "foc_2" }),
    // Steps of loose_1 — one carries a (stale/inherited) arcId, which must NOT
    // exclude it below the top level.
    action({ id: "step_a", number: 5, parentActionId: "loose_1", rank: "Q" }),
    action({ id: "step_b", number: 6, parentActionId: "loose_1", rank: "B", arcId: "arc_x" }),
  ];

  it("scopes the top level by focus and arc, sorted", () => {
    expect(siblingsOf(actions, "foc_1", null, null).map((a) => a.id)).toEqual([
      "loose_2",
      "loose_1",
    ]);
    expect(siblingsOf(actions, "foc_1", null, "arc_x").map((a) => a.id)).toEqual(["in_arc"]);
  });

  it("ignores arcId below the top level (steps inherit the parent's arc)", () => {
    expect(siblingsOf(actions, "foc_1", "loose_1", null).map((a) => a.id)).toEqual([
      "step_b",
      "step_a",
    ]);
  });
});

describe("buildForest", () => {
  const actions = [
    action({ id: "root_2", number: 1, rank: "W" }),
    action({ id: "root_1", number: 2, rank: "B" }),
    action({ id: "arc_root", number: 3, arcId: "arc_x" }),
    action({ id: "step_1", number: 4, parentActionId: "root_1" }),
    action({ id: "step_1_1", number: 5, parentActionId: "step_1" }),
    action({ id: "arc_step", number: 6, parentActionId: "arc_root", arcId: "arc_x" }),
    action({ id: "elsewhere", number: 7, focusId: "foc_2" }),
  ];

  it("builds the loose (no-arc) forest depth-first in rank order", () => {
    expect(flat(buildForest(actions, "foc_1", null, 0))).toEqual([
      ["root_1", 0],
      ["step_1", 1],
      ["step_1_1", 2],
      ["root_2", 0],
    ]);
  });

  it("scopes an arc forest to that arc and honours the starting depth", () => {
    expect(flat(buildForest(actions, "foc_1", "arc_x", 1))).toEqual([
      ["arc_root", 1],
      ["arc_step", 2],
    ]);
  });

  it("drops a whole subtree when the parent is filtered out (hide done)", () => {
    const visible = actions.filter((a) => a.id !== "root_1");
    expect(flat(buildForest(visible, "foc_1", null, 0))).toEqual([["root_2", 0]]);
  });

  it("never leaks actions from another focus", () => {
    expect(flat(buildForest(actions, "foc_2", null, 0))).toEqual([["elsewhere", 0]]);
  });

  it("sorts every sibling group independently by rank then number", () => {
    const many = [
      action({ id: "p", number: 1 }),
      action({ id: "kid_late", number: 2, parentActionId: "p", rank: "X" }),
      action({ id: "kid_tie_hi", number: 9, parentActionId: "p", rank: "M" }),
      action({ id: "kid_tie_lo", number: 3, parentActionId: "p", rank: "M" }),
    ];
    expect(flat(buildForest(many, "foc_1", null, 0))).toEqual([
      ["p", 0],
      ["kid_tie_lo", 1],
      ["kid_tie_hi", 1],
      ["kid_late", 1],
    ]);
  });
});
