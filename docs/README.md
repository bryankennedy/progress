# Documentation map

The docs follow the [Diátaxis](https://diataxis.fr/) framework: each file
serves one documentation need, and built-vs-planned material is kept apart so
tense never lies about the state of the system.

| Doc | Diátaxis type | Read it when you want… |
|---|---|---|
| [`REFERENCE.md`](./REFERENCE.md) | **Reference** (information-oriented) | The system **as built**: domain rules, API endpoints, client architecture, keyboard map. Present tense; updated as milestones land. |
| [`SETUP.md`](./SETUP.md) | **How-to guide** (task-oriented) | To get it running: install, migrate, seed, dev server, schema-change workflow, (eventually) deploy. |
| [`SPEC.md`](./SPEC.md) | **Explanation + plans** | The **why** (vision, principles) and the **not-yet-built**. Currently the **v2** roadmap (non-dev/household use, due dates, the Agenda view). Future tense is intentional there. |
| [`DECISIONS.md`](./DECISIONS.md) + [`decisions/`](./decisions/) | **Explanation** (understanding-oriented) | The reasoning behind any settled choice — one file per work element (`decisions/<KEY>.md`; legacy `D1`–`D49` frozen in `decisions/D1-D49.md`, PROG-91). Never re-litigate; supersede with a new entry. `DECISIONS.md` is the convention doc. |
| [`archive/SPEC-v1.md`](./archive/SPEC-v1.md) | **Archive** | The frozen v1 roadmap (the product-development tracker), shipped and dogfooded. Kept for traceability — pre-v2 `SPEC §X` citations resolve here. |

There are no tutorials: Diátaxis's fourth quadrant is learning-oriented
onboarding, and a single-user tool whose only user is its builder doesn't
need one. If that changes, a tutorial slots in here.

Conventions:

- **Section numbers in `SPEC.md` are stable** — code comments and decision
  log entries cite them (e.g. `SPEC §3`). When a specced area ships, its
  section shrinks to intent + a pointer into `REFERENCE.md` rather than
  being renumbered away. `SPEC.md` is now the **v2** roadmap with its own
  numbering; citations written during v1 resolve in
  [`archive/SPEC-v1.md`](./archive/SPEC-v1.md).
- When a decision of consequence is made, it's recorded in
  `decisions/<KEY>.md` in the same session (see `CLAUDE.md` and the
  convention in `DECISIONS.md`).
