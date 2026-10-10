"use client";

import { useEffect, useState } from "react";
import type { MarketPriceHistory, Market, PriceHistoryRange } from "@/lib/panta/types";
import { MiniChart } from "@/components/charts/MiniChart";

const ranges: Array<{ value: PriceHistoryRange; label: string }> = [
  { value: "1h", label: "1H" }, { value: "6h", label: "6H" }, { value: "1d", label: "1D" }, { value: "7d", label: "7D" }, { value: "all", label: "All" },
];
const rangeLabel: Record<PriceHistoryRange, string> = { "1h": "1H", "6h": "6H", "1d": "1D", "7d": "7D", all: "All" };

export function MarketPriceHistory({ market }: { market: Market }) {
  const [range, setRange] = useState<PriceHistoryRange>("1d");
  const [requestResult, setRequestResult] = useState<{ key: string; history: MarketPriceHistory | null } | null>(null);
  const [retry, setRetry] = useState(0);
  const requestKey = `${market.id}:${range}:${retry}`;
  const history = requestResult?.key === requestKey ? requestResult.history : null;
  const loading = requestResult?.key !== requestKey;

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/markets/${encodeURIComponent(market.id)}/history?range=${range}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { data?: MarketPriceHistory; error?: string };
        if (!response.ok || !payload.data) throw new Error(payload.error ?? "History request failed.");
        setRequestResult({ key: requestKey, history: payload.data });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setRequestResult({ key: requestKey, history: { marketId: market.id, eventPda: market.pantaEventPda ?? null, range, status: "error", observations: [], quoteAsset: market.quoteAsset ?? null, source: "none", retrievedAt: new Date().toISOString(), signaturesRead: 0, transactionsRead: 0, latestSignatureSlot: null, latestSignatureBlockTime: null, signatureLimit: 0, coverage: "unknown", completeness: "unavailable", reason: "history-request-failed", message: "History could not be loaded. Retry." } });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [requestKey, market.id, range, retry, market.pantaEventPda, market.quoteAsset]);

  const points = history?.observations ?? [];
  const prices = points.flatMap((point) => point.yesProbability === null ? [] : [point.yesProbability]);
  const low = prices.length ? Math.min(...prices) : null;
  const high = prices.length ? Math.max(...prices) : null;
  const first = points[0]?.timestamp;
  const last = points.at(-1)?.timestamp;
  const unit = market.quoteAsset ? `${market.quoteAsset}/share` : "quote asset/share unavailable";
  const formatPrice = (value: number | null) => value === null ? "—" : `${value.toFixed(4)} ${unit}`;

  return <section className="intelligence-section intel-chart-section" aria-label="Market price history">
    <div className="panel-heading"><div><span className="panel-kicker">PRICE HISTORY</span><h3>YES price</h3></div><span className="chart-period">{rangeLabel[range]}</span></div>
    <div className="history-range-controls" role="group" aria-label="Price history range">
      {ranges.map((item) => <button key={item.value} type="button" aria-pressed={range === item.value} onClick={() => setRange(item.value)}>{item.label}</button>)}
    </div>
    {loading ? <div className="chart-empty intel-chart" role="status">Loading {rangeLabel[range]} observations…</div>
      : history?.status === "available" && points.length > 0 ? <>
        <div className="history-axis-labels"><span>{formatPrice(high)}</span><span>{formatPrice(low)}</span></div>
        <MiniChart points={points} label={`${market.question}, YES price in ${unit}`} className="intel-chart" emptyLabel="No historical price observations were returned for this period." />
        <div className="chart-boundaries"><span>{points.length} verified trade observations · {rangeLabel[range]}</span><span>{first ? new Date(first).toLocaleString() : "Timestamp unavailable"} → {last ? new Date(last).toLocaleString() : "Timestamp unavailable"}</span></div>
        {history.completeness === "partial" && <div className="intel-detail-note" role="status">Partial RPC snapshot; some transaction details were unavailable.</div>}
        {history.coverage === "bounded-latest-sample" && <div className="intel-detail-note" role="status">This result covers the latest {history.signatureLimit} event transactions available to Panta’s chart reader, not the market’s full lifetime.</div>}
      </>
      : history?.status === "empty" ? <><div className="chart-empty intel-chart">No historical price observations were returned for this period. · {rangeLabel[range]}</div>{history.coverage === "bounded-latest-sample" && <div className="intel-detail-note">Checked the latest {history.signatureLimit} event transactions; older history may exist beyond this sample.</div>}</>
        : history?.status === "unsupported" ? <div className="chart-empty intel-chart">History range {range} is not supported by the provider.</div>
          : <div className="chart-empty chart-empty--error intel-chart" role="alert">{history?.message ?? "History could not be loaded. Retry."} <button type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button></div>}
    <div className="chart-boundaries"><span>Unit · {unit}</span><span>Source · {history?.source === "panta-solana-order-matched" ? "Panta matched trades" : "Panta Solana"}{history?.retrievedAt ? ` · Retrieved ${new Date(history.retrievedAt).toLocaleTimeString()}` : ""}</span></div>
  </section>;
}
