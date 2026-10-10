"use client";

import { motion, useReducedMotion } from "motion/react";

export function DaylightWorld({ compact = false }: { compact?: boolean }) {
  const reduceMotion = useReducedMotion();
  return (
    <div className={`daylight-world ${compact ? "daylight-world--compact" : ""}`} aria-hidden="true">
      <motion.div className="world-cloud world-cloud--one" animate={reduceMotion ? undefined : { x: [0, 22, 0] }} transition={{ duration: 36, repeat: Infinity, ease: "easeInOut" }}>
        <span /><i /><b />
      </motion.div>
      <motion.div className="world-cloud world-cloud--two" animate={reduceMotion ? undefined : { x: [0, -17, 0] }} transition={{ duration: 43, repeat: Infinity, ease: "easeInOut" }}>
        <span /><i /><b />
      </motion.div>
      <div className="world-sun" />
      <motion.svg className="world-landscape" viewBox="0 0 1440 360" preserveAspectRatio="none" focusable="false">
        <path fill="#c9dd9a" d="M0 104c128-70 256-67 382 0 133 70 259 70 393 4 127-63 240-63 356 5 121 70 206 48 309-11v258H0z" />
        <path fill="#99c77d" d="M0 181c153-69 263-59 389-8 128 52 231 58 364 3 128-53 242-49 363 1 128 54 227 58 324 7v176H0z" />
        <path fill="#79ad69" d="M0 260c165-30 274-15 418 8 156 24 253-29 396-28 165 0 228 51 368 33 93-12 174-33 258-24v111H0z" />
        <path fill="#6e9d5c" d="M0 315c178-26 310-6 463-2 165 4 252-17 404-16 193 1 311 24 573 3v60H0z" />
        <g className="land-tree land-tree--left" fill="#548a55">
          <path d="M85 282h15v52H85z" fill="#806747"/><circle cx="93" cy="237" r="39"/><circle cx="63" cy="264" r="31"/><circle cx="122" cy="264" r="30"/>
          <path d="M164 301h10v39h-10z" fill="#806747"/><circle cx="169" cy="273" r="25"/><circle cx="149" cy="288" r="21"/><circle cx="189" cy="291" r="18"/>
        </g>
        <g className="land-tree land-tree--right" fill="#548a55">
          <path d="M1340 291h16v49h-16z" fill="#806747"/><circle cx="1348" cy="238" r="42"/><circle cx="1315" cy="267" r="31"/><circle cx="1384" cy="269" r="31"/>
          <path d="M1265 308h11v36h-11z" fill="#806747"/><circle cx="1271" cy="282" r="24"/><circle cx="1250" cy="298" r="18"/><circle cx="1290" cy="298" r="19"/>
        </g>
        <g fill="#f4d678" className="land-flower"><path d="M268 324c-3-9-12-7-10 1 2 6 9 4 10-1zm0 0c3-9 12-7 10 1-2 6-9 4-10-1zm0 0c-9-2-7-11 1-9 6 2 4 8-1 9zm0 0c9-2 7-11-1-9-6 2-4 8 1 9z"/><circle cx="268" cy="324" r="3" fill="#ce8f47"/></g>
        <g fill="#f5f1dd" className="land-flower land-flower--two"><circle cx="1142" cy="316" r="5"/><circle cx="1152" cy="316" r="5"/><circle cx="1147" cy="308" r="5"/><circle cx="1147" cy="324" r="5"/><circle cx="1147" cy="316" r="3" fill="#e7ba56"/></g>
        <g fill="#d9aa5f"><path d="M389 340c2-19 7-25 11-31-2 12-5 21-5 31z"/><path d="M400 340c0-12 7-19 14-22-6 9-8 15-8 22z"/><path d="M1027 342c1-18 5-25 10-31-2 13-5 20-5 31z"/><path d="M1038 342c0-12 7-18 14-21-6 8-8 14-8 21z"/></g>
      </motion.svg>
      <motion.svg className="world-bird world-bird--one" viewBox="0 0 42 20" animate={reduceMotion ? undefined : { x: [0, 78, 0], y: [0, -9, 0] }} transition={{ duration: 27, repeat: Infinity, ease: "easeInOut" }}>
        <path d="M2 13c7-9 13-9 19 0 6-9 12-9 19 0" fill="none" stroke="#6d8c79" strokeWidth="2.2" strokeLinecap="round" />
      </motion.svg>
      <motion.svg className="world-bird world-bird--two" viewBox="0 0 42 20" animate={reduceMotion ? undefined : { x: [0, -46, 0], y: [0, 7, 0] }} transition={{ duration: 31, repeat: Infinity, ease: "easeInOut", delay: 7 }}>
        <path d="M2 13c7-9 13-9 19 0 6-9 12-9 19 0" fill="none" stroke="#6d8c79" strokeWidth="2.2" strokeLinecap="round" />
      </motion.svg>
    </div>
  );
}
