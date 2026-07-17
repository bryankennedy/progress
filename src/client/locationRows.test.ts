// Unit tests for the shared location tree (PROG-117, extracted from the
// palette's PROG-123b picker): outline rank order, archived exclusion, and the
// tree-aware filter (ancestor match keeps the subtree, a match keeps its
// ancestors visible as context).
import { describe, expect, it } from "bun:test";
import { locationRows, type LocationSource } from "./locationRows";

const container = (id: string, name: string, rank = "V") => ({
  id,
  name,
  rank,
  archivedAt: null as string | null,
});

// Two workspaces; Home ranks before Work despite the name order, Chores focus
// ranks before Admin within Home the same way — filters must not disturb it.
const source: LocationSource = {
  workspaces: [container("ws_work", "Work"), container("ws_home", "Home", "K")],
  focuses: [
    { ...container("foc_admin", "Admin"), workspaceId: "ws_home" },
    { ...container("foc_chores", "Chores", "K"), workspaceId: "ws_home" },
    { ...container("foc_progress", "Progress"), workspaceId: "ws_work" },
    {
      ...container("foc_archived", "Archived focus"),
      archivedAt: "2026-01-01",
      workspaceId: "ws_work",
    },
  ],
  arcs: [
    { ...container("arc_yard", "Yard"), focusId: "foc_chores" },
    { ...container("arc_kitchen", "Kitchen", "K"), focusId: "foc_chores" },
    { ...container("arc_v2", "v2"), focusId: "foc_progress" },
    { ...container("arc_gone", "Retired"), archivedAt: "2026-01-01", focusId: "foc_progress" },
  ],
};

const flat = (query: string) => locationRows(source, query).map((r) => `${r.kind}:${r.id}`);

describe("locationRows", () => {
  it("renders the whole tree in rank order, skipping archived containers", () => {
    expect(flat("")).toEqual([
      "workspace:ws_home",
      "focus:foc_chores",
      "arc:arc_kitchen",
      "arc:arc_yard",
      "focus:foc_admin",
      "workspace:ws_work",
      "focus:foc_progress",
      "arc:arc_v2",
    ]);
  });

  it("keeps a matched row's ancestors visible as context", () => {
    expect(flat("kitchen")).toEqual(["workspace:ws_home", "focus:foc_chores", "arc:arc_kitchen"]);
  });

  it("keeps the whole subtree of a matched ancestor", () => {
    expect(flat("chores")).toEqual([
      "workspace:ws_home",
      "focus:foc_chores",
      "arc:arc_kitchen",
      "arc:arc_yard",
    ]);
    expect(flat("work")).toEqual(["workspace:ws_work", "focus:foc_progress", "arc:arc_v2"]);
  });

  it("arc rows carry their focus id for one-step focus+arc picks", () => {
    const arc = locationRows(source, "yard").find((r) => r.kind === "arc");
    expect(arc).toEqual({ kind: "arc", id: "arc_yard", name: "Yard", focusId: "foc_chores" });
  });

  it("drops a workspace header with no visible picks beneath it", () => {
    expect(flat("nowhere")).toEqual([]);
  });
});
