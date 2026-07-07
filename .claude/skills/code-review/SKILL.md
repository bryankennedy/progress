---
name: code-review
description: >
  Structural code review for this repo. Use when asked to review a diff, a PR,
  a branch, a module, or a directory. Reviews architecture, logic, and tests —
  not formatting or anything the type checker already owns.
---

# Code review

A phased, severity-graded review that works on **a diff** (branch, PR, staged
changes) or **a module** (file or directory). It produces structural judgment a
type checker can't: boundaries, abstraction fit, logic, data-access shape,
error handling, and test quality.

## Scope — what this skill does and does NOT check

**In scope:** module boundaries and dependency direction · duplication vs.
premature abstraction · logic and edge cases · N+1s and query-in-loop ·
needless re-renders and effect misuse · error handling and floating promises ·
input validation at trust boundaries · test coverage and test quality · a fast
security pre-flight (secrets, injection, XSS).

**Out of scope — never flag:**

- Anything `bun run check` owns (`tsc -b`, strict, `noUncheckedIndexedAccess`,
  `verbatimModuleSyntax`). Assume it passes; don't re-derive type errors.
- Formatting. There is no Prettier/ESLint config; house style is the existing
  double-quote/semicolon idiom. Never block on style a formatter would own.
- Deep security scanning — dedicated tooling owns that; only the pre-flight in
  `reference/security-notes.md` applies here.
- Re-litigating settled decisions. Check `docs/DECISIONS.md` before flagging a
  deliberate-looking choice; if a code comment explains a non-obvious choice,
  acknowledge that reasoning before proposing an alternative.

Repo hard requirements are review criteria (see `CLAUDE.md`): instant UI —
optimistic mutations, no user-facing spinners; the owner's nouns (Workspace /
Focus / Repo / Arc / Action — never "epic"/"project"); rigid simplicity.

## Detect the review target

- Argument names a PR/branch, or the working tree is dirty → **diff review**:
  read the diff (`git diff`, `gh pr diff`) plus enough surrounding code to
  judge it in context. Read the intent from the PR/action/commit messages.
- Argument names a file or directory → **module review**: read the module
  whole, plus its direct importers/imports to judge its boundary.

## Process

Work the phases in order. **Surface any blocking action the moment you find
it** — state it immediately in output, then continue; never hold a blocker
back for the final report.

### 1. Scope

What is under review and what problem does it solve? For a diff, state the
intent in one or two lines (from the PR/action). For a module, state its single
responsibility in one line — if you can't, that is itself a finding.

### 2. Structure

Module boundaries, coupling, and dependency direction. Does shared code live
in `src/shared/`? Do client/worker stay on their sides of the wire types? Is
each abstraction earning its keep — neither hacky duplication nor speculative
generality?
→ Load `reference/architecture.md`, and `reference/dry-and-abstraction.md`
whenever weighing duplication against abstraction.

### 3. Details

Logic, naming, edge cases, and the per-layer checks. Load only what the code
under review touches:

- Types at boundaries, casts, exhaustiveness → `reference/typescript.md`
- React components/hooks/store wiring → `reference/react.md`
- Drizzle queries, D1, transactions, ranks → `reference/data-layer.md`
- async flows, fetch, errors, optimistic rollback → `reference/error-and-async.md`
- anything touching auth, input parsing, outbound fetch, HTML rendering →
  `reference/security-notes.md`

### 4. Tests

Does the changed behavior have coverage? Unit tests are colocated `*.test.ts`
run by `bun test src`; e2e lives in `e2e/` (Playwright). Judge whether tests
assert **behavior** (inputs → observable outputs) rather than implementation
(internal call order, private state). Missing coverage for changed logic is
`important`; missing coverage for pure plumbing is at most a `suggestion`.

### 5. Verdict

Close with the structured report (format below) and a clear call:
**approve** or **needs-work**. Needs-work whenever at least one `blocking`
finding exists; use judgment when several `important` findings compound.

## Severity

- **blocking** — must fix before merge: incorrect behavior, data loss/corruption,
  security hole, broken hard requirement (e.g. a user-facing spinner).
- **important** — should fix: real risk or maintainability cost, but shippable
  if consciously deferred.
- **nit** — style/preference with a defensible alternative. Never blocks.
- **suggestion** — optional improvement, worth a thought, no obligation.
- **praise** — a pattern worth propagating; call it out so it spreads.

When a finding straddles two severities, pick the lower one and say why the
higher one was considered.

## Output format — fixed

Every finding, as you go and in the report, on one line:

```
[severity] path:line — one-line action — concrete suggested fix.
```

- `path:line` relative to the repo root; use `path:line-line` for ranges and
  `path` alone only for file-level findings.
- The fix must be concrete — name the function/shape to change, not "consider
  improving".

End every review with:

```
## Summary
blocking: N · important: N · nit: N · suggestion: N · praise: N

Verdict: approve | needs-work

Top action items:
1. …
2. …
3. …
```

Top action items are the highest-leverage fixes (max 3, fewer if fewer exist),
ordered by severity then impact.

## Reference files

| File | Load when |
| --- | --- |
| `reference/dry-and-abstraction.md` | any duplication/abstraction judgment (phase 2, often 3) |
| `reference/architecture.md` | phase 2, always |
| `reference/typescript.md` | phase 3, any `.ts`/`.tsx` under review |
| `reference/react.md` | phase 3, components/hooks/store code |
| `reference/data-layer.md` | phase 3, Drizzle/D1/SQL/migrations |
| `reference/error-and-async.md` | phase 3, async/fetch/error paths |
| `reference/security-notes.md` | phase 3, auth/input/outbound-fetch/HTML surfaces |
