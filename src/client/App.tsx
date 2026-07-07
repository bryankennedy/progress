import { Link, Redirect, Route, Switch } from "wouter";
import CommandLayer from "./commands/CommandLayer";
import Header from "./Header";
import MobileTabBar from "./MobileTabBar";
import InstallPrompt from "./pwa/InstallPrompt";
import SignIn from "./SignIn";
import { UnauthenticatedError, useSnapshot } from "./store";
import { Toasts } from "./toast";
import Admin from "./pages/Admin";
import Agenda from "./pages/Agenda";
import Archive from "./pages/Archive";
import ContainerPage, { type ContainerType } from "./pages/ContainerPage";
import Home from "./pages/Home";
import ActionPage from "./pages/ActionPage";
import Outline from "./pages/Outline";
import Search from "./pages/Search";
import Structure from "./pages/Structure";

const CONTAINER_ROUTES: { path: string; type: ContainerType }[] = [
  { path: "/workspace/:id", type: "workspace" },
  { path: "/focus/:id", type: "focus" },
  { path: "/repo/:id", type: "repo" },
  { path: "/arc/:id", type: "arc" },
];

// Pre-PROG-98 noun routes — old links live on in PR bodies, commit messages,
// and bookmarks; redirect instead of 404ing them.
const LEGACY_REDIRECTS: { path: string; to: (id: string) => string }[] = [
  { path: "/issue/:id", to: (id) => `/action/${id}` },
  { path: "/initiative/:id", to: (id) => `/workspace/${id}` },
  { path: "/product/:id", to: (id) => `/focus/${id}` },
];

export default function App() {
  const { data: snapshot, isPending, error } = useSnapshot();

  // Not signed in: the landing page is the whole screen (no header/shell).
  if (error instanceof UnauthenticatedError) return <SignIn />;

  return (
    // min-h-dvh (not min-h-screen): tracks the live iOS viewport so the canvas
    // fills the screen without overflowing under the dynamic Safari toolbar.
    <div className="min-h-dvh bg-canvas text-ink">
      {snapshot && <Header />}
      {/* Wide shell for the board; narrow pages re-constrain themselves.
          Tighter padding on phones — the board needs the width. Top gap is
          kept small so content sits just under the sticky header, with roomier
          bottom padding for scroll breathing room (PROG-69). The extra mobile
          bottom padding (pb-24) clears the fixed bottom tab bar (PROG-79). */}
      <main className="mx-auto max-w-screen-2xl px-3 pb-24 pt-3 sm:px-6 sm:pb-10 sm:pt-4">
        {/* Initial app load: the only permitted loading state (SPEC §8.2). */}
        {isPending && <p className="text-ink-faint">Loading…</p>}
        {error && <p className="text-danger">{String(error)}</p>}
        {snapshot && <CommandLayer snapshot={snapshot} />}
        {snapshot && (
          <Switch>
            <Route path="/">
              <Home snapshot={snapshot} />
            </Route>
            <Route path="/agenda">
              <Agenda snapshot={snapshot} />
            </Route>
            <Route path="/search">
              <Search snapshot={snapshot} />
            </Route>
            <Route path="/outline">
              <Outline snapshot={snapshot} />
            </Route>
            <Route path="/structure">
              <Structure snapshot={snapshot} />
            </Route>
            <Route path="/archive">
              <Archive snapshot={snapshot} />
            </Route>
            <Route path="/admin">
              <Admin snapshot={snapshot} />
            </Route>
            <Route path="/action/:key">
              {(params) => <ActionPage snapshot={snapshot} keyParam={params.key!} />}
            </Route>
            {CONTAINER_ROUTES.map(({ path, type }) => (
              <Route key={path} path={path}>
                {/* wouter can't infer named params from a non-literal path. */}
                {(params: { id?: string }) => (
                  <ContainerPage snapshot={snapshot} type={type} id={params.id ?? ""} />
                )}
              </Route>
            ))}
            {LEGACY_REDIRECTS.map(({ path, to }) => (
              <Route key={path} path={path}>
                {(params: { id?: string }) => <Redirect to={to(params.id ?? "")} replace />}
              </Route>
            ))}
            <Route>
              <p className="text-ink-soft">
                Nothing here.{" "}
                <Link href="/" className="text-adobe hover:underline">
                  Back to the board
                </Link>
              </p>
            </Route>
          </Switch>
        )}
      </main>
      {snapshot && <MobileTabBar />}
      <Toasts />
      <InstallPrompt />
    </div>
  );
}
