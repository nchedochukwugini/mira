import type { PoolClient } from "pg";

/** Shared bounded-cycle and advisory-lock behavior for the long-running workers. */
export async function acquireAdvisoryLock(client: PoolClient, lockName: string): Promise<boolean> {
  const result = await client.query("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", [lockName]);
  return result.rows[0]?.locked === true;
}

export function shouldAdvanceNewestCheckpoint(hasCheckpoint: boolean, reachedCheckpoint: boolean, exhausted: boolean) {
  return !hasCheckpoint || reachedCheckpoint || exhausted;
}

/** Bind a decoded, Panta-owned Event account to the exact registry address. Titles are display metadata, not account identity. */
export function isVerifiedPantaEventIdentity(
  market: { id: string; question: string; pantaEventPda?: string | null; pantaEventRegistryTitle?: string | null; pantaEventRegistryCreator?: string | null },
  observed: { marketId: string; address: string; event: { question: string; creator: string } } | undefined,
) {
  const registryTitle = market.pantaEventRegistryTitle?.trim();
  const titleBoundToRegistry = registryTitle
    ? market.question.trim() === registryTitle || market.question.trim() === observed?.event.question.trim()
    : market.question.trim() === observed?.event.question.trim();
  return Boolean(
    observed && market.pantaEventPda &&
    observed.marketId === market.id &&
    observed.address === market.pantaEventPda &&
    market.pantaEventRegistryCreator && observed.event.creator === market.pantaEventRegistryCreator &&
    observed.event.question.trim() && titleBoundToRegistry,
  );
}

export function orderTradeScanCandidates<T extends { market: { status: string }; lastAttemptAt: number }>(items: T[], limit: number) {
  return [...items]
    .sort((a, b) => Number(b.market.status === "active") - Number(a.market.status === "active") || a.lastAttemptAt - b.lastAttemptAt)
    .slice(0, Math.max(0, limit));
}

/** Run a bounded sequential batch; an individual candidate failure cannot starve later candidates. */
export async function runBoundedCandidateAttempts<T, R>(items: T[], limit: number, attempt: (item: T) => Promise<R>) {
  const outcomes: Array<{ item: T; status: "completed"; value: R } | { item: T; status: "failed"; error: unknown }> = [];
  for (const item of items.slice(0, Math.max(0, limit))) {
    try { outcomes.push({ item, status: "completed", value: await attempt(item) }); }
    catch (error) { outcomes.push({ item, status: "failed", error }); }
  }
  return outcomes;
}

export function summarizeSnapshotObservations(observations: Array<{ dataStatus: string }>) {
  return {
    partial: observations.filter((item) => item.dataStatus === "partial").length,
    unavailable: observations.filter((item) => item.dataStatus === "unavailable").length,
  };
}

export function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "unknown";
  return message
    .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, "[redacted database URL]")
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[redacted URL]")
    .replace(/\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9_-]{8,}\b|\bgsk_[A-Za-z0-9_-]{16,}\b|\btvly-[A-Za-z0-9_-]{16,}\b|\bgh(?:p|o|u|s|r)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/gi, "[redacted credential]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [redacted]");
}

export async function runWorkerCycles(input: {
  once: boolean;
  cycle: () => Promise<Record<string, unknown>>;
  wait: (ms: number) => Promise<void>;
  intervalMs: number;
  shouldStop: () => boolean;
  log: (event: string, detail: Record<string, unknown>) => void;
}) {
  let cycles = 0;
  let failures = 0;
  while (!input.shouldStop()) {
    const startedAt = Date.now();
    let delayMs = input.intervalMs;
    try {
      const result = await input.cycle();
      cycles += 1;
      failures = 0;
      input.log("cycle_complete", { cycle: cycles, durationMs: Date.now() - startedAt, ...result });
    } catch (error) {
      failures += 1;
      delayMs = Math.min(input.intervalMs, 1_000 * 2 ** Math.min(failures, 7));
      input.log("cycle_error", { cycle: cycles + 1, durationMs: Date.now() - startedAt, failures, retryInMs: delayMs, code: error && typeof error === "object" && "code" in error ? error.code : undefined, message: safeErrorMessage(error) });
      if (input.once) throw error;
    }
    if (input.once || input.shouldStop()) break;
    await input.wait(delayMs);
  }
  return { cycles, failures };
}
