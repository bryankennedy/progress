// Unit tests for the board reorder math (PROG-43). Deterministic — no browser —
// so the off-by-one (drag-down) regression is locked down here; the e2e only
// has to prove the wiring. Run with `bun test`.
import { describe, expect, it } from "bun:test";
import { ISSUE_STATUSES, type IssueStatus } from "../shared/constants";
import { reorder, type ColumnMap } from "./boardOrder";

function makeColumns(partial: Partial<Record<IssueStatus, string[]>>): ColumnMap {
  const cols = {} as ColumnMap;
  for (const s of ISSUE_STATUSES) cols[s] = partial[s] ? [...partial[s]!] : [];
  return cols;
}

describe("reorder — within a column", () => {
  const base = () => makeColumns({ todo: ["a", "b", "c", "d"] });

  it("moves a card DOWN one slot — the off-by-one that used to snap back", () => {
    // Drop a onto b: a must land AFTER b, not back at the top.
    expect(reorder(base(), "a", "b", false)!.columns.todo).toEqual(["b", "a", "c", "d"]);
  });

  it("moves a card DOWN two slots — not 'as if one'", () => {
    expect(reorder(base(), "a", "c", false)!.columns.todo).toEqual(["b", "c", "a", "d"]);
  });

  it("moves a card UP (the direction that always worked)", () => {
    expect(reorder(base(), "d", "b", false)!.columns.todo).toEqual(["a", "d", "b", "c"]);
  });

  it("drops to the very bottom when released on the column itself", () => {
    expect(reorder(base(), "a", "todo", false)!.columns.todo).toEqual(["b", "c", "d", "a"]);
  });

  it("keeps order when a card is dropped on itself", () => {
    expect(reorder(base(), "b", "b", false)!.columns.todo).toEqual(["a", "b", "c", "d"]);
  });

  it("leaves other columns untouched", () => {
    const cols = makeColumns({ todo: ["a", "b"], done: ["x"] });
    expect(reorder(cols, "a", "b", false)!.columns.done).toEqual(["x"]);
  });
});

describe("reorder — across columns", () => {
  it("inserts ABOVE the hovered card when the pointer is above its middle", () => {
    const cols = makeColumns({ todo: ["a"], in_progress: ["x", "y"] });
    const r = reorder(cols, "a", "x", false)!;
    expect(r.to).toBe("in_progress");
    expect(r.columns.in_progress).toEqual(["a", "x", "y"]);
    expect(r.columns.todo).toEqual([]); // removed from its source column
  });

  it("inserts BELOW the hovered card when the pointer is past its middle", () => {
    const cols = makeColumns({ todo: ["a"], in_progress: ["x", "y"] });
    expect(reorder(cols, "a", "x", true)!.columns.in_progress).toEqual(["x", "a", "y"]);
  });

  it("appends when released on an empty column", () => {
    const cols = makeColumns({ todo: ["a", "b"], done: [] });
    const r = reorder(cols, "a", "done", false)!;
    expect(r.columns.done).toEqual(["a"]);
    expect(r.columns.todo).toEqual(["b"]);
  });
});

describe("reorder — invalid drops", () => {
  it("returns null for an unknown over target", () => {
    expect(reorder(makeColumns({ todo: ["a"] }), "a", "nope", false)).toBeNull();
  });

  it("returns null when the active card isn't anywhere", () => {
    expect(reorder(makeColumns({ todo: ["a"] }), "ghost", "a", false)).toBeNull();
  });
});
