// Tests for the shared tag-chip lookup (PROG-83). Pure snapshot → Map; the
// chip order guarantee (alphabetical, not link insertion order) lives here.
import { describe, expect, it } from "bun:test";
import type { SnapshotPayload } from "../shared/types";
import { tagsByAction } from "./tags";

function ws(over: Partial<SnapshotPayload>): SnapshotPayload {
  return { tags: [], actionTags: [], ...over } as unknown as SnapshotPayload;
}

describe("tagsByAction", () => {
  it("lists each action's tags alphabetically regardless of link order", () => {
    const data = ws({
      tags: [
        { id: "t1", name: "zulu" },
        { id: "t2", name: "Alpha" },
        { id: "t3", name: "mike" },
      ] as never,
      actionTags: [
        { actionId: "i1", tagId: "t1" },
        { actionId: "i1", tagId: "t3" },
        { actionId: "i1", tagId: "t2" },
        { actionId: "i2", tagId: "t1" },
      ] as never,
    });
    const map = tagsByAction(data);
    expect(map.get("i1")?.map((t) => t.name)).toEqual(["Alpha", "mike", "zulu"]);
    expect(map.get("i2")?.map((t) => t.name)).toEqual(["zulu"]);
  });

  it("drops links whose tag no longer exists and actions with no links", () => {
    const data = ws({
      tags: [{ id: "t1", name: "real" }] as never,
      actionTags: [
        { actionId: "i1", tagId: "t1" },
        { actionId: "i1", tagId: "gone" },
      ] as never,
    });
    const map = tagsByAction(data);
    expect(map.get("i1")?.map((t) => t.name)).toEqual(["real"]);
    expect(map.has("i2")).toBe(false);
  });
});
