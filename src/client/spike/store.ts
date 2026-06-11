// Bespoke-store prototype: normalized Maps with per-issue and per-column
// subscriptions. A status change rebuilds exactly two column arrays and
// notifies one card + two columns — everything else is structurally
// untouched.

import {
  nextStatus,
  patchStatus,
  SPIKE_STATUSES,
  type SpikeStatus,
  type WireIssue,
  type WireWorkspace,
} from "./types";

type Listener = () => void;

export class SpikeStore {
  private issues = new Map<string, WireIssue>();
  private columns = new Map<SpikeStatus, string[]>();
  private issueListeners = new Map<string, Set<Listener>>();
  private columnListeners = new Map<SpikeStatus, Set<Listener>>();
  prefixes = new Map<string, string>();
  issueIds: string[] = [];

  load(ws: WireWorkspace) {
    for (const p of ws.products) this.prefixes.set(p.id, p.keyPrefix);
    const byStatus = new Map<SpikeStatus, WireIssue[]>(SPIKE_STATUSES.map((s) => [s, []]));
    for (const issue of ws.issues) {
      this.issues.set(issue.id, issue);
      this.issueIds.push(issue.id);
      byStatus.get(issue.status)!.push(issue);
    }
    for (const [status, group] of byStatus) {
      group.sort((a, b) => a.number - b.number);
      this.columns.set(status, group.map((i) => i.id));
    }
  }

  getIssue = (id: string) => this.issues.get(id)!;
  getColumn = (status: SpikeStatus) => this.columns.get(status) ?? [];

  subscribeIssue(id: string, cb: Listener) {
    let set = this.issueListeners.get(id);
    if (!set) this.issueListeners.set(id, (set = new Set()));
    set.add(cb);
    return () => set.delete(cb);
  }

  subscribeColumn(status: SpikeStatus, cb: Listener) {
    let set = this.columnListeners.get(status);
    if (!set) this.columnListeners.set(status, (set = new Set()));
    set.add(cb);
    return () => set.delete(cb);
  }

  // Synchronous optimistic write; server sync in the background with revert
  // on failure (SPEC §8.2).
  cycleStatus(id: string) {
    const from = this.issues.get(id)!.status;
    const to = nextStatus(from);
    this.setStatus(id, to);
    void patchStatus(id, to).then((ok) => {
      if (!ok) this.setStatus(id, from);
    });
  }

  private setStatus(id: string, to: SpikeStatus) {
    const issue = this.issues.get(id)!;
    const from = issue.status;
    if (from === to) return;
    const updated = { ...issue, status: to };
    this.issues.set(id, updated);

    this.columns.set(from, this.getColumn(from).filter((x) => x !== id));
    const target = [...this.getColumn(to)];
    const idx = target.findIndex((x) => this.issues.get(x)!.number > updated.number);
    target.splice(idx === -1 ? target.length : idx, 0, id);
    this.columns.set(to, target);

    for (const cb of this.issueListeners.get(id) ?? []) cb();
    for (const cb of this.columnListeners.get(from) ?? []) cb();
    for (const cb of this.columnListeners.get(to) ?? []) cb();
  }
}
