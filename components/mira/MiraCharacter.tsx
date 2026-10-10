"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { miraCharacterMotion, miraMotionDuration } from "@/components/mira/miraAnimations";
import { miraStateCopy, type MiraState } from "@/components/mira/miraStates";

export type { MiraState } from "@/components/mira/miraStates";

export function MiraCharacter({ state = "idle", compact = false, showDialogue = false }: {
  state?: MiraState;
  compact?: boolean;
  showDialogue?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const [blink, setBlink] = useState(false);
  const busy = state === "thinking" || state === "searching" || state === "analyzing";
  const celebratory = state === "success" || state === "trade-success";
  const tilted = state === "insufficient-data" || state === "error";
  const gesturing = state === "analyzing" || state === "explaining";
  const gaze = state === "searching" ? [0, 3, -2, 0] : state === "idle" ? [0, 1.5, 0, -1, 0] : state === "thinking" ? [0, -1, 0] : state === "analyzing" ? [0, 2.5, -1.5, 0] : 0;
  const headTurn = tilted ? [-3, 3.5, -2] : state === "thinking" ? [0, -2.5, -1] : state === "searching" ? [0, 1.7, -1.3, 0] : state === "analyzing" ? [1, -1.5, 0] : state === "explaining" ? [0, 1.5, 0] : state === "greeting" ? [0, 1, 0] : 0;

  useEffect(() => {
    if (reduceMotion) return;
    let blinkTimer: ReturnType<typeof setTimeout>;
    let closeTimer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const scheduleBlink = () => {
      blinkTimer = setTimeout(() => {
        if (cancelled) return;
        setBlink(true);
        closeTimer = setTimeout(() => setBlink(false), 125);
        scheduleBlink();
      }, 3000 + Math.random() * 2100);
    };
    scheduleBlink();
    return () => { cancelled = true; clearTimeout(blinkTimer); clearTimeout(closeTimer); };
  }, [reduceMotion]);

  return <div className={`mira-character mira-character--${state} ${compact ? "mira-character--compact" : ""}`} role="img" aria-label={`MIRA, ${miraStateCopy[state].label.toLowerCase()}`}>
    <motion.svg
      viewBox="0 0 190 190"
      className="mira-character__art"
      aria-hidden="true"
      initial={false}
      animate={reduceMotion ? undefined : miraCharacterMotion[state]}
      transition={{
        y: { duration: miraMotionDuration(state), repeat: Infinity, ease: "easeInOut" },
        rotate: { duration: state === "insufficient-data" || state === "error" ? 2.8 : miraMotionDuration(state), repeat: Infinity, ease: "easeInOut" },
        scale: { duration: miraMotionDuration(state), repeat: Infinity, ease: "easeInOut" },
        x: { duration: 2.1, repeat: Infinity, ease: "easeInOut" },
      }}
    >
      <ellipse cx="95" cy="178" rx="45" ry="6" fill="#4e7548" opacity=".17" />
      {/* Full, animal silhouette: seated haunches, four paws and a brush tail. */}
      <motion.path d="M126 139c25-5 39 5 37 19-2 15-18 18-31 8 17 0 18-14 4-15-11-1-18 4-25 9z" fill="#c97343" stroke="#6f5639" strokeWidth="2.3" strokeLinejoin="round" style={{ transformOrigin: "137px 151px" }} animate={reduceMotion ? undefined : { rotate: state === "resting" || state === "analyzing" ? [0, 2, 0] : [0, 5, -2, 0] }} transition={{ duration: celebratory ? 1 : 4, repeat: Infinity, ease: "easeInOut" }} />
      <path d="M145 151c8 2 11 7 8 12-3 5-9 6-14 2 11-1 11-8 1-9z" fill="#f3e3c9" />
      <motion.g animate={reduceMotion ? undefined : { rotate: headTurn, y: state === "thinking" ? [0, 1.5, 0] : state === "explaining" ? [0, -.5, 0] : 0 }} transition={{ duration: tilted ? 3.2 : state === "searching" ? 2.3 : 3, repeat: Infinity, ease: "easeInOut" }} style={{ transformOrigin: "95px 106px" }}>
        <ellipse cx="95" cy="145" rx="43" ry="27" fill="#c97343" stroke="#6f5639" strokeWidth="2.4" />
        <ellipse cx="95" cy="144" rx="22" ry="22" fill="#f3e7d1" />
        <path d="M62 144c-16 7-16 24-1 27h21v-8c-9-2-12-8-8-15zM127 144c16 7 16 24 1 27h-21v-8c9-2 12-8 8-15z" fill="#d9824d" stroke="#6f5639" strokeWidth="2.2" strokeLinejoin="round" />
        <path d="M67 162c3 5 9 7 15 7h-20c-6 0-8-4-6-8zM123 162c-3 5-9 7-15 7h20c6 0 8-4 6-8z" fill="#f4e7cf" />
        <path d="m63 82-12-40c-2-5 4-8 8-4l25 28M127 82l12-40c2-5-4-8-8-4l-25 28" fill="#cc7544" stroke="#6f5639" strokeWidth="2.7" strokeLinejoin="round" />
        <path d="m56 49-4-15 17 15M134 49l4-15-17 15" fill="#f2c59f" />
        <path d="M47 94c0-32 21-54 48-54s48 22 48 54c0 34-20 52-48 52S47 128 47 94z" fill="#dc8751" stroke="#6f5639" strokeWidth="2.7" />
        <path d="M58 104c2-18 17-28 37-28s35 10 37 28c2 16-11 29-24 29-5 0-9-2-13-6-4 4-8 6-13 6-13 0-26-13-24-29z" fill="#f4e7cf" />
        <motion.g animate={reduceMotion ? undefined : { x: gaze, scaleY: blink ? .12 : 1 }} transition={{ x: { duration: state === "idle" ? 5.5 : 2.1, repeat: Infinity, ease: "easeInOut" }, scaleY: { duration: .08 } }} style={{ transformOrigin: "78px 99px" }}>
          <ellipse cx="78" cy="99" rx="5" ry="7.5" fill="#34473b" /><circle cx="76.5" cy="97" r="1.7" fill="#fff9ea" />
        </motion.g>
        <motion.g animate={reduceMotion ? undefined : { x: gaze, scaleY: blink ? .12 : 1 }} transition={{ x: { duration: state === "idle" ? 5.5 : 2.1, repeat: Infinity, ease: "easeInOut" }, scaleY: { duration: .08 } }} style={{ transformOrigin: "113px 99px" }}>
          <ellipse cx="113" cy="99" rx="5" ry="7.5" fill="#34473b" /><circle cx="111.5" cy="97" r="1.7" fill="#fff9ea" />
        </motion.g>
        <path d="M68 86c7-6 14-7 21-3M103 83c8-5 16-4 22 3" fill="none" stroke="#75533c" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M91 113c1-5 7-6 9 0l-4 4z" fill="#765641" />
        {tilted ? <path d="M86 126c5-5 14-5 19 0" fill="none" stroke="#765641" strokeWidth="1.8" strokeLinecap="round" /> : <motion.path d="M86 124c5 7 15 7 20 0" fill="none" stroke="#765641" strokeWidth="1.9" strokeLinecap="round" style={{ transformOrigin: "96px 124px" }} animate={reduceMotion || state !== "explaining" ? { scaleY: 1 } : { scaleY: [1, .55, 1, .7, 1] }} transition={{ duration: .8, repeat: Infinity, ease: "easeInOut" }} />}
        <path d="m84 139 11 5 11-5-3 12H87z" fill="#668651" />
        <circle cx="95" cy="146" r="3" fill="#e3b55a" />
      </motion.g>
      {gesturing && <motion.g style={{ transformOrigin: "124px 137px" }} initial={{ rotate: 0 }} animate={reduceMotion ? undefined : { rotate: [0, -8, -11, -4] }} transition={{ duration: 2.6, repeat: Infinity, repeatDelay: .5, ease: "easeInOut" }}>
        <path d="M119 139c9 2 15-1 20-8l7-9" fill="none" stroke="#d9824d" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
        <path d="m146 124 1-9 6 7" fill="none" stroke="#f3e7d1" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </motion.g>}
      {busy && <motion.g className={`mira-character__thought mira-character__thought--${state}`} initial={{ opacity: 0, y: 3 }} animate={reduceMotion ? { opacity: 1, y: 0 } : { opacity: [0.65, 1, .75], y: [2, -2, 2] }} transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}>
        <circle cx="157" cy="35" r="10" fill="#fffdf3" stroke="#93ac76" strokeWidth="1.5" /><circle cx="144" cy="49" r="3.5" fill="#fffdf3" stroke="#93ac76" strokeWidth="1.2" />
        {state === "thinking" && <g fill="#668851"><circle cx="154" cy="35" r="1.2"/><circle cx="158" cy="35" r="1.2"/><circle cx="162" cy="35" r="1.2"/></g>}
        {state === "searching" && <g fill="none" stroke="#668851" strokeWidth="1.5" strokeLinecap="round"><circle cx="156" cy="34" r="3.5"/><path d="m159 37 3 3"/></g>}
        {state === "analyzing" && <g fill="#668851"><rect x="153" y="35" width="2" height="4" rx=".5"/><rect x="157" y="32" width="2" height="7" rx=".5"/><rect x="161" y="30" width="2" height="9" rx=".5"/></g>}
      </motion.g>}
      {state === "trade-ready" && <motion.path d="M139 118c8-10 17-11 24-9m-8-6 8 6-8 6" fill="none" stroke="#68854f" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" initial={{ opacity: 0 }} animate={{ opacity: 1 }} />}
      {celebratory && <motion.g initial={{ opacity: 0, scale: .6 }} animate={reduceMotion ? { opacity: .8, scale: 1 } : { opacity: [0, 1, 0], scale: [0.7, 1, .9], y: [2, -8, -13] }} transition={{ duration: 2.1, repeat: Infinity, repeatDelay: 2.4 }} fill="#86a768"><path d="m40 74 2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/><path d="m151 88 1.5 3.5 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5z"/></motion.g>}
    </motion.svg>
    {showDialogue && <div className="mira-character__dialogue" aria-live="polite"><span>{miraStateCopy[state].label}</span><p>{miraStateCopy[state].line}</p></div>}
    {!compact && !showDialogue && <span className="mira-character__mood">{miraStateCopy[state].line}</span>}
  </div>;
}
