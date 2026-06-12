# Documentation map

The docs follow the [Diátaxis](https://diataxis.fr/) framework: each file
serves one documentation need, and built-vs-planned material is kept apart so
tense never lies about the state of the system.

| Doc | Diátaxis type | Read it when you want… |
|---|---|---|
| [`REFERENCE.md`](./REFERENCE.md) | **Reference** (information-oriented) | The system **as built**: domain rules, API endpoints, client architecture, keyboard map. Present tense; updated as milestones land. |
| [`SETUP.md`](./SETUP.md) | **How-to guide** (task-oriented) | To get it running: install, migrate, seed, dev server, schema-change workflow, (eventually) deploy. |
| [`SPEC.md`](./SPEC.md) | **Explanation + plans** | The **why** (vision, principles) and the **not-yet-built** (webhook linking, deploy, dogfood, Claude Code integration). Future tense is intentional there. |
| [`DECISIONS.md`](./DECISIONS.md) | **Explanation** (understanding-oriented) | The reasoning behind any settled choice. Append-only log; never re-litigate, supersede with a new entry. |

There are no tutorials: Diátaxis's fourth quadrant is learning-oriented
onboarding, and a single-user tool whose only user is its builder doesn't
need one. If that changes, a tutorial slots in here.

Conventions:

- **Section numbers in `SPEC.md` are stable** — code comments and decision
  log entries cite them (e.g. `SPEC §3`). When a specced area ships, its
  section shrinks to intent + a pointer into `REFERENCE.md` rather than
  being renumbered away.
- When a decision of consequence is made, it's recorded in `DECISIONS.md`
  in the same session (see `CLAUDE.md`).
