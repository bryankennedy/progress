### PROG-47 — Better Stack as the general-purpose uptime/alerting layer
External uptime monitoring on `/api/health` is now live in **Better Stack**,
chosen as the *general-purpose* alerting tool for the whole stack rather than a
one-off for this app. The monitor polls `https://progress.bck.dev/api/health`
every 180 s (free-tier floor) from US + EU and emails the owner on failure;
because the endpoint round-trips D1, a `503` (DB unreachable) is a true
end-to-end outage signal — precisely the gap Sentry can't see, since a down
Worker throws nothing for error tracking to catch. The monitor is **config as
code**: `scripts/monitors.ts` declares the desired monitors and `bun run
monitors:sync` creates-or-updates them idempotently (name-keyed) through the
Better Stack Uptime REST API; adding an app is one entry in the `MONITORS`
array. `BETTERSTACK_API_TOKEN` is an **ops credential in `.env`** (like
`PROD_PROGRESS_API_TOKEN`), not a Worker secret — the Worker never calls Better
Stack, so it deliberately does *not* live in `.dev.vars`.

*Why Better Stack over the alternatives:* it bundles uptime + cron/heartbeat +
status page + on-call escalation on one generous free tier (10 monitors + 10
heartbeats + a status page), exposes a REST API (and a Terraform provider) for
config-as-code, and has a native Cloudflare integration — so it grows across the
stack without adding vendors. *Rejected:* **Sentry uptime/crons** — already wired
for errors (D46) and a fine *complement*, but the free tier caps at 1 uptime + 1
cron monitor and bills per extra monitor with no status page, wrong as the hub;
**UptimeRobot** — cheapest, but its free tier is non-commercial-use-only since
2024 and lacks bundled heartbeats/status; **Cloudflare Health Checks** — wrong
layer (it monitors origins *behind* the proxy and needs a Pro+ zone; a Worker has
no origin to point it at). Sentry stays the error-tracking/triage layer; the two
are complements, not competitors. *Deferred:* the public **status page** and a
**Slack** alert channel (both already free-tier-included) — email-only for now,
each a small follow-up when wanted. The existing onboarding monitor was *adopted*
(repointed from the bare host to `/api/health`) rather than duplicated.
