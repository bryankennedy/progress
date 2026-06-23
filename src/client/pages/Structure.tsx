// Structure overview (SPEC v2 §4, DECISIONS D40): a dedicated destination for
// curating the Initiative → Product → (Repo · Arc) tree, with an inline
// "+ add" on each node. A first-class home for structure work that keeps the
// board uncluttered. Reuses the existing optimistic container create flow
// (openCreateContainer → CreateContainerDialog); no new write paths.

import { Link } from "wouter";
import type { WorkspacePayload } from "../../shared/types";
import { openCreateContainer } from "../commands/controller";

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded border border-dashed border-line px-2 py-0.5 text-xs text-ink-faint hover:border-ink-faint hover:text-ink-soft"
    >
      + {label}
    </button>
  );
}

function NodeLink({
  href,
  name,
  archived,
  muted = false,
}: {
  href: string;
  name: string;
  archived: boolean;
  muted?: boolean;
}) {
  // `muted` (repos) reads as supporting detail beneath the arc — lower-contrast
  // and italic so the more important arcs stay visually primary.
  const tone = archived ? "text-ink-faint line-through" : muted ? "text-ink-soft" : "text-ink";
  return (
    <Link
      href={href}
      className={`rounded px-1.5 py-0.5 hover:bg-line ${muted ? "italic font-normal" : "font-medium"} ${tone}`}
    >
      {name}
    </Link>
  );
}

// A labeled list of like-kind nodes (all Repos, or all Arcs) under a Product —
// the type word appears once as a section heading instead of being repeated on
// every row, mirroring the Initiative/Product tree above. `muted` dims the
// whole group (used for repos, which sit below the more important arcs).
function NodeGroup({
  label,
  nodes,
  hrefBase,
  muted = false,
}: {
  label: string;
  nodes: { id: string; name: string; archivedAt: string | null }[];
  hrefBase: string;
  muted?: boolean;
}) {
  if (nodes.length === 0) return null;
  return (
    <div>
      <span className="text-[10px] uppercase tracking-wide font-mono text-ink-faint">{label}</span>
      <div className="mt-1 flex flex-col items-start gap-0.5 border-l border-line pl-3 text-sm">
        {nodes.map((n) => (
          <NodeLink
            key={n.id}
            href={`${hrefBase}/${n.id}`}
            name={n.name}
            archived={!!n.archivedAt}
            muted={muted}
          />
        ))}
      </div>
    </div>
  );
}

export default function Structure({ workspace }: { workspace: WorkspacePayload }) {
  // Active first, archived last (dimmed), so curating stays focused on live
  // structure while archived nodes remain reachable to unarchive.
  const byActive = <T extends { archivedAt: string | null; name: string }>(list: T[]) =>
    [...list].sort(
      (a, b) =>
        Number(!!a.archivedAt) - Number(!!b.archivedAt) || a.name.localeCompare(b.name),
    );

  const initiatives = byActive(workspace.initiatives);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Structure</h1>
          <p className="mt-1 text-xs text-ink-faint">
            The Initiative → Product → Arc tree. Add anywhere; click a node to open it.
          </p>
        </div>
        <AddButton label="New initiative" onClick={() => openCreateContainer({ kind: "initiative" })} />
      </div>

      <div className="mt-6 space-y-6">
        {initiatives.map((initiative) => {
          const products = byActive(
            workspace.products.filter((p) => p.initiativeId === initiative.id),
          );
          return (
            <section key={initiative.id} className="rounded-lg border border-line bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] uppercase tracking-wide font-mono text-ink-faint">Initiative</span>
                <NodeLink
                  href={`/initiative/${initiative.id}`}
                  name={initiative.name}
                  archived={!!initiative.archivedAt}
                />
                <AddButton
                  label="Product"
                  onClick={() => openCreateContainer({ kind: "product", initiativeId: initiative.id })}
                />
              </div>

              <div className="mt-3 space-y-3 border-l border-line pl-4">
                {products.length === 0 && (
                  <p className="text-xs text-ink-faint">No products yet.</p>
                )}
                {products.map((product) => {
                  const repos = byActive(workspace.repos.filter((r) => r.productId === product.id));
                  const arcs = byActive(workspace.arcs.filter((a) => a.productId === product.id));
                  return (
                    <div key={product.id}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[10px] uppercase tracking-wide font-mono text-ink-faint">
                          Product
                        </span>
                        <NodeLink
                          href={`/product/${product.id}`}
                          name={product.name}
                          archived={!!product.archivedAt}
                        />
                        <span className="font-mono text-[11px] text-ink-faint">
                          {product.keyPrefix}
                        </span>
                        <AddButton
                          label="Repo"
                          onClick={() => openCreateContainer({ kind: "repo", productId: product.id })}
                        />
                        <AddButton
                          label="Arc"
                          onClick={() => openCreateContainer({ kind: "arc", productId: product.id })}
                        />
                      </div>
                      {(repos.length > 0 || arcs.length > 0) && (
                        <div className="mt-2 space-y-2 border-l border-line pl-4">
                          <NodeGroup
                            label={arcs.length === 1 ? "Arc" : "Arcs"}
                            nodes={arcs}
                            hrefBase="/arc"
                          />
                          <NodeGroup
                            label={repos.length === 1 ? "Repo" : "Repos"}
                            nodes={repos}
                            hrefBase="/repo"
                            muted
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
        {initiatives.length === 0 && (
          <p className="text-sm text-ink-faint">
            No initiatives yet. Create one to start building structure.
          </p>
        )}
      </div>
    </div>
  );
}
