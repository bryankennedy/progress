// Tests for the shared tag-chip lookup (PROG-83) and the chip tint math
// (PROG-145): the lookup's alphabetical-order guarantee, and the computed
// wash/border/text treatment's WCAG floor across the whole brand hue set.
import { describe, expect, it } from "bun:test";
import type { SnapshotPayload } from "../shared/types";
import { TAG_COLORS } from "../shared/constants";
import { contrastRatio, tagChipStyle, tagsByAction } from "./tags";

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

describe("tagChipStyle", () => {
  it("blends the wash at 15% over white (spot-check with black)", () => {
    // 255 * 0.85 = 216.75 → 217 = 0xd9 on every channel.
    expect(tagChipStyle("#000000").backgroundColor).toBe("#d9d9d9");
  });

  it("keeps text ≥4.5:1 (WCAG AA) on the wash for every brand hue", () => {
    for (const hue of TAG_COLORS) {
      const { backgroundColor, color } = tagChipStyle(hue);
      expect(contrastRatio(color, backgroundColor)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps the wash and border light — tints over the white card, not fills", () => {
    for (const hue of TAG_COLORS) {
      const { backgroundColor, borderColor } = tagChipStyle(hue);
      // A 15% wash stays close to white (low contrast vs the card)…
      expect(contrastRatio(backgroundColor, "#ffffff")).toBeLessThan(1.5);
      // …and the 30% border is a deeper tint of the same hue than the wash.
      expect(contrastRatio(borderColor, "#ffffff")).toBeGreaterThan(
        contrastRatio(backgroundColor, "#ffffff"),
      );
    }
  });

  it("already-dark hues pass through undarkened", () => {
    // Ultramarine-ish navy: well past 4.5:1 on its own 15% wash already.
    const { color } = tagChipStyle("#2d3c96");
    expect(color).toBe("#2d3c96");
  });

  it("memoizes per hue", () => {
    expect(tagChipStyle("#F2C42E")).toBe(tagChipStyle("#F2C42E"));
  });
});
