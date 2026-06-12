import { Link, Route, Switch } from "wouter";
import CommandLayer from "./commands/CommandLayer";
import { useWorkspace } from "./store";
import { Toasts } from "./toast";
import ContainerPage, { type ContainerType } from "./pages/ContainerPage";
import Home from "./pages/Home";
import IssuePage from "./pages/IssuePage";

const CONTAINER_ROUTES: { path: string; type: ContainerType }[] = [
  { path: "/initiative/:id", type: "initiative" },
  { path: "/product/:id", type: "product" },
  { path: "/repo/:id", type: "repo" },
  { path: "/arc/:id", type: "arc" },
];

export default function App() {
  const { data: workspace, isPending, error } = useWorkspace();

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      {/* Wide shell for the board; narrow pages re-constrain themselves. */}
      <main className="mx-auto max-w-screen-2xl px-6 py-10">
        {/* Initial app load: the only permitted loading state (SPEC §8.2). */}
        {isPending && <p className="text-stone-400">Loading workspace…</p>}
        {error && <p className="text-red-600">{String(error)}</p>}
        {workspace && <CommandLayer workspace={workspace} />}
        {workspace && (
          <Switch>
            <Route path="/">
              <Home workspace={workspace} />
            </Route>
            <Route path="/issue/:key">
              {(params) => <IssuePage workspace={workspace} keyParam={params.key!} />}
            </Route>
            {CONTAINER_ROUTES.map(({ path, type }) => (
              <Route key={path} path={path}>
                {/* wouter can't infer named params from a non-literal path. */}
                {(params: { id?: string }) => (
                  <ContainerPage workspace={workspace} type={type} id={params.id ?? ""} />
                )}
              </Route>
            ))}
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
