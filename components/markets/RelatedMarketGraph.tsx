import { ArrowUpRight, Info, Link2 } from "lucide-react";
import type { Market, RelatedMarket } from "@/lib/panta/types";

export function RelatedMarketGraph({ focus, markets, onSelect, isDemo, relationships = [] }: { focus: Market | null; markets: Market[]; onSelect: (market: Market) => void; isDemo: boolean; relationships?: RelatedMarket[] }) {
  const edges = focus ? relationships.filter((edge) => edge.marketId === focus.id || edge.relatedMarketId === focus.id) : [];
  const linkedIds = edges.length
    ? edges.map((edge) => edge.marketId === focus?.id ? edge.relatedMarketId : edge.marketId)
    : focus?.relatedMarketIds ?? [];
  const linked = [...new Set(linkedIds)].map((id) => markets.find((market) => market.id === id)).filter((market): market is Market => Boolean(market));

  return <section className="intelligence-section">
    <div className="panel-heading"><div><span className="panel-kicker">MARKET CONTEXT</span><h3>Related markets</h3></div><Link2 size={16} strokeWidth={1.7} /></div>
    {focus && linked.length ? <div className="related-market-list" aria-label={`${linked.length} related markets`}>
      {linked.map((market) => {
        const edge = edges.find((candidate) => candidate.relatedMarketId === market.id || candidate.marketId === market.id);
        const label = edge ? edge.relationship === "provider_link" ? "Panta linked" : edge.relationship === "shared_entity" ? "Shared topic" : "Same category" : "Panta linked";
        const explanation = edge?.explanation ?? "The provider lists this market as related.";
        return <button className="related-market-item" key={market.id} onClick={() => onSelect(market)}>
          <span className="related-market-item__label">{label}</span>
          <b>{market.question}</b>
          <span className="related-market-item__evidence">{explanation}</span>
          <span className="related-market-item__price">YES {market.yesProbability === null ? "Unavailable" : `${Math.round(market.yesProbability * 100)}%`} <ArrowUpRight size={12} /></span>
        </button>;
      })}
    </div> : <div className="graph-empty"><Info size={15} /><p>{focus ? "No related markets were returned for this listing." : "Choose a market to see its related context."}</p></div>}
    {isDemo && <p className="panel-source-note">Demo relationships are illustrative fixtures, not live Panta signals.</p>}
  </section>;
}
