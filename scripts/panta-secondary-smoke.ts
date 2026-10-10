import { createRequire } from "node:module";
import { PublicKey } from "@solana/web3.js";
import { assertSolanaMainnet, createSolanaMainnetConnection } from "@/lib/solana/rpc";
import { decodeOrderNode, decodePantaEvent, decodePriceLevel, PANTA_CLOB_PROGRAM_ID } from "@/lib/panta/clob-layout";
import { discoverSecondaryMakers } from "@/lib/panta/secondary-book";
import { readPantaBuildContext } from "@/lib/panta/transaction-security";

createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());

async function main() {
  const event = new PublicKey("GXh9iztJTm5v6qDWnR4YcKHbSc3AUZ2VEMGfKEegd92V");
  const connection = createSolanaMainnetConnection();
  await assertSolanaMainnet(connection);
  const program = new PublicKey(PANTA_CLOB_PROGRAM_ID);
  const eventResponse = await connection.getAccountInfoAndContext(event, { commitment: "confirmed" });
  if (!eventResponse.value || !eventResponse.value.owner.equals(program)) throw new Error("Smoke Event is unavailable or has an unexpected owner.");
  const state = decodePantaEvent(eventResponse.value.data);
  if (!state) throw new Error("Smoke Event did not match the checked-in first-party layout.");
  const buildContext = await readPantaBuildContext(event.toBase58());
  const levels = await connection.getProgramAccounts(program, { commitment: "confirmed", withContext: true, filters: [{ dataSize: 218 }, { memcmp: { offset: 9, bytes: event.toBase58() } }] });
  console.log(JSON.stringify({ check: "read_only_mainnet_secondary_maker_discovery", event: event.toBase58(), eventSlot: eventResponse.context.slot, active: state.isActive, graduated: state.isGraduated, resolved: state.isResolved, priceLevelSlot: levels.context.slot, priceLevelsReturned: levels.value.length }));
  let candidate = false;
  for (const account of levels.value) {
    if (!account.account.owner.equals(program)) continue;
    const level = decodePriceLevel(account.pubkey.toBase58(), account.account.data);
    if (!level || level.event !== event.toBase58()) continue;
    for (const entry of [
      { buy: true, head: level.askHead },
      { buy: false, head: level.bidHead },
    ]) {
      if (entry.head === PublicKey.default.toBase58()) continue;
      const headKey = new PublicKey(entry.head);
      const headAccount = await connection.getAccountInfoAndContext(headKey, { commitment: "confirmed", minContextSlot: levels.context.slot });
      if (!headAccount.value || !headAccount.value.owner.equals(program)) continue;
      const head = decodeOrderNode(entry.head, headAccount.value.data);
      if (!head) continue;
      candidate = true;
      try {
        const result = await discoverSecondaryMakers({ connection, event, price: level.priceLamports, side: head.side, buy: entry.buy, maxTraversePerTx: buildContext.maxTraversePerTx });
        console.log(JSON.stringify({ check: "maker_list_validated", priceLevel: level.address, priceUnits: level.priceLamports.toString(), selectedList: entry.buy ? "asks" : "bids", firstMakerOutcome: head.side, validatedMakerCount: result.nodes.length, traversalLimit: result.traversalLimit, complete: result.complete, snapshotSlot: result.slot, accountSequenceLength: result.remainingAccounts.length }));
        return;
      } catch (error) {
        console.log(JSON.stringify({ check: "maker_list_rejected_closed", priceLevel: level.address, selectedList: entry.buy ? "asks" : "bids", reason: error instanceof Error ? error.message : "unknown validation error" }));
      }
    }
  }
  if (!candidate) console.log(JSON.stringify({ check: "no_populated_opposite_list_returned", event: event.toBase58(), note: "This RPC query returned no maker list candidate; this is not a statement that the market has no liquidity." }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Read-only secondary smoke check failed.");
  process.exitCode = 1;
});
