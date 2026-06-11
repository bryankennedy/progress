import { Link, Route, Switch } from "wouter";
import { useWorkspace } from "./store";
import { Toasts } from "./toast";
import Home from "./pages/Home";
import IssuePage from "./pages/IssuePage";

export default function App() {
  const { data: workspace, isPending, error } = useWorkspace();

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <main className="mx-auto max-w-3xl px-6 py-12">
        {/* Initial app load: the only permitted loading state (SPEC §8.2). */}
        {isPending && <p className="text-stone-400">Loading workspace…</p>}
        {error && <p className="text-red-600">{String(error)}</p>}
        {workspace && (
          <Switch>
            <Route path="/">
              <Home workspace={workspace} />
            </Route>
            <Route path="/issue/:key">
              {(params) => <IssuePage workspace={workspace} keyParam={params.key!} />}
            </Route>
            <Route>
              <p className="text-stone-500">
                Nothing here.{" "}
                <Link href="/" className="text-sky-600 hover:underline">
                  Back to the workspace
                </Link>
              </p>
            </Route>
          </Switch>
        )}
      </main>
      <Toasts />
    </div>
  );
}
