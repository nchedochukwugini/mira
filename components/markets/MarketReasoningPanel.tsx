"use client";

import { useEffect, useState } from "react";
import type { MarketReasoningSummary } from "@/lib/intelligence/market-reasoning";
import type { Market } from "@/lib/panta/types";

type ReasoningResponse = { reasoning: MarketReasoningSummary; narrative: string; narrativeSource: "groq" | "deterministic" };

export function MarketReasoningPanel({ market }: { market: Market }) {
  const [result, setResult] = useState<{ marketId: string; data?: ReasoningResponse; error?: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let current = true;
    if (market.source !== "panta") return () => { current = false; };
    const load = async () => {
      if (current) setLoading(true);
      try {
        const response = await fetch(`/api/markets/${encodeURIComponent(market.id)}/reasoning`, { cache: "no-store" });
        const payload = await response.json() as ReasoningResponse & { error?: string };
        if (!response.ok || !payload.reasoning) throw new Error(payload.error ?? "MIRA could not assemble market reasoning.");
        if (current) setResult({ marketId: market.id, data: payload });
      } catch (error) {
        if (current) setResult({ marketId: market.id, error: error instanceof Error ? error.message : "MIRA could not assemble market reasoning." });
      } finally {
        if (current) setLoading(false);
      }
    };
    void load();
    return () => { current = false; };
  }, [market.id, market.source, refreshKey]);

  const data = result?.marketId === market.id ? result.data : undefined;
  const formatChange = (type: string, value: number) => type === "price" && data?.reasoning.quoteAsset === "USDC" ? `${(value * 100).toFixed(2)}¢` : type === "price" ? `${value.toFixed(4)} ${data?.reasoning.quoteAsset ?? "quote"}/share` : type === "spread" ? `${value.toFixed(4)} ${data?.reasoning.quoteAsset ?? "quote"}/share` : `${value.toFixed(4)} ${data?.reasoning.quoteAsset ?? "quote"}`;
  const groups = [
    { title: "Signals supporting YES", values: data?.reasoning.signals.filter((item) => item.classification === "supports-yes") ?? [] },
    { title: "Signals opposing YES", values: data?.reasoning.signals.filter((item) => item.classification === "opposes-yes") ?? [] },
    { title: "Signals supporting NO", values: data?.reasoning.signals.filter((item) => item.classification === "supports-no") ?? [] },
    { title: "Signals opposing NO", values: data?.reasoning.signals.filter((item) => item.classification === "opposes-no") ?? [] },
  ];
  return <section className="clob-history mira-reasoning" aria-live="polite">
    <div className="mira-reasoning__heading"><div className="clob-subheading"><span className="panel-kicker">MIRA ANALYSIS</span><h4>Market reasoning</h4></div>{market.source === "panta" && <button type="button" className="mira-reasoning__refresh" onClick={() => setRefreshKey((key) => key + 1)} disabled={loading}>{loading ? "Updating…" : "Refresh reasoning"}</button>}</div>
    {market.source !== "panta" ? <p className="clob-history-empty">Reasoning requires a Panta market with provider and on-chain observations.</p>
      : !result || result.marketId !== market.id ? <p className="clob-history-empty" role="status">MIRA is assembling market signals and evidence…</p>
      : result.error ? <p className="clob-history-empty">{result.error}</p>
      : data ? <>
        <p className="clob-analysis-copy">{data.narrative}</p>
        <div className="mira-reasoning__meta"><span>Quote asset <b>{data.reasoning.quoteAsset ?? "Unavailable"}</b></span><span>{data.reasoning.quoteAsset === "USDC" ? "Panta YES probability" : "Panta YES price"} <b>{data.reasoning.marketPriceContext.yesPrice === null ? "Unavailable" : data.reasoning.quoteAsset === "USDC" ? `${(data.reasoning.marketPriceContext.yesPrice * 100).toFixed(1)}%` : `${data.reasoning.marketPriceContext.yesPrice.toFixed(4)} ${data.reasoning.quoteAsset}/share`}</b></span><span>{data.reasoning.quoteAsset === "USDC" ? "Panta NO probability" : "Panta NO price"} <b>{data.reasoning.marketPriceContext.noPrice === null ? "Unavailable" : data.reasoning.quoteAsset === "USDC" ? `${(data.reasoning.marketPriceContext.noPrice * 100).toFixed(1)}%` : `${data.reasoning.marketPriceContext.noPrice.toFixed(4)} ${data.reasoning.quoteAsset}/share`}</b></span><span>Price source <b>Panta market report</b></span></div>
        <div className="mira-reasoning__meta"><span>Market state <b>{data.reasoning.marketState}</b></span><span>Data <b>{data.reasoning.dataStatus}</b></span><span>Evidence quality <b>{data.reasoning.evidenceQuality}</b></span><span>Saved book observations <b>{data.reasoning.observationCount}</b></span></div>
        {data.reasoning.changes.length > 0 && <div className="mira-reasoning__group"><b>Changes across actual observations</b><ul>{data.reasoning.changes.map((change) => <li key={`${change.type}-${change.outcome}-${change.previousObservedAt}`}><span>{change.outcome} {change.type}: {formatChange(change.type, change.previousValue)} → {formatChange(change.type, change.currentValue)} ({change.delta > 0 ? "+" : ""}{formatChange(change.type, change.delta)})</span><small>Observed {new Date(change.previousObservedAt).toLocaleString()} → {new Date(change.observedAt).toLocaleString()} · {change.confidence} confidence</small></li>)}</ul></div>}
        {groups.map((group) => group.values.length ? <div className="mira-reasoning__group" key={group.title}><b>{group.title}</b><ul>{group.values.slice(0, 5).map((signal) => <li key={signal.id}><span>{signal.observed}</span><small>{signal.interpretation}</small>{signal.sourceUrl && <a href={signal.sourceUrl} target="_blank" rel="noreferrer">Open research source</a>}</li>)}</ul></div> : null)}
        {data.reasoning.signals.some((signal) => signal.classification === "neutral") && <div className="mira-reasoning__group"><b>Observations without outcome direction</b><ul>{data.reasoning.signals.filter((signal) => signal.classification === "neutral").slice(0, 5).map((signal) => <li key={signal.id}><span>{signal.observed}</span><small>{signal.interpretation}</small>{signal.sourceUrl && <a href={signal.sourceUrl} target="_blank" rel="noreferrer">Open research source</a>}</li>)}</ul></div>}
        {data.reasoning.uncertainty.length > 0 && <div className="mira-reasoning__uncertainty"><b>Uncertainty</b><ul>{data.reasoning.uncertainty.map((item) => <li key={item}>{item}</li>)}</ul></div>}
        <small className="mira-reasoning__foot">Observations, deterministic calculations, inferences, and retrieved evidence retain separate labels. Price movement and visible liquidity do not establish an outcome.</small>
      </> : null}
  </section>;
}
