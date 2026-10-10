export type DatabaseFailure = { status: number; body: { error: string; code: string } };

export function isDatabaseTemporarilyUnavailable(response: { status: number }, payload: unknown): boolean {
  if (response.status !== 503 || !payload || typeof payload !== "object") return false;
  const code = (payload as { code?: unknown }).code;
  return code === "database_unavailable";
}

export function databaseFailure(error: unknown, operation: string): DatabaseFailure {
  const candidate = error && typeof error === "object" ? error as { code?: unknown; name?: unknown; constraint?: unknown } : {};
  const code = typeof candidate.code === "string" ? candidate.code : "unknown";
  const name = typeof candidate.name === "string" ? candidate.name : "Error";
  console.error("[database] conversation request failed", { operation, code, name, constraint: typeof candidate.constraint === "string" ? candidate.constraint : undefined });
  if (code === "42P01" || code === "42703") return { status: 503, body: { code: "database_schema", error: "Conversation storage needs a database migration. Run npm run db:migrate, then retry." } };
  if (/^(08|57P01|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH)/.test(code)) return { status: 503, body: { code: "database_unavailable", error: "Conversation storage is temporarily unreachable. Your message is still available to retry." } };
  if (code === "23503") return { status: 404, body: { code: "conversation_not_found", error: "That conversation no longer exists. Start a new conversation and retry your message." } };
  return { status: 503, body: { code: "conversation_storage_error", error: `Conversation storage failed during ${operation}. Your message is still available to retry.` } };
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
