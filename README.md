# Progress

A single-user, web-based tracker for product development — a "personal Linear"
built around one idea: **the hierarchy and its names are the product.**

Most issue trackers fail not on features but on vocabulary. Their nouns (epics,
projects, sprints) never quite match how you actually think about your work,
and the constant translation is friction. Progress fixes that by modeling the
hierarchy directly:

```
Initiative
└── Product
    ├── Issues
    ├── Arcs        (groupings of related issues)
    └── Repos       (git-backed sub-containers)
        └── Issues
```

## What it does

- **Issues** with fixed Linear-style statuses, priority, estimates, tags,
  comments, and an activity feed — movable between containers as work evolves
- **Per-product issue keys** (`PROG-123`) that survive moves
- **A global kanban board** as the daily landing page, filterable by any level
  of the hierarchy
- **Git integration** — mention an issue key in a branch, commit, or PR and it
  links automatically via webhook
- **Fast by architecture** — the whole workspace loads into a client-side
  store, every mutation is optimistic, and a spinner on interaction is treated
  as a bug

## What it deliberately isn't

No configurable workflows, no sprints (yet), no multi-user (yet), no GitHub
Issues sync (ever). Rigid simplicity over configurability.

## Stack

Cloudflare Workers + D1 (SQLite) with Hono on the back, React + Vite +
Tailwind on the front. TypeScript, ESM, Bun.

## Status

🚧 **Pre-code.** The v1 spec is complete — see [`docs/SPEC.md`](docs/SPEC.md)
for the full domain model and scope, and [`docs/DECISIONS.md`](docs/DECISIONS.md)
for the reasoning behind the design. Implementation is next.

This is a personal tool built in the open; it's not currently seeking
contributions, but feel free to read along or borrow ideas.
