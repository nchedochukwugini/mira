import assert from "node:assert/strict";
import test from "node:test";
import { snapshotCandidateExclusion } from "./snapshot-collector.ts";
import { PANTA_CLOB_PROGRAM_ID } from "./clob-layout.ts";

const activeSecondary = (overrides = {}) => ({
  id: "GXh9iztJTm5v6qDWnR4YcKHbSc3AUZ2VEMGfKEegd92V",
  pantaEventPda: "GXh9iztJTm5v6qDWnR4YcKHbSc3AUZ2VEMGfKEegd92V",
  question: "Example active secondary market",
  source: "panta",
  status: "active",
  phase: "secondary",
  pantaProgramId: PANTA_CLOB_PROGRAM_ID,
  pantaSecondaryActive: true,
  pantaIsGraduated: true,
  pantaIsResolved: false,
  quoteAsset: "USDC",
  yesProbability: null,
  noProbability: null,
  ...overrides,
});

test("snapshot eligibility validates secondary state, account mapping, and event identity independently of prices", () => {
  assert.equal(snapshotCandidateExclusion(activeSecondary()), null, "missing prices do not block an otherwise verified active market");
  assert.equal(snapshotCandidateExclusion(activeSecondary({ status: "unknown" })), "status_unverified");
  assert.equal(snapshotCandidateExclusion(activeSecondary({ pantaSecondaryActive: false })), "inactive");
  assert.equal(snapshotCandidateExclusion(activeSecondary({ pantaProgramId: "unsupported-program" })), "unsupported_account");
  assert.equal(snapshotCandidateExclusion(activeSecondary({ pantaEventPda: "not-a-solana-address" })), "invalid_identity");
  assert.equal(snapshotCandidateExclusion(activeSecondary({ quoteAsset: null })), "unsupported_quote_asset");
});
