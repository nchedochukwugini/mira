import { PublicKey } from "@solana/web3.js";
import { createSolanaMainnetConnection, assertSolanaMainnet } from "../lib/solana/rpc.ts";
import { applyAuthoritativeQuoteMetadata } from "../lib/panta/client.ts";
import { applyDecodedPantaEvent } from "../lib/panta/event-data.ts";
import { normalizePantaMarket } from "../lib/intelligence/core.ts";
import {
  buildOutcomeBooks, decodeOrderNode, decodePantaEvent, decodePriceLevel,
  PANTA_CLOB_PROGRAM_ID,
} from "../lib/panta/clob-layout.ts";

const officialBase = "https://production-api.balr.fun/api/v1";
const marketBase = (process.env.PANTA_API_URL || process.env.PANTA_API_BASE_URL || "https://live-api.panta.market/api/v1").replace(/\/$/, "");
const ids = [
  { uuid: "2fb6c4bb-1800-493d-b67c-91ca4bb8bd59", expectedQuote: "SOL" },
  { uuid: "30ac2ad2-8b79-4b8b-b360-1b431eec89f7", expectedQuote: "USDC" },
];
const connection = createSolanaMainnetConnection();
await assertSolanaMainnet(connection);
const program = new PublicKey(PANTA_CLOB_PROGRAM_ID);

async function readMarket({ uuid, expectedQuote }) {
  const retrievedAt = new Date().toISOString();
  const officialResponse = await fetch(`${officialBase}/events/${uuid}`, { signal: AbortSignal.timeout(10_000) });
  if (!officialResponse.ok) throw new Error(`Official event API HTTP ${officialResponse.status} for ${uuid}`);
  const officialPayload = await officialResponse.json();
  const official = officialPayload?.data ?? officialPayload;
  const pda = new PublicKey(official.eventPda);
  const levelResponse = await connection.getProgramAccounts(program, { commitment: "confirmed", withContext: true, filters: [{ dataSize: 218 }, { memcmp: { offset: 9, bytes: pda.toBase58() } }] });
  const nodeResponse = await connection.getProgramAccounts(program, { commitment: "confirmed", withContext: true, minContextSlot: levelResponse.context.slot, filters: [{ dataSize: 269 }, { memcmp: { offset: 41, bytes: pda.toBase58() } }] });
  const eventAccount = await connection.getAccountInfoAndContext(pda, { commitment: "confirmed", minContextSlot: nodeResponse.context.slot });
  if (!eventAccount.value || !eventAccount.value.owner.equals(program)) throw new Error(`Event PDA owner validation failed for ${uuid}`);
  const event = decodePantaEvent(eventAccount.value.data);
  if (!event) throw new Error(`Event discriminator/layout validation failed for ${uuid}`);
  const levels = [];
  const nodes = new Map();
  let decodeFailures = 0;
  for (const row of levelResponse.value) {
    if (!row.account.owner.equals(program)) { decodeFailures += 1; continue; }
    const level = decodePriceLevel(row.pubkey.toBase58(), row.account.data);
    if (!level || level.event !== pda.toBase58()) { decodeFailures += 1; continue; }
    levels.push(level);
  }
  for (const row of nodeResponse.value) {
    if (!row.account.owner.equals(program)) { decodeFailures += 1; continue; }
    const node = decodeOrderNode(row.pubkey.toBase58(), row.account.data);
    if (!node || node.event !== pda.toBase58()) { decodeFailures += 1; continue; }
    nodes.set(node.address, node);
  }
  const quoteAsset = String(official.quoteAsset ?? "").toUpperCase();
  const books = buildOutcomeBooks({ levels, nodes, quoteAsset: quoteAsset === "SOL" || quoteAsset === "USDC" ? quoteAsset : null });
  const detailUrl = `${marketBase}/markets/${encodeURIComponent(pda.toBase58())}/`;
  let legacy = { status: null, code: null, quoteAsset: null, fields: {} };
  let normalizedMarket = null;
  try {
    const response = await fetch(detailUrl, { headers: { Accept: "application/json", "X-Api-Key": process.env.PANTA_API_KEY ?? "" }, signal: AbortSignal.timeout(10_000) });
    const body = await response.json().catch(() => null);
    const data = body?.data ?? body;
    legacy = { status: response.status, code: data?.code ?? null, quoteAsset: data?.quoteAsset ?? data?.quote_asset ?? null, fields: Object.fromEntries(["primaryPoolLamports", "volumeUsdc", "totalVolumeUsdc", "yesPrice", "noPrice"].filter((key) => data?.[key] !== undefined).map((key) => [key, data[key]])) };
    if (response.ok) {
      const rawMarket = normalizePantaMarket(data);
      if (rawMarket) normalizedMarket = applyDecodedPantaEvent(applyAuthoritativeQuoteMetadata(rawMarket, official, retrievedAt), event, retrievedAt, eventAccount.context.slot);
    }
  } catch { legacy.status = 0; }
  const factor = quoteAsset === "SOL" ? 1e9 : quoteAsset === "USDC" ? 1e6 : null;
  return {
    uuid: official.id, eventPda: pda.toBase58(), expectedQuote, officialQuoteAsset: official.quoteAsset ?? null,
    officialQuoteMatchesExpected: quoteAsset === expectedQuote, legacy,
    legacyQuoteConflict: Boolean(legacy.quoteAsset && String(legacy.quoteAsset).toUpperCase() !== quoteAsset),
    mira: normalizedMarket ? { quoteAsset: normalizedMarket.quoteAsset, quoteAssetResolution: normalizedMarket.quoteAssetResolution,
      primaryPoolLiquidity: normalizedMarket.primaryPoolLiquidity, primaryPoolLiquidityStatus: normalizedMarket.primaryPoolLiquidityStatus,
      activeVolume: normalizedMarket.activeVolume, totalVolume: normalizedMarket.totalVolume, volumeUsd: normalizedMarket.volumeUsd,
      yesProbability: normalizedMarket.yesProbability, pantaPrices: normalizedMarket.pantaPrices } : null,
    rpc: { owner: eventAccount.value.owner.toBase58(), program: PANTA_CLOB_PROGRAM_ID, dataLength: eventAccount.value.data.length,
      slot: { event: eventAccount.context.slot, levels: levelResponse.context.slot, nodes: nodeResponse.context.slot }, retrievedAt,
      eventQuestion: event.question, eventFlags: { active: event.isActive, graduated: event.isGraduated, resolved: event.isResolved, cancelled: event.isCancelled },
      primaryPoolRawBaseUnits: event.primaryPoolBaseUnits.toString(), primaryPoolQuoteAmount: factor ? Number(event.primaryPoolBaseUnits) / factor : null,
      activeVolumeRawBaseUnits: event.activeVolumeBaseUnits.toString(), totalVolumeRawBaseUnits: event.totalVolumeBaseUnits.toString(),
      levelAccounts: levelResponse.value.length, orderNodeAccounts: nodeResponse.value.length, decodeFailures,
      decoderPartial: books.partial, yes: books.yes, no: books.no },
  };
}

const results = [];
for (const item of ids) results.push(await readMarket(item));
console.log(JSON.stringify({ mainnetReadOnly: true, results }, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2));
