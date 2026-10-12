import { randomInt, randomUUID } from "node:crypto";
import { PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { createSecondaryOperation } from "@/lib/db";
import { jsonApiError } from "@/lib/http/json-api-response";
import { getMarketProvider } from "@/lib/providers/market-provider";
import { assertSolanaMainnet, createSolanaMainnetConnection } from "@/lib/solana/rpc";
import { decodeOrderNode, PANTA_CLOB_PROGRAM_ID } from "@/lib/panta/clob-layout";
import { discoverSecondaryMakers, isSupportedPantaTraversalLimit } from "@/lib/panta/secondary-book";
import { fitsSecondaryTransactionLimits } from "@/lib/panta/secondary-transaction-limits";
import { buildSecondaryCancellationInstruction, buildSecondaryPlacementInstruction, instructionToWalletFormat, secondaryPriceUnits, secondaryShareUnits } from "@/lib/panta/secondary-instructions";
import { readPantaBuildContext } from "@/lib/panta/transaction-security";

export const dynamic = "force-dynamic";

function isSecondaryActive(market: Awaited<ReturnType<ReturnType<typeof getMarketProvider>["getMarket"]>>) {
  return Boolean(market && market.source === "panta" && market.status === "active" && market.phase === "secondary"
    && market.pantaSecondaryActive === true && market.pantaIsGraduated === true && market.pantaIsResolved === false
    && market.pantaProgramId === PANTA_CLOB_PROGRAM_ID);
}

export async function POST(request: Request) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonApiError("invalid_json", "Request body must be valid JSON.", 400);
  }
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return jsonApiError("invalid_request", "A JSON object is required.", 400);
  }
  const body = rawBody as {
      operationType?: "placement" | "cancellation"; marketId?: string; wallet?: string;
      side?: "YES" | "NO"; price?: string; shares?: string; buy?: boolean; targetOrder?: string;
  };
  try {
    if (!body.operationType || !body.marketId || !body.wallet) return jsonApiError("invalid_request", "Operation, market, and wallet are required.", 400);
    if (body.operationType !== "placement" && body.operationType !== "cancellation") return jsonApiError("unsupported_operation", "Choose a supported secondary operation.", 400);
    let user: PublicKey;
    try {
      user = new PublicKey(body.wallet);
      if (!PublicKey.isOnCurve(user.toBytes())) return jsonApiError("invalid_wallet", "Wallet must be a valid signing public key.", 400);
    } catch {
      return jsonApiError("invalid_wallet", "Wallet must be a valid signing public key.", 400);
    }
    if (body.operationType === "placement" && (!body.side || !["YES", "NO"].includes(body.side) || !body.price || !body.shares || typeof body.buy !== "boolean")) return jsonApiError("invalid_order", "Placement requires a supported side, limit price, shares, and buy/sell direction.", 400);
    if (body.operationType === "cancellation" && !body.targetOrder) return jsonApiError("invalid_order", "Cancellation requires the exact order-node address.", 400);
    const provider = getMarketProvider();
    if (provider.source !== "panta") return jsonApiError("provider_unavailable", "Secondary trading requires the live Panta provider.", 503);
    const market = await provider.getMarket(body.marketId);
    if (!isSecondaryActive(market)) return jsonApiError("market_not_active", "Panta has not confirmed this as an active, unresolved secondary market.", 409);
    const context = await readPantaBuildContext(body.marketId);
    if (!context.eventState.isActive || !context.eventState.isGraduated || context.eventState.isResolved || context.eventState.isCancelled) {
      return jsonApiError("market_not_active", "The on-chain Event is not active for secondary trading.", 409);
    }
    if (context.priceTickSize <= BigInt(0) || !isSupportedPantaTraversalLimit(context.maxTraversePerTx)) return jsonApiError("unsupported_market_config", "Panta MarketConfig has unsupported secondary traversal settings.", 409);
    const connection = createSolanaMainnetConnection();
    await assertSolanaMainnet(connection);
    let instruction;
    let makerAccounts: Array<{ pubkey: string; role: string }> = [];
    let side: "YES" | "NO" | undefined;
    let priceUnits: bigint | undefined;
    let shareUnits: bigint | undefined;
    let buy: boolean | undefined;
    let targetOrder: string | undefined;
    let snapshotSlot = context.slot;
    let makerSnapshot: Awaited<ReturnType<typeof discoverSecondaryMakers>> | undefined;
    let cancelSnapshotKeys: PublicKey[] = [];
    let cancelSnapshotData: Buffer[] = [];
    if (body.operationType === "placement") {
      side = body.side!; buy = body.buy!;
      try {
        priceUnits = secondaryPriceUnits(body.price!);
        shareUnits = secondaryShareUnits(body.shares!);
      } catch {
        return jsonApiError("invalid_order", "Limit price and shares must use supported positive precision.", 400);
      }
      if (priceUnits <= BigInt(0) || shareUnits <= BigInt(0)) return jsonApiError("invalid_order", "Price and shares must be positive.", 400);
      const book = await discoverSecondaryMakers({ connection, event: context.event, price: priceUnits, side, buy, maxTraversePerTx: context.maxTraversePerTx });
      makerSnapshot = book;
      snapshotSlot = Math.max(context.slot, book.slot);
      makerAccounts = book.remainingAccounts.map((account, index) => ({ pubkey: account.pubkey.toBase58(), role: index < book.nodes.length * 2 ? index % 2 === 0 ? "maker_order" : "maker_position" : "tail" }));
      instruction = buildSecondaryPlacementInstruction({
        context: { event: context.event, creator: context.creator, question: context.question, treasury: context.treasury, usdcMint: context.usdcMint, priceTickSize: context.priceTickSize },
        user, side, price: body.price!, shares: body.shares!, buy,
        clientNonce: BigInt(randomInt(1, 2_147_483_647)), remainingAccounts: book.remainingAccounts,
      });
    } else if (body.operationType === "cancellation") {
      try { targetOrder = new PublicKey(body.targetOrder!).toBase58(); }
      catch { return jsonApiError("invalid_order", "Cancellation requires a valid order-node address.", 400); }
      const targetInfo = await connection.getAccountInfoAndContext(new PublicKey(targetOrder), { commitment: "confirmed", minContextSlot: context.slot });
      if (!targetInfo.value || !targetInfo.value.owner.equals(new PublicKey(PANTA_CLOB_PROGRAM_ID))) throw new Error("Cancellation target is missing or not owned by the Panta program.");
      const target = decodeOrderNode(targetOrder, targetInfo.value.data);
      if (!target) throw new Error("Cancellation target has an invalid OrderNode discriminator or layout.");
      const neighborKeys = [target.previous, target.next].filter((address) => address !== SystemProgram.programId.toBase58()).map((address) => new PublicKey(address));
      const neighbors = neighborKeys.length
        ? await connection.getMultipleAccountsInfoAndContext(neighborKeys, { commitment: "confirmed", minContextSlot: targetInfo.context.slot })
        : { value: [], context: targetInfo.context };
      cancelSnapshotKeys = [new PublicKey(targetOrder), ...neighborKeys];
      cancelSnapshotData = [Buffer.from(targetInfo.value.data), ...neighbors.value.map((account) => {
        if (!account) throw new Error("Cancellation neighbor disappeared during snapshot validation.");
        return Buffer.from(account.data);
      })];
      let neighborIndex = 0;
      const decodeNeighbor = (address: string) => {
        if (address === SystemProgram.programId.toBase58()) return null;
        const account = neighbors.value[neighborIndex++];
        if (!account || !account.owner.equals(new PublicKey(PANTA_CLOB_PROGRAM_ID))) throw new Error("Cancellation linked-list neighbor is missing or has the wrong owner.");
        const decoded = decodeOrderNode(address, account.data);
        if (!decoded) throw new Error("Cancellation neighbor has an invalid OrderNode layout.");
        return decoded;
      };
      const previous = decodeNeighbor(target.previous);
      const next = decodeNeighbor(target.next);
      instruction = buildSecondaryCancellationInstruction({ context: { event: context.event, creator: context.creator, question: context.question, treasury: context.treasury, usdcMint: context.usdcMint, priceTickSize: context.priceTickSize }, user, target, previous, next });
      snapshotSlot = Math.max(context.slot, targetInfo.context.slot, neighbors.context.slot);
      makerAccounts = [targetOrder, ...neighborKeys.map((key) => key.toBase58())].map((pubkey, index) => ({ pubkey, role: index === 0 ? "target_order" : "neighbor" }));
      side = target.side; priceUnits = target.priceLamports; shareUnits = target.amount;
    }
    if (!instruction) return jsonApiError("unsupported_operation", "Choose a supported secondary operation.", 400);

    const latest = await connection.getLatestBlockhash("confirmed");
    const nowHeight = await connection.getBlockHeight("confirmed");
    if (nowHeight > latest.lastValidBlockHeight) throw new Error("RPC returned a stale recent blockhash.");
    const refreshedContext = await readPantaBuildContext(body.marketId);
    if (refreshedContext.slot < snapshotSlot || !refreshedContext.eventState.isActive || !refreshedContext.eventState.isGraduated
      || refreshedContext.eventState.isResolved || refreshedContext.eventState.isCancelled) throw new Error("Market state changed or became stale before the validated build could be returned.");
    if (makerSnapshot && side && priceUnits !== undefined && buy !== undefined) {
      const refreshedBook = await discoverSecondaryMakers({ connection, event: context.event, price: priceUnits, side, buy, maxTraversePerTx: context.maxTraversePerTx });
      const originalSequence = makerSnapshot.remainingAccounts.map((account) => account.pubkey.toBase58());
      const refreshedSequence = refreshedBook.remainingAccounts.map((account) => account.pubkey.toBase58());
      if (JSON.stringify(originalSequence) !== JSON.stringify(refreshedSequence)
        || makerSnapshot.nodes.some((node, index) => node.amount !== refreshedBook.nodes[index]?.amount || node.next !== refreshedBook.nodes[index]?.next)) {
        throw new Error("The maker list changed during build construction; request a new build.");
      }
      snapshotSlot = refreshedBook.slot;
    }
    if (cancelSnapshotKeys.length) {
      const refreshedCancel = await connection.getMultipleAccountsInfoAndContext(cancelSnapshotKeys, { commitment: "confirmed", minContextSlot: snapshotSlot });
      if (refreshedCancel.value.some((account, index) => !account || !Buffer.from(account.data).equals(cancelSnapshotData[index]!))) throw new Error("The cancellation target or its neighbors changed during build construction.");
      snapshotSlot = refreshedCancel.context.slot;
    }
    const finalHeight = await connection.getBlockHeight("confirmed");
    const blockhashValid = await connection.isBlockhashValid(latest.blockhash, { commitment: "confirmed" });
    if (!blockhashValid.value || finalHeight > latest.lastValidBlockHeight) throw new Error("Build blockhash expired during final account revalidation.");
    const message = new TransactionMessage({ payerKey: user, recentBlockhash: latest.blockhash, instructions: [instruction] }).compileToV0Message();
    const transaction = new VersionedTransaction(message);
    let serializedSize: number;
    try { serializedSize = transaction.serialize().length; }
    catch { return jsonApiError("transaction_too_large", "This order requires more accounts than fit in a Solana v0 transaction. Reduce the order-book traversal and try again.", 413); }
    if (!fitsSecondaryTransactionLimits({ serializedBytes: serializedSize, accountCount: message.staticAccountKeys.length })) {
      return jsonApiError("transaction_too_large", "This order requires more accounts than fit in a Solana v0 transaction. Reduce the order-book traversal and try again.", 413);
    }
    const expectedMessageBase64 = Buffer.from(message.serialize()).toString("base64");
    const expectedInstructions = [instructionToWalletFormat(instruction)];
    const operationId = randomUUID();
    const expiresAt = new Date(Date.now() + 30_000).toISOString();
    await createSecondaryOperation({
      id: operationId, operationType: body.operationType, marketId: context.event.toBase58(), wallet: user.toBase58(), cluster: "mainnet-beta",
      side, priceUnits: priceUnits?.toString(), shareUnits: shareUnits?.toString(), buy, targetOrder,
      recentBlockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight, expectedMessageBase64,
      expectedInstructions, makerAccounts, snapshotSlot, expiresAt,
    });
    return Response.json({ data: {
      operationId, operationType: body.operationType, marketId: context.event.toBase58(), wallet: user.toBase58(), side,
      price: body.price ?? null, shares: body.shares ?? null, buy, targetOrder, instructions: expectedInstructions,
      recentBlockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight, expiresAt, snapshotSlot,
    }, status: "built", walletConfirmationRequired: true, network: "mainnet-beta" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/market state changed|maker list changed|blockhash expired|cancellation target or its neighbors changed/i.test(message)) {
      return jsonApiError("market_state_changed", "Market or order-book state changed while preparing the transaction. Refresh and prepare again.", 409);
    }
    console.error(JSON.stringify({ at: new Date().toISOString(), service: "mira-secondary-build", event: "build_failed", code: "secondary_build_unavailable" }));
    return jsonApiError("secondary_build_unavailable", "MIRA could not verify all required market accounts or prepare this transaction. Refresh and try again. Nothing was signed or broadcast.", 503);
  }
}
