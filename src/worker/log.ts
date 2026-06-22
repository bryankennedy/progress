// Structured logging for the Worker. One JSON object per line, emitted to the
// Worker's stdout/stderr — Cloudflare Workers Logs (observability is enabled in
// wrangler.jsonc) and `wrangler tail` both parse these, so every field below is
// filterable in the dashboard. The key field is `requestId`: it ties an access
// line to any error logged while serving the same request, so a single failure
// can be traced end to end. See docs/SETUP.md §6 (Observability & alerts).

export type LogLevel = "info" | "warn" | "error";

export type LogFields = {
  requestId?: string;
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
  // An Error (or anything) describing a failure; serialized to name/message/stack.
  error?: unknown;
  [key: string]: unknown;
};

// Errors don't survive JSON.stringify (they serialize to `{}`), so pull the
// useful parts out by hand.
function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}

export function log(level: LogLevel, event: string, fields: LogFields = {}): void {
  const { error, ...rest } = fields;
  const line = JSON.stringify({
    level,
    event,
    ...rest,
    ...(error === undefined ? {} : { error: serializeError(error) }),
  });
  // Route errors to stderr so they're distinguishable in tails/exports; info and
  // warn go to stdout.
  if (level === "error") console.error(line);
  else console.log(line);
}
