const skipGroq = process.argv.includes("--skip-groq");
if (skipGroq) process.env.GROQ_API_KEY = "";
const { getMarketProvider } = await import("@/lib/providers/market-provider");
const { runResearch } = await import("@/lib/research/research-report");
const provider = getMarketProvider();
const markets = await provider.discoverMarkets("Arsenal Leeds United October 10 2026");
const target = markets.find((item) => /arsenal/i.test(item.question) && /leeds/i.test(item.question) && /october\s+10,?\s+2026/i.test(item.question));
if (!target) {
  console.log(JSON.stringify({ phase: "market", marketFound: false, discovered: markets.slice(0, 15).map(({ id, question, status, closeAt }) => ({ id, question, status, closeAt })) }));
  process.exitCode = 2;
} else {
  console.log(JSON.stringify({ phase: "market", market: { id: target.id, question: target.question, status: target.status, closeAt: target.closeAt, category: target.category, description: target.description, source: target.source, environment: provider.environment } }));
  if (target.status !== "active") {
    console.log(JSON.stringify({ phase: "research", skipped: `market status is ${target.status}` }));
  } else {
    const report = await runResearch({ question: "Research this market", contextMarkets: [{ id: target.id, question: target.question }], provider, marketId: target.id, refresh: true, depth: "deep" });
    console.log(JSON.stringify({
      phase: "report", groqSkippedByRequest: skipGroq, status: report.status, conclusion: report.conclusion, assessment: report.assessment,
      diagnostics: report.diagnostics, synthesisMode: report.synthesisMode, synthesisMessage: report.synthesisMessage,
      market: { id: report.market?.id, question: report.market?.question, status: report.market?.status, closeAt: report.market?.closeAt, description: report.market?.description },
      evidence: report.evidence.map(({ id, title, url, publishedAt, retrievedAt, pageRetrieved, eventRelevance, direction, usageStatus, usageReason, reliability, relevance }) => ({ id, title, url, publishedAt, retrievedAt, pageRetrieved, eventRelevance, direction, usageStatus, usageReason, reliability, relevance })),
      eventIntelligence: report.eventIntelligence ? {
        marketRelevance: report.eventIntelligence.marketRelevance, status: report.eventIntelligence.event.status,
        summary: report.eventIntelligence.event.summary, evidenceIds: report.eventIntelligence.event.evidenceIds,
        explanationMode: report.eventIntelligence.explanationMode,
        citedEvidenceIds: report.eventIntelligence.explanation.evidenceIds.map((id) => report.eventIntelligence.evidenceReferences[id]).filter(Boolean),
      } : null,
    }));
  }
}
