import { Link, Route, Switch } from "wouter";
import CommandLayer from "./commands/CommandLayer";
import Header from "./Header";
import MobileTabBar from "./MobileTabBar";
import InstallPrompt from "./pwa/InstallPrompt";
import SignIn from "./SignIn";
import { UnauthenticatedError, useWorkspace } from "./store";
import { Toasts } from "./toast";
import Admin from "./pages/Admin";
import Agenda from "./pages/Agenda";
import Archive from "./pages/Archive";
import ContainerPage, { type ContainerType } from "./pages/ContainerPage";
import Home from "./pages/Home";
import IssuePage from "./pages/IssuePage";
import Outline from "./pages/Outline";
import Search from "./pages/Search";
import Structure from "./pages/Structure";

const CONTAINER_ROUTES: { path: string; type: ContainerType }[] = [
  { path: "/initiative/:id", type: "initiative" },
  { path: "/product/:id", type: "product" },
  { path: "/repo/:id", type: "repo" },
  { path: "/arc/:id", type: "arc" },
];

export default function App() {
  const { data: workspace, isPending, error } = useWorkspace();

  // Not signed in: the landing page is the whole screen (no header/shell).
  if (error instanceof UnauthenticatedError) return <SignIn />;

  return (
    // min-h-dvh (not min-h-screen): tracks the live iOS viewport so the canvas
    // fills the screen without overflowing under the dynamic Safari toolbar.
    <div className="min-h-dvh bg-canvas text-ink">
      {workspace && <Header />}
      {/* Wide shell for the board; narrow pages re-constrain themselves.
          Tighter padding on phones — the board needs the width. Top gap is
          kept small so content sits just under the sticky header, with roomier
          bottom padding for scroll breathing room (PROG-69). The extra mobile
          bottom padding (pb-24) clears the fixed bottom tab bar (PROG-79). */}
      <main className="mx-auto max-w-screen-2xl px-3 pb-24 pt-3 sm:px-6 sm:pb-10 sm:pt-4">
        {/* Initial app load: the only permitted loading state (SPEC §8.2). */}
        {isPending && <p className="text-ink-faint">Loading workspace…</p>}
        {error && <p className="text-danger">{String(error)}</p>}
        {workspace && <CommandLayer workspace={workspace} />}
        {workspace && (
          <Switch>
            <Route path="/">
              <Home workspace={workspace} />
            </Route>
            <Route path="/agenda">
              <Agenda workspace={workspace} />
            </Route>
            <Route path="/search">
              <Search workspace={workspace} />
            </Route>
            <Route path="/outline">
              <Outline workspace={workspace} />
            </Route>
            <Route path="/structure">
              <Structure workspace={workspace} />
            </Route>
            <Route path="/archive">
              <Archive workspace={workspace} />
            </Route>
            <Route path="/admin">
              <Admin workspace={workspace} />
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
              <p className="text-ink-soft">
                Nothing here.{" "}
                <Link href="/" className="text-adobe hover:underline">
                  Back to the workspace
                </Link>
              </p>
            </Route>
          </Switch>
        )}
      </main>
      {workspace && <MobileTabBar />}
      <Toasts />
      <InstallPrompt />
    </div>
  );
}
