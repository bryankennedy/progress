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
  it("renders the wash/border as color-mix over the theme's --color-card token (PROG-150)", () => {
    // Themed cards move (porcelain/adobe/sanzo), so the mix target is the
    // live CSS variable, not a baked-in white — this is what makes chips
    // follow the active theme with zero JS involvement.
    const { backgroundColor, borderColor } = tagChipStyle("#000000");
    expect(backgroundColor).toBe("color-mix(in srgb, #000000 15%, var(--color-card))");
    expect(borderColor).toBe("color-mix(in srgb, #000000 30%, var(--color-card))");
  });

  it("keeps text ≥4.5:1 (WCAG AA) on the wash for every brand hue, on every theme card", () => {
    // The three theme cards, all near-white (PROG-150): porcelain, adobe, sanzo.
    const cards = ["#ffffff", "#fdfaf3", "#fefbf3"];
    for (const hue of TAG_COLORS) {
      const { color } = tagChipStyle(hue);
      for (const card of cards) {
        expect(contrastRatio(color, card)).toBeGreaterThanOrEqual(4.5);
      }
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
