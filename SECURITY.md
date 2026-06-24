# Security Policy

Progress is a single-user, allowlisted personal tracker, developed in public as a
portfolio project. The deployed app is private (Google OAuth + an email
allowlist); the publicly reachable surface is limited to the sign-in/OAuth flow,
the GitHub webhook endpoint, and the health probe.

## Reporting a vulnerability

Please email **bryan@bryankennedy.org** with:

- a description of the issue and its impact,
- steps to reproduce or a proof of concept, and
- any relevant detail — responses carry an `x-request-id` header that helps trace
  a request server-side.

Please report privately and allow a reasonable window to fix before any public
disclosure. There's no bug-bounty program (this is a personal project), but
good-faith reports are very welcome and will be credited if you'd like.

A machine-readable pointer to this policy is published at
[`/.well-known/security.txt`](https://progress.bck.dev/.well-known/security.txt).

## Scope

**In scope:** anything in this repository and the deployed app at
<https://progress.bck.dev>.

**Out of scope:** volumetric / denial-of-service testing, social engineering, and
automated scanning that degrades the service.

## Supported versions

Only the currently deployed `main` branch is supported; there are no tagged
releases.
