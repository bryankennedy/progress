// Archive (PROG-45): a low-traffic destination listing every completed
// (archived) Arc, grouped by Workspace → Focus for context. The Structure
// page shows only the first few archived arcs per focus and links here for
// the rest, so curating live structure stays uncluttered while finished work
// remains reachable. Deliberately absent from the primary nav — you arrive via
// Structure's "more" link. Unarchiving still happens on the arc page itself.

import { Link } from "wouter";
import type { SnapshotPayload } from "../../shared/types";

export default function Archive({ snapshot }: { snapshot: SnapshotPayload }) {
  const archivedArcs = snapshot.arcs
    .filter((a) => a.archivedAt)
    .sort((a, b) => a.name.localeCompare(b.name));

  const focusesById = new Map(snapshot.focuses.map((p) => [p.id, p]));
  const workspacesById = new Map(snapshot.workspaces.map((i) => [i.id, i]));

  // Group archived arcs under their focus, and focuses under their
  // workspace, so the page mirrors the Structure tree's shape.
  const byWorkspace = new Map<
    string,
    {
      workspaceName: string;
      focuses: Map<string, { focusName: string; arcs: typeof archivedArcs }>;
    }
  >();
  for (const arc of archivedArcs) {
    const focus = focusesById.get(arc.focusId);
    if (!focus) continue;
    const workspace = workspacesById.get(focus.workspaceId);
    const workspaceId = workspace?.id ?? "none";
    let initGroup = byWorkspace.get(workspaceId);
    if (!initGroup) {
      initGroup = { workspaceName: workspace?.name ?? "—", focuses: new Map() };
      byWorkspace.set(workspaceId, initGroup);
    }
    let prodGroup = initGroup.focuses.get(focus.id);
    if (!prodGroup) {
      prodGroup = { focusName: focus.name, arcs: [] };
      initGroup.focuses.set(focus.id, prodGroup);
    }
    prodGroup.arcs.push(arc);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Archive</h1>
          <p className="mt-1 text-xs text-ink-faint">
            Completed arcs, kept out of the way. {archivedArcs.length} total.
          </p>
        </div>
        <Link href="/structure" className="text-xs text-adobe hover:underline">
          ← Structure
        </Link>
      </div>

      {archivedArcs.length === 0 ? (
        <p className="mt-6 text-sm text-ink-faint">No archived arcs yet.</p>
      ) : (
        <div className="mt-6 space-y-6">
          {/* Groups list alphabetically (PROG-83); Map insertion order would
              follow whichever arc happened to be encountered first. */}
          {[...byWorkspace.values()]
            .sort((a, b) => a.workspaceName.localeCompare(b.workspaceName))
            .map((initGroup, idx) => (
              <section key={idx} className="rounded-lg border border-line bg-card p-4">
                <span className="text-[10px] uppercase tracking-wide font-mono text-ink-faint">
                  Workspace
                </span>{" "}
                <span className="text-sm font-medium text-ink-soft">{initGroup.workspaceName}</span>
                <div className="mt-3 space-y-3 border-l border-line pl-4">
                  {[...initGroup.focuses.values()]
                    .sort((a, b) => a.focusName.localeCompare(b.focusName))
                    .map((prodGroup, pIdx) => (
                      <div key={pIdx}>
                        <span className="text-[10px] uppercase tracking-wide font-mono text-ink-faint">
                          Focus
                        </span>{" "}
                        <span className="text-sm font-medium text-ink-soft">
                          {prodGroup.focusName}
                        </span>
                        <div className="mt-1 flex flex-col items-start gap-0.5 border-l border-line pl-3 text-sm">
                          {prodGroup.arcs.map((arc) => (
                            <Link
                              key={arc.id}
                              href={`/arc/${arc.id}`}
                              className="rounded px-1.5 py-0.5 font-medium text-ink-faint line-through hover:bg-line"
                            >
                              {arc.name}
                            </Link>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              </section>
            ))}
        </div>
      )}
    </div>
  );
}
