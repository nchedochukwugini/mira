"use client";

import { motion } from "motion/react";
import { MiraCharacter } from "@/components/mira/MiraCharacter";
import { miraStateCopy, type MiraState } from "@/components/mira/miraStates";
import type { Market } from "@/lib/panta/types";

const phases: { state: MiraState; label: string }[] = [
  { state: "searching", label: "Find markets" },
  { state: "analyzing", label: "Compare evidence" },
  { state: "explaining", label: "Explain findings" },
];

export function MiraInvestigation({ state, markets, question, step, pantaEnvironment = "unknown" }: {
  state: MiraState;
  markets: Market[];
  question?: string;
  step?: string;
  pantaEnvironment?: "test" | "live" | "unknown";
}) {
  const activePhase = state === "thinking" || state === "searching" ? 0
    : state === "analyzing" ? 1
      : state === "explaining" || state === "success" || state === "insufficient-data" ? 2 : -1;
  const shownMarkets = markets.slice(0, 2);
  return <section className={`mira-investigation mira-investigation--${state}`} aria-label="MIRA market investigation" aria-live="polite">
    <div className="mira-investigation__landscape" aria-hidden="true">
      <div className="investigation-sun" />
      <div className="investigation-cloud investigation-cloud--one" /><div className="investigation-cloud investigation-cloud--two" />
      <svg className="investigation-hills" viewBox="0 0 900 170" preserveAspectRatio="none">
        <path d="M0 92c112-68 202-70 312-18 87 41 172 38 270-6 121-54 220-45 318 7v95H0z" fill="#d8e7bc" />
        <path d="M0 119c137-44 254-29 354 4 118 39 206-15 318-14 88 1 150 26 228 9v61H0z" fill="#b6d494" />
      </svg>
      <svg className="investigation-tree" viewBox="0 0 150 205">
        <path d="M68 108h19v91H68z" fill="#9b7954" />
        <path d="M77 142 40 95m39 29 39-49M77 104 62 63" fill="none" stroke="#9b7954" strokeWidth="8" strokeLinecap="round" />
        <circle cx="74" cy="52" r="35" fill="#83aa68" /><circle cx="43" cy="79" r="30" fill="#8fb574" /><circle cx="105" cy="83" r="32" fill="#779e62" />
        <circle cx="61" cy="46" r="7" fill="#a9c785" opacity=".8" /><circle cx="105" cy="73" r="8" fill="#a9c785" opacity=".8" />
      </svg>
      <div className="investigation-grass investigation-grass--one" /><div className="investigation-grass investigation-grass--two" />
    </div>
    <div className="mira-investigation__topline"><span className="mira-live-dot" /> MIRA IS WITH YOU <span className="mira-investigation__divider">/</span>{miraStateCopy[state].label}</div>
    {question && <div className="mira-investigation__question"><span>INVESTIGATING</span><p>{question}</p></div>}
    <div className="mira-investigation__stage">
      <div className="mira-investigation__character"><MiraCharacter state={state} compact /></div>
      <div className="mira-investigation__speech"><span className="mira-speech-mark">M</span><div><b>MIRA</b><p>{step && (state === "thinking" || state === "searching" || state === "analyzing") ? step : miraStateCopy[state].line}</p></div></div>
      <div className="mira-investigation__evidence" aria-label="Market evidence being reviewed">
        {shownMarkets.length ? shownMarkets.map((market, index) => <motion.article className="investigation-market-note" key={market.id} initial={{ opacity: 0, y: 9, x: 8 }} animate={{ opacity: 1, y: 0, x: 0 }} transition={{ delay: .12 + index * .16, duration: .35 }}>
          <span>{market.category ?? "MARKET"}{market.source === "demo" ? " · DEMO" : pantaEnvironment === "test" ? " · PANTA TEST" : pantaEnvironment === "live" ? "" : " · PANTA · UNKNOWN"}</span>
          <b>{market.question}</b>
          <small><strong>YES {market.yesProbability === null ? "—" : `${Math.round(market.yesProbability * 100)}%`}</strong><i /> NO {market.noProbability === null ? "—" : `${Math.round(market.noProbability * 100)}%`}</small>
        </motion.article>) : <div className="investigation-evidence-steps">
          {phases.slice(0, state === "thinking" ? 1 : 2).map((phase, index) => {
            const done = activePhase > index;
            const active = activePhase === index;
            return <div className={`investigation-evidence-step ${done ? "is-done" : ""} ${active ? "is-active" : ""}`} key={phase.state}>
              <span>{done ? "✓" : active ? <i /> : "·"}</span><b>{phase.label}</b>{active && <small>{step ?? "Working with provider data"}</small>}
            </div>;
          })}
        </div>}
      </div>
    </div>
    {activePhase >= 0 && <div className="mira-investigation__phases" aria-label="Analysis progress">
      {phases.map((phase, index) => <div className={`${activePhase === index ? "is-active" : ""} ${activePhase > index ? "is-done" : ""}`} key={phase.state}><span>{activePhase > index ? "✓" : `0${index + 1}`}</span>{phase.label}</div>)}
    </div>}
  </section>;
}
