"use client";

import { useState } from "react";
import { GitCompareArrows, Info } from "lucide-react";
import type { Market, RelatedMarket } from "@/lib/panta/types";
import type { CrossMarketReport } from "@/lib/intelligence/cross-market";

type ResponseData = { report?: CrossMarketReport; explanation?: { summary: string; relationshipExplanation: string; movementExplanation: string; evidenceExplanation: string; uncertainty: string[]; evidenceIds: string[] }; explanationMode?: "groq" | "deterministic"; evidenceReferences?: Array<{ id: string; title: string; source: string; url: string; publishedAt: string | null; retrievedAt: string }>; microstructure?: Array<{ marketId: string; microstructure: { yes: { bookState: string; midpoint: number | null; spread: number | null; bidDepth: number; askDepth: number } } | null }>; sharedResearch?: { status: string; conclusion: string; researchedAt: string; refreshed: boolean; evidence: Array<{ title: string; source: string; url: string; publishedAt: string | null; retrievedAt: string; summary: string }> } | null; evidenceTiming?: Array<{ title: string; source: string; timing: string; publishedAt: string | null }>; error?: string };
const cents = (value: number) => `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)}¢`;

export function CrossMarketPanel({ focus, markets, relationships = [] }: { focus: Market; markets: Market[]; relationships?: RelatedMarket[] }) {
  const relatedIds = focus.relatedMarketIds.length ? focus.relatedMarketIds : relationships.filter((edge) => edge.marketId === focus.id || edge.relatedMarketId === focus.id).map((edge) => edge.marketId === focus.id ? edge.relatedMarketId : edge.marketId);
  const related = relatedIds.map((id) => markets.find((market) => market.id === id)).filter((market): market is Market => Boolean(market)).slice(0, 4);
  const [data, setData] = useState<ResponseData | null>(null);
  const [loading, setLoading] = useState(false);
  async function compare(research = false) {
    if (!related.length) return;
    setLoading(true);
    try {
      const response = await fetch("/api/cross-market", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ primaryMarketId: focus.id, relatedMarketIds: related.map((market) => market.id), research }) });
      const payload = await response.json() as ResponseData;
      setData(response.ok ? payload : { error: payload.error ?? "Comparison is unavailable." });
    } catch { setData({ error: "Comparison is unavailable right now." }); }
    finally { setLoading(false); }
  }
  return <section className="intelligence-section cross-market-panel">
    <div className="panel-heading"><div><span className="panel-kicker">CROSS-MARKET INTELLIGENCE</span><h3>Compare related markets</h3></div><GitCompareArrows size={16} /></div>
    {related.length ? <>
      <p className="cross-market-intro">Provider-linked markets are compared using their definitions and available timestamped observations.</p>
      <button className="intel-ask-button" onClick={() => void compare()} disabled={loading}>{loading ? "Comparing…" : "Compare related markets"}</button>
      {data?.report && <button className="intel-ask-button" onClick={() => void compare(true)} disabled={loading}>{loading ? "Researching…" : "Research a shared event"}</button>}
    </> : <div className="graph-empty"><Info size={15} /><p>No provider-linked markets are available for comparison.</p></div>}
    {data?.error && <p className="intel-detail-note intel-detail-note--warning" role="status">{data.error}</p>}
    {data?.report?.relatedMarkets.map((item) => {
      const micro = data.microstructure?.find((entry) => entry?.marketId === item.market.id)?.microstructure?.yes;
      return <article className="cross-market-result" key={item.market.id}>
        <b>{item.market.question}</b>
        <span>{item.relationship.type.replaceAll("-", " ")} · {item.relationship.confidence} relationship confidence</span>
        <span>Movement: {item.movement.status} · {item.movement.dataStatus} data · {item.movement.observations.length} timestamped changes</span>
        {micro && <span>YES book: {micro.bookState}{micro.midpoint === null ? " · midpoint unavailable" : ` · midpoint ${(micro.midpoint * 100).toFixed(1)}¢`}{micro.spread === null ? "" : ` · spread ${(micro.spread * 100).toFixed(1)}¢`}</span>}
        {item.movement.observations.slice(0, 4).map((observation, index) => <span key={`${observation.marketId}-${index}`}>{observation.marketId === focus.id ? "Primary" : "Related"} {cents(observation.change)} · {new Date(observation.from).toLocaleTimeString()}–{new Date(observation.to).toLocaleTimeString()}</span>)}
        {item.relationship.reasons.slice(0, 2).map((reason) => <small key={reason}>{reason}</small>)}
        {item.uncertainty.slice(0, 2).map((reason) => <small key={reason}>{reason}</small>)}
        {item.contradictions.map((reason) => <small key={reason}>{reason}</small>)}
      </article>;
    })}
    {data?.report?.relatedMarkets.length === 0 && <p className="cross-market-intro">No available provider details were returned for these related markets.</p>}
    {data?.explanation && <article className="cross-market-result"><b>MIRA explanation · {data.explanationMode === "groq" ? "grounded Groq" : "deterministic"}</b><small>RELATIONSHIP</small><span>{data.explanation.relationshipExplanation}</span><small>OBSERVATION</small><span>{data.explanation.movementExplanation}</span><small>EVIDENCE</small><span>{data.explanation.evidenceExplanation}</span>{data.explanation.evidenceIds.map((id) => { const source = data.evidenceReferences?.find((item) => item.id === id); return source ? <a key={id} href={source.url} target="_blank" rel="noreferrer">{id} · {source.source}: {source.title} · {source.publishedAt ? `Published ${new Date(source.publishedAt).toLocaleDateString()}` : "Publication date unavailable"}</a> : null; })}<small>INTERPRETATION</small><span>{data.explanation.summary}</span>{data.explanation.uncertainty.length > 0 && <><small>UNCERTAINTY</small><span>{data.explanation.uncertainty.join(" ")}</span></>}</article>}
    {data?.sharedResearch && <article className="cross-market-result"><b>Shared event research · {data.sharedResearch.status}</b><span>{data.sharedResearch.conclusion}</span><small>{data.sharedResearch.evidence.length} dated or undated sources retained · {data.sharedResearch.refreshed ? "refreshed" : "cached or reused"}</small>{data.sharedResearch.evidence.slice(0, 3).map((source) => <small key={source.url}>{source.source}: {source.title} · {source.publishedAt ? `Published ${new Date(source.publishedAt).toLocaleString()}` : `Retrieved ${new Date(source.retrievedAt).toLocaleString()}; publication date unavailable`}</small>)}{data.evidenceTiming?.slice(0, 3).map((item) => <small key={`${item.title}-${item.timing}`}>{item.timing === "undated" ? `The source did not provide a verifiable publication time, so its timing relative to the market movement cannot be established. · ${item.title}` : item.timing === "unknown" ? `Publication time is available, but no timestamp-aligned market movement window is available for comparison. · ${item.title}` : `Timing: ${item.timing.replaceAll("_", " ")} · ${item.title}`}</small>)}</article>}
    {data?.report && <p className="cross-market-disclaimer">Aligned movement is an observation; it does not establish causation or predict another market.</p>}
  </section>;
}
