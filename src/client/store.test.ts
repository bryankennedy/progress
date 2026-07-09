// Unit tests for the store's pure key resolution (actionKeyOf/findActionByKey)
// and the moveAction rollback contract: a failed cross-focus move must restore
// exactly what the optimistic write touched — including the steps it detached
// (the server only detaches steps after a move that actually committed).
import { afterEach, describe, expect, it } from "bun:test";
import type { SnapshotPayload, WireAction, WireFocus } from "../shared/types";
import { actionKeyOf, findActionByKey, moveAction, queryClient } from "./store";

const NOW = "2026-07-07T00:00:00.000Z";
const EARLIER = "2026-07-01T00:00:00.000Z";
const WS_KEY = ["snapshot"] as const;

function focus(over: Partial<WireFocus> & Pick<WireFocus, "id" | "keyPrefix">): WireFocus {
  return {
    workspaceId: "wsp_1",
    name: over.keyPrefix,
    description: "",
    nextActionNumber: 1,
    rank: "V",
    archivedAt: null,
    creatorId: "usr_owner",
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function action(
  over: Partial<WireAction> & Pick<WireAction, "id" | "focusId" | "number">,
): WireAction {
  return {
    arcId: null,
    parentActionId: null,
    title: `Action ${over.number}`,
    description: "",
    status: "backlog",
    priority: "none",
    estimate: null,
    dueDate: null,
    rank: "V",
    creatorId: "usr_owner",
    assigneeId: "usr_owner",
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    ...over,
  };
}

function snapshot(over: Partial<SnapshotPayload>): SnapshotPayload {
  return {
    me: null,
    isSuperAdmin: false,
    allowedEmails: [],
    users: [],
    workspaces: [],
    focuses: [],
    arcs: [],
    actions: [],
    tags: [],
    actionTags: [],
    actionKeyAliases: [],
    ...over,
  };
}

describe("actionKeyOf", () => {
  const ws = snapshot({
    focuses: [focus({ id: "foc_a", keyPrefix: "PROG" })],
    actions: [action({ id: "act_1", focusId: "foc_a", number: 7 })],
  });

  it("derives the key from the focus prefix and the action number", () => {
    expect(actionKeyOf(ws, ws.actions[0]!)).toBe("PROG-7");
  });

  it("falls back to ? when the focus is missing", () => {
    expect(actionKeyOf(ws, action({ id: "act_2", focusId: "foc_gone", number: 3 }))).toBe("?-3");
  });
});

describe("findActionByKey", () => {
  const ws = snapshot({
    focuses: [focus({ id: "foc_a", keyPrefix: "PROG" })],
    actions: [action({ id: "act_1", focusId: "foc_a", number: 7 })],
    actionKeyAliases: [{ key: "OLD-3", actionId: "act_1", createdAt: NOW }],
  });

  it("resolves a canonical key", () => {
    expect(findActionByKey(ws, "PROG-7")).toEqual({ action: ws.actions[0]!, viaAlias: false });
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(findActionByKey(ws, "  prog-7 ")?.action.id).toBe("act_1");
  });

  it("falls back to an alias and reports it", () => {
    expect(findActionByKey(ws, "old-3")).toEqual({ action: ws.actions[0]!, viaAlias: true });
  });

  it("misses cleanly", () => {
    expect(findActionByKey(ws, "PROG-999")).toBeUndefined();
    expect(findActionByKey(ws, "NOPE-7")).toBeUndefined();
    expect(findActionByKey(ws, "not a key")).toBeUndefined();
  });
});

describe("moveAction rollback", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    queryClient.clear();
  });

  const settle = async () => {
    // Let the fire-and-forget move IIFE run to completion (fetch + rollback).
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  };

  function seed() {
    const ws = snapshot({
      focuses: [
        focus({ id: "foc_a", keyPrefix: "PA", nextActionNumber: 2 }),
        focus({ id: "foc_b", keyPrefix: "PB", nextActionNumber: 5 }),
      ],
      actions: [
        action({ id: "act_parent", focusId: "foc_a", number: 1 }),
        action({
          id: "act_step",
          focusId: "foc_a",
          number: 2,
          parentActionId: "act_parent",
          updatedAt: EARLIER,
        }),
      ],
    });
    queryClient.setQueryData(WS_KEY, ws);
    return ws;
  }

  const current = () => queryClient.getQueryData<SnapshotPayload>(WS_KEY)!;
  const byId = (id: string) => current().actions.find((i) => i.id === id)!;

  it("applies the cross-focus move optimistically (re-key, detach steps, alias)", () => {
    seed();
    globalThis.fetch = (() => new Promise<Response>(() => {})) as typeof fetch; // never resolves

    moveAction("act_parent", { focusId: "foc_b" });

    expect(byId("act_parent").focusId).toBe("foc_b");
    expect(byId("act_parent").number).toBe(5);
    expect(byId("act_step").parentActionId).toBeNull();
    expect(current().focuses.find((p) => p.id === "foc_b")?.nextActionNumber).toBe(6);
    expect(current().actionKeyAliases).toEqual([
      expect.objectContaining({ key: "PA-1", actionId: "act_parent" }),
    ]);
  });

  it("restores the action, its detached steps, the sequence, and the alias on failure", async () => {
    const ws = seed();
    globalThis.fetch = (() => Promise.reject(new Error("network down"))) as typeof fetch;

    moveAction("act_parent", { focusId: "foc_b" });
    await settle();

    expect(byId("act_parent")).toEqual(ws.actions[0]!);
    expect(byId("act_step").parentActionId).toBe("act_parent");
    expect(byId("act_step").updatedAt).toBe(EARLIER);
    expect(current().focuses.find((p) => p.id === "foc_b")?.nextActionNumber).toBe(5);
    expect(current().actionKeyAliases).toEqual([]);
  });

  it("is a no-op when the target focus is the action's current focus", async () => {
    seed();
    let fetched = false;
    globalThis.fetch = (() => {
      fetched = true;
      return new Promise<Response>(() => {});
    }) as typeof fetch;

    // A move now only changes the focus (PROG-102); moving to the same focus
    // returns early without touching the store or hitting the server.
    moveAction("act_parent", { focusId: "foc_a" });
    await settle();

    expect(fetched).toBe(false);
    expect(byId("act_parent").focusId).toBe("foc_a");
    expect(byId("act_step").parentActionId).toBe("act_parent");
    expect(current().focuses.find((p) => p.id === "foc_a")?.nextActionNumber).toBe(2);
    expect(current().actionKeyAliases).toEqual([]);
  });
});
