import "server-only";

const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";
export const getAIConfig = () => ({ configured: Boolean(process.env.GROQ_API_KEY?.trim()), model: process.env.GROQ_MODEL?.trim() || DEFAULT_GROQ_MODEL });

export class GroqProvider {
  readonly name = "groq";
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly fetcher: typeof fetch;

  constructor(options: { apiKey?: string; model?: string; fetcher?: typeof fetch } = {}) {
    this.apiKey = options.apiKey ?? process.env.GROQ_API_KEY?.trim();
    this.model = options.model ?? getAIConfig().model;
    this.fetcher = options.fetcher ?? fetch;
  }

  async completeJson<T>(input: { system: string; user: unknown; schema: object; validate(value: unknown): T | null; validationFailure?(value: unknown): string | null; onFailure?(reason: string): void }): Promise<T | null> {
    if (!this.apiKey) { input.onFailure?.("GROQ_API_KEY is not configured"); return null; }
    try {
      const response = await this.fetcher("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST", cache: "no-store", signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model, temperature: 0.1, max_completion_tokens: 6000,
          messages: [{ role: "system", content: input.system }, { role: "user", content: typeof input.user === "string" ? input.user : JSON.stringify(input.user) }],
          response_format: { type: "json_schema", json_schema: { name: "mira_response", strict: true, schema: input.schema } },
        }),
      });
      if (!response.ok) {
        const failureBody = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
        input.onFailure?.(`Groq HTTP ${response.status}${failureBody?.error?.code ? ` (${failureBody.error.code})` : ""}`);
        console.warn(`[MIRA AI] Groq request failed with HTTP ${response.status}${failureBody?.error?.code ? ` (${failureBody.error.code})` : ""}.`);
        return null;
      }
      const body = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== "string") { input.onFailure?.("Groq returned no structured text"); return null; }
      const parsed: unknown = JSON.parse(content);
      const validated = input.validate(parsed);
      if (!validated) {
        const reason = input.validationFailure?.(parsed) ?? "response fields or citation requirements did not match the requested schema";
        input.onFailure?.(`local validation failed: ${reason}`);
        console.warn(`[MIRA AI] Groq response failed local schema validation: ${reason}.`);
      }
      return validated;
    } catch (error) {
      input.onFailure?.(error instanceof SyntaxError ? "Groq returned malformed JSON" : `Groq request failed (${error instanceof Error ? error.name : "unknown error"})`);
      console.warn(`[MIRA AI] Groq request could not be completed (${error instanceof Error ? error.name : "unknown error"}).`);
      return null;
    }
  }
}
