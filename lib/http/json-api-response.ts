export type JsonApiErrorBody = { error?: string | { code?: string; message?: string }; message?: string };

export function jsonApiError(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message } }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function isJsonContentType(value: string | null): boolean {
  const contentType = value?.split(";", 1)[0]?.trim().toLowerCase();
  return contentType === "application/json" || Boolean(contentType?.endsWith("+json"));
}

export async function readJsonApiResponse<T>(response: Response): Promise<T> {
  let body: string;
  try {
    body = await response.text();
  } catch {
    throw new Error(`MIRA could not read the transaction API response (HTTP ${response.status}). No transaction was prepared.`);
  }

  if (!body.trim()) {
    throw new Error(`MIRA returned an empty transaction API response (HTTP ${response.status}). No transaction was prepared.`);
  }

  if (!isJsonContentType(response.headers.get("content-type"))) {
    if (response.status === 404) {
      throw new Error("MIRA’s transaction API endpoint was not found (HTTP 404). Refresh the app and try again. No transaction was prepared.");
    }
    throw new Error(`MIRA returned a non-JSON transaction API response (HTTP ${response.status}). No transaction was prepared.`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error(`MIRA returned malformed JSON from the transaction API (HTTP ${response.status}). No transaction was prepared.`);
  }

  const record = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null;
  if (!response.ok) {
    const error = record?.error;
    const errorRecord = error && typeof error === "object" && !Array.isArray(error)
      ? error as Record<string, unknown>
      : null;
    const message = typeof error === "string" ? error
      : typeof errorRecord?.message === "string" ? errorRecord.message
        : typeof record?.message === "string" ? record.message
          : `MIRA could not prepare this transaction (HTTP ${response.status}).`;
    throw new Error(message);
  }

  return payload as T;
}

export function transactionNetworkError(cause: unknown): string {
  if (cause instanceof TypeError) return "MIRA’s transaction API could not be reached. Check your connection and try again. No transaction was prepared.";
  return cause instanceof Error ? cause.message : "MIRA could not prepare this transaction. No transaction was prepared.";
}
