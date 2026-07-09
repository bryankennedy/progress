// Tag-chip lookup shared by the board and Agenda cards (PROG-83). One
// builder instead of a copy per page, so the chip order can't drift between
// views: links resolve through the snapshot's tag table and each action's
// chips list alphabetically — tags have no rank, and actionTags insertion
// order is meaningless to the reader.

import type { SnapshotPayload, WireTag } from "../shared/types";
import { sortByName } from "./boardFilters";

export function tagsByAction(ws: SnapshotPayload): Map<string, WireTag[]> {
  const tagById = new Map(ws.tags.map((t) => [t.id, t]));
  const map = new Map<string, WireTag[]>();
  for (const link of ws.actionTags) {
    const tag = tagById.get(link.tagId);
    if (!tag) continue;
    const list = map.get(link.actionId) ?? [];
    list.push(tag);
    map.set(link.actionId, list);
  }
  for (const [actionId, list] of map) map.set(actionId, sortByName(list));
  return map;
}
