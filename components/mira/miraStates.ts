export type MiraState =
  | "idle"
  | "greeting"
  | "thinking"
  | "searching"
  | "analyzing"
  | "explaining"
  | "success"
  | "insufficient-data"
  | "trade-ready"
  | "trade-success"
  | "error"
  | "resting";
export const miraStateCopy: Record<MiraState, { line: string; label: string }> = {
  idle: { line: "I'm here when you want to investigate something.", label: "READY WHEN YOU ARE" },
  greeting: { line: "Hi, I'm MIRA. What are we investigating?", label: "MIRA · MARKET INTELLIGENCE" },
  thinking: { line: "Let me understand what you're asking.", label: "THINKING THROUGH YOUR QUESTION" },
  searching: { line: "I'm looking across the connected markets now.", label: "SEARCHING MARKETS" },
  analyzing: { line: "I'm comparing the evidence and how these markets move together.", label: "STUDYING THE EVIDENCE" },
  explaining: { line: "Here's what the available market data can tell us.", label: "WALKING YOU THROUGH THE FINDINGS" },
  success: { line: "I found a useful view. Let's look at what supports it.", label: "ANALYSIS COMPLETE" },
  "insufficient-data": { line: "I couldn't verify enough market evidence for a reliable answer.", label: "MORE VERIFIED DATA NEEDED" },
  "trade-ready": { line: "I've opened the quote panel. Review every detail before you choose.", label: "YOUR DECISION · WALLET CONFIRMATION REQUIRED" },
  "trade-success": { line: "Your wallet confirmed that transaction.", label: "TRANSACTION CONFIRMED" },
  error: { line: "I couldn't reach the market provider. We can try again.", label: "PROVIDER CONNECTION ISSUE" },
  resting: { line: "Taking a quiet moment. Ask whenever you're ready.", label: "AT REST" },
};
