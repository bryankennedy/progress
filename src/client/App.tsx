import { useEffect, useState } from "react";

type User = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
};

type Workspace = {
  users: User[];
};

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; workspace: Workspace; ms: number };

export default function App() {
  const [state, setState] = useState<LoadState>({ phase: "loading" });

  useEffect(() => {
    const start = performance.now();
    fetch("/api/workspace")
      .then((res) => {
        if (!res.ok) throw new Error(`workspace load failed: HTTP ${res.status}`);
        return res.json() as Promise<Workspace>;
      })
      .then((workspace) =>
        setState({
          phase: "ready",
          workspace,
          ms: Math.round(performance.now() - start),
        }),
      )
      .catch((err: unknown) =>
        setState({ phase: "error", message: String(err) }),
      );
  }, []);

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">Progress</h1>
        <p className="mt-2 text-stone-500">
          Walking skeleton — D1 → Drizzle → Hono → React, end to end.
        </p>

        <section className="mt-10 rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
          {state.phase === "loading" && (
            <p className="text-stone-400">Loading workspace…</p>
          )}

          {state.phase === "error" && (
            <p className="text-red-600">{state.message}</p>
          )}

          {state.phase === "ready" && (
            <>
              <h2 className="text-sm font-medium uppercase tracking-wide text-stone-400">
                Workspace
              </h2>
              <ul className="mt-3 space-y-2">
                {state.workspace.users.map((user) => (
                  <li key={user.id} className="flex items-baseline gap-3">
                    <span className="font-medium">{user.name}</span>
                    <span className="text-sm text-stone-500">{user.email}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs text-stone-400">
                Loaded from D1 in {state.ms} ms
              </p>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
