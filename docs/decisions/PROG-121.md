### PROG-121 — Bare PR refs linkify client-side against the focus gitUrl

**Date:** 2026-07-29 · **Status:** decided

Agents report work back as comments saying "pushed to PR #107" — usually
without pasting the URL. remark-gfm (PROG-72) only autolinks full URLs, so
those refs rendered as dead text and the owner had to reconstruct the PR
address by hand.

**Decision.** A small client-side remark plugin (`src/client/prRefs.ts`)
rewrites bare `#<number>` in rendered action/comment/container markdown into
links against the enclosing focus's `gitUrl` (`<gitUrl>/pull/<n>`). No stored
text changes and no server involvement — the ref resolves at render time, so
it keeps working if the focus's repo URL is edited later.

Alternatives rejected:

- **Rewriting the stored markdown on write** (server expands `#107` to a full
  link): mutates the author's text, breaks if the repo URL changes, and
  double-processes text that already contains the URL.
- **Asking agents to always paste full URLs**: unenforceable, and the
  existing comment corpus already uses the short form.

Scope choices:

- **GitHub-style `/pull/<n>`.** All linked repos are GitHub today; GitHub
  redirects to `/issues/<n>` when the number is an issue, so a mistaken kind
  still lands. Other forges (Gitea `/pulls/`, GitLab `/-/merge_requests/`)
  can be added by sniffing the host in `prRefBase` if a non-GitHub `gitUrl`
  ever appears.
- **Guards over reach.** Only mdast text nodes are rewritten — code
  spans/blocks and existing links are skipped structurally, the number caps
  at 5 digits, and word-adjacent hashes don't match, so hex colors
  (`#1e90ff`, `#123456`) and `foo#123` stay plain. `owner/repo#123`
  cross-repo refs are out of scope until they show up in real text.
- **No `gitUrl` → no links.** A repo-less (household) focus renders `#123`
  as plain text; there is nothing sensible to link it to.
