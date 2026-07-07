# Progress

A single-user, web-based tracker for product development — a "personal Linear"
built around one idea: **the hierarchy and its names are the product.**

Most issue trackers fail not on features but on vocabulary. Their nouns (epics,
projects, sprints) never quite match how you actually think about your work,
and the constant translation is friction. Progress fixes that by modeling the
hierarchy directly:

```
Workspace
└── Focus
    ├── Actions
    ├── Arcs        (groupings of related actions)
    └── Repos       (git-backed sub-containers)
        └── Actions
```

## What it does

- **Actions** with fixed Linear-style statuses, priority, estimates, tags,
  comments, and an activity feed — movable between containers as work evolves
- **Per-focus action keys** (`PROG-123`) that survive moves
- **A global kanban board** as the daily landing page, filterable by any level
  of the hierarchy
- **Fast by architecture** — the whole snapshot loads into a client-side
  store, every mutation is optimistic, and a spinner on interaction is treated
  as a bug
- **Keyboard-first** — a ⌘K command palette plus Linear-style single-key
  actions (status, priority, move, tags…) on whatever action you're on
- **Git integration** *(next up)* — mention an action key in a branch, commit,
  or PR and it links automatically via webhook
- **Claude Code integration** *(planned v1.x)* — actions as executable work
  orders: hand an action's full context to an agent, or interrogate and update
  the tracker from inside a coding session

## What it deliberately isn't

No configurable workflows, no sprints (yet), no multi-user (yet), no GitHub
Issues sync (ever). Rigid simplicity over configurability.

## Stack

Cloudflare Workers + D1 (SQLite) with Hono on the back, React + Vite +
Tailwind on the front. TypeScript, ESM, Bun.

## Status

🚧 **Built and working locally; not yet deployed.** The core app is complete
(milestones 1–5, June 2026): full domain model and API, the instant client
store, the board, container and action pages, the command palette, and full
CRUD including action movement with key-alias redirects. Remaining for v1:
the GitHub webhook, a mobile pass, production deploy, and moving this
project's own backlog into it.

Docs (organized per [Diátaxis](https://diataxis.fr/), map in
[`docs/README.md`](docs/README.md)): [`docs/REFERENCE.md`](docs/REFERENCE.md)
describes the system as built; [`docs/SPEC.md`](docs/SPEC.md) holds the
vision and what remains; [`docs/DECISIONS.md`](docs/DECISIONS.md) records
the reasoning; [`docs/SETUP.md`](docs/SETUP.md) gets it running.

This is a personal tool built in the open; it's not currently seeking
contributions, but feel free to read along or borrow ideas.
