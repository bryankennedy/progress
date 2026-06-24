// Tests for the Structure-page archived-arc cap (PROG-45). Run with `bun test`.
import { describe, expect, it } from "bun:test";
import { ARCHIVED_INLINE_LIMIT, capArchived } from "./structureArchive";

type Node = { id: string; archivedAt: string | null };
const active = (id: string): Node => ({ id, archivedAt: null });
const archived = (id: string): Node => ({ id, archivedAt: "2026-06-01" });

describe("capArchived", () => {
  it("returns everything (a copy) when archived count is at or under the limit", () => {
    const nodes = [active("a"), active("b"), archived("x"), archived("y")];
    const out = capArchived(nodes, 5);
    expect(out.shown.map((n) => n.id)).toEqual(["a", "b", "x", "y"]);
    expect(out.hiddenCount).toBe(0);
    expect(out.shown).not.toBe(nodes); // copy, not the same array
  });

  it("keeps all active nodes and only the first N archived ones", () => {
    // active-first, archived-last (as byActive produces)
    const nodes = [active("a"), active("b"), archived("x"), archived("y"), archived("z")];
    const out = capArchived(nodes, 2);
    expect(out.shown.map((n) => n.id)).toEqual(["a", "b", "x", "y"]);
    expect(out.hiddenCount).toBe(1);
  });

  it("never drops active nodes even when many archived pile up", () => {
    const nodes = [active("a"), ...Array.from({ length: 8 }, (_, i) => archived(`x${i}`))];
    const out = capArchived(nodes, 3);
    expect(out.shown[0]!.id).toBe("a");
    expect(out.shown.filter((n) => n.archivedAt)).toHaveLength(3);
    expect(out.hiddenCount).toBe(5);
  });

  it("handles a list with no archived nodes", () => {
    const nodes = [active("a"), active("b")];
    expect(capArchived(nodes, 5).hiddenCount).toBe(0);
  });

  it("defaults to ARCHIVED_INLINE_LIMIT", () => {
    const nodes = Array.from({ length: ARCHIVED_INLINE_LIMIT + 3 }, (_, i) => archived(`x${i}`));
    const out = capArchived(nodes);
    expect(out.shown).toHaveLength(ARCHIVED_INLINE_LIMIT);
    expect(out.hiddenCount).toBe(3);
  });
});
