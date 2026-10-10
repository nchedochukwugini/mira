"use client";

import { ArrowRight, ArrowUpRight, CircleHelp, Compass, Leaf } from "lucide-react";
import { motion } from "motion/react";
import { DaylightWorld } from "@/components/environment/DaylightWorld";
import { MiraCharacter } from "@/components/mira/MiraCharacter";
import type { MiraState } from "@/components/mira/miraStates";
import { Composer } from "@/components/workspace/Composer";
import { WalletButton } from "@/components/wallet/WalletButton";
import { MarketCard } from "@/components/markets/MarketCard";
import type { Market } from "@/lib/panta/types";
import type { SolanaWallet } from "@/lib/wallet/types";
import { rankMarketSuggestions } from "@/lib/intelligence/market-suggestions";

export function HomeExperience({ mode, environment = "unknown", markets, prompt, setPrompt, onSubmit, onWallet, onOpenWorkspace, onSelect, onTrade, onWatch, watched, state }: {
  mode: "demo" | "panta";
  environment?: "test" | "live" | "unknown";
  markets: Market[];
  prompt: string;
  setPrompt: (value: string) => void;
  onSubmit: () => void;
  onWallet: (wallet: SolanaWallet | null) => void;
  onOpenWorkspace: (view: "markets" | "portfolio" | "watchlist") => void;
  onSelect: (market: Market) => void;
  onTrade: (market: Market, outcome: "YES" | "NO") => void;
  onWatch: (market: Market) => void;
  watched: Set<string>;
  state: MiraState;
}) {
  const suggestions = rankMarketSuggestions(markets).slice(0, 3);
  return <main className="home-world min-h-screen">
    <DaylightWorld />
    <header className="home-header"><a className="home-brand" href="#home" aria-label="MIRA home"><span className="brand-sign"><Leaf size={19} fill="currentColor" /></span><span><b>MIRA</b><small>MARKET INTELLIGENCE</small></span></a><nav className="home-header__nav"><button onClick={() => onOpenWorkspace("markets")}>Explore markets</button><a href="https://docs.panta.market/" target="_blank" rel="noreferrer">How it works <ArrowUpRight size={13} /></a></nav><div className="home-header__right"><WalletButton onWallet={onWallet} /></div></header>
    <section className="home-hero">
      <motion.div className="hero-copy" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .65 }}>
        <span className="hero-overline"><span /> A CLEARER VIEW OF WHAT COMES NEXT</span>
        <h1>Ask the markets<br /><em>anything.</em></h1>
        <p className="hero-subtitle">MIRA searches prediction markets, compares what the crowd is pricing, and lays out the evidence — so you can make up your own mind.</p>
        <div className="home-composer-wrap"><Composer value={prompt} onChange={setPrompt} onSubmit={onSubmit} /><div className="composer-hint"><span>↵ to analyze</span><span>Shift + ↵ for a new line</span></div></div>
        <div className="prompt-suggestions"><span className="suggestion-label">{suggestions.length ? "PANTA MARKETS IN THEIR TRADING WINDOW" : "MARKET DISCOVERY"}</span>{suggestions.map((market, index) => <motion.button key={market.id} onClick={() => setPrompt(market.question)} initial={{ opacity: 0, x: -5 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .25 + index * .09 }}>{market.question}<span className="market-phase-inline">{market.phase?.replace(/[_-]+/g, " ").toUpperCase() ?? "PHASE UNAVAILABLE"}</span><ArrowRight size={12} /></motion.button>)}{!suggestions.length && <span className="suggestion-empty">No live Panta markets are currently within their trading windows.</span>}</div>
      </motion.div>
      <motion.div className="hero-companion" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: .8, delay: .16 }}>
        <div className="hero-mira-wrap"><MiraCharacter state={state} showDialogue /></div>
        <div className="hero-companion__marker"><Compass size={12} /> MARKET GUIDE</div>
      </motion.div>
      <div className="hero-annotation hero-annotation--left"><span className="annotation-line" />Probabilities are prices,<br />not promises.</div>
      <div className="hero-annotation hero-annotation--right"><CircleHelp size={13} /> Every number has a source.</div>
    </section>
    <section className="home-market-strip" aria-label="Market examples from provider">
      <div className="home-market-strip__head"><div><span className="panel-kicker">A LOOK AT THE LANDSCAPE</span><h2>{markets.length ? "Markets in view" : "Markets will appear here"}</h2></div><button onClick={() => onOpenWorkspace("markets")}>Browse markets <ArrowRight size={14} /></button></div>
      {suggestions.length ? <div className="home-market-strip__items">{suggestions.map((market, index) => <MarketCard key={market.id} market={market} index={index} pantaEnvironment={environment} isWatched={watched.has(market.id)} onWatch={onWatch} onSelect={(selected) => { onOpenWorkspace("markets"); onSelect(selected); }} onTrade={(selected, outcome) => { onOpenWorkspace("markets"); onTrade(selected, outcome); }} />)}</div> : <p className="home-market-strip__empty">No live Panta markets are currently within their trading windows.</p>}
      {mode === "demo" && <div className="home-market-strip__stamp">DEMO PROVIDER · NUMBERS ARE ILLUSTRATIVE</div>}
    </section>
    <footer className="home-footer"><span>© MIRA · MARKET INTELLIGENCE</span><span>BUILT TO HELP YOU SEE THE WHOLE PICTURE <Leaf size={12} /></span>{mode === "demo" && <span>DEMO ENVIRONMENT</span>}</footer>
  </main>;
}
