import assert from "node:assert/strict";
import test from "node:test";
import { rankDiscoveredMarkets, rankMarketSuggestions } from "./market-suggestions.ts";
import { demoProviderAllowed } from "../providers/market-provider.ts";

function market(overrides = {}) {
  return {
    id: "provider-market-1",
    question: "Provider supplied title",
    category: "Other",
    description: null,
    status: "active",
    phase: "primary",
    pantaIsResolved: false,
    startAt: "2027-01-01T00:00:00.000Z",
    closeAt: "2029-01-01T00:00:00.000Z",
    yesProbability: 0.6,
    noProbability: 0.4,
    volumeUsd: 25,
    liquidityUsd: null,
    priceChange24h: null,
    updatedAt: null,
    imageUrl: null,
    history: [],
    relatedMarketIds: [],
    source: "panta",
    ...overrides,
  };
}

test("market suggestions contain only titled records supplied by the provider and rank active records first", () => {
  const now = Date.parse("2028-01-01T00:00:00.000Z");
  const closed = market({ id: "closed", question: "Historical provider title", status: "resolved", pantaIsResolved: true, volumeUsd: 5000 });
  const active = market({ id: "active", question: "Current provider title", volumeUsd: 20 });
  const secondaryCandidate = market({ id: "secondary-live", question: "Provider secondary title", source: "panta", phase: "secondary", status: "unknown", pantaIsResolved: false, pantaSecondaryActive: null, pantaIsGraduated: null, startAt: "2027-01-01T00:00:00.000Z", closeAt: "2029-01-01T00:00:00.000Z" });
  const demo = market({ id: "demo", source: "demo" });
  const untitled = market({ id: "incomplete", question: "Market title unavailable" });
  assert.deepEqual(rankMarketSuggestions([closed, untitled, demo, secondaryCandidate, active], now).map((item) => item.id), ["active", "secondary-live"]);
});

test("empty or failed provider results have no local recommendation fallback", () => {
  const now = Date.parse("2028-01-01T00:00:00.000Z");
  assert.deepEqual(rankMarketSuggestions([], now), []);
  assert.deepEqual(rankMarketSuggestions([market({ question: "", id: "missing-title" })], now), []);
  assert.deepEqual(rankMarketSuggestions([market({ status: "unknown" })], now), []);
  assert.deepEqual(rankMarketSuggestions([market({ phase: "secondary", pantaIsResolved: false, startAt: "2028-01-01T00:00:01.000Z" })], now), []);
});

test("discovery ranks query matches from provider records and prioritizes historical status for past queries", () => {
  const unrelated = market({ id: "other", question: "Election turnout", status: "active" });
  const live = market({ id: "bitcoin-live", question: "Bitcoin price above 100k", status: "active" });
  const resolved = market({ id: "bitcoin-past", question: "Bitcoin price above 90k last month", status: "resolved" });
  assert.deepEqual(rankDiscoveredMarkets("Bitcoin past markets", [unrelated, live, resolved]).map((item) => item.id), ["bitcoin-past", "bitcoin-live"]);
  assert.deepEqual(rankDiscoveredMarkets("Bitcoin now", [resolved, live]).map((item) => item.id), ["bitcoin-live", "bitcoin-past"]);
});

test("demo fixture provider requires explicit development mode and cannot be selected in production", () => {
  assert.equal(demoProviderAllowed("development", "demo"), true);
  assert.equal(demoProviderAllowed("development", "panta"), false);
  assert.equal(demoProviderAllowed("production", "demo"), false);
  assert.equal(demoProviderAllowed("production", undefined), false);
});
