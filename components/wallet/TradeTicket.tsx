"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, LoaderCircle, ShieldCheck, X } from "lucide-react";
import { motion } from "motion/react";
import { Connection, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { Buffer } from "buffer";
import type { Market, PantaTradeBuild, TradeQuote } from "@/lib/panta/types";
import type { SolanaWallet } from "@/lib/wallet/types";
import { MiraCharacter } from "@/components/mira/MiraCharacter";
import { WalletButton } from "@/components/wallet/WalletButton";
import { canOpenWalletSigning, isQuoteExpired } from "@/lib/panta/trade-safety";

type Stage = "edit" | "quoting" | "building" | "prepared" | "signing" | "broadcasting" | "verifying" | "complete" | "failed" | "broadcast-unknown";
const cluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet";
const rpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "";
const money = (value: number | null) => value === null || !Number.isFinite(value) ? "Unavailable" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const shortError = (cause: unknown): string => {
  const message = cause instanceof Error ? cause.message : "The trade could not be completed.";
  if (/user rejected|reject(ed)? the request|declined/i.test(message)) return "Your wallet rejected the signing request. Nothing was broadcast.";
  if (/insufficient.*(fund|balance)|not enough.*(fund|balance)/i.test(message)) return "Your wallet may not have enough USDC or SOL for this trade and its network fee.";
  if (/QUOTE_EXPIRED|expired/i.test(message)) return "The Panta quote expired. Request a fresh quote before continuing.";
  if (/QUOTE_STALE/i.test(message)) return "The market changed after this quote. Request a fresh Panta quote before continuing.";
  if (/MARKET_NOT_IN_PRIMARY|MARKET_NOT_FOUND|market.*closed|not active/i.test(message)) return "Panta can’t prepare a primary buy for this market right now. It may be closed or unavailable.";
  if (/AMOUNT_TOO_SMALL/i.test(message)) return "This amount is below Panta’s minimum for the market. Increase the amount or choose another market.";
  if (/UNAUTHORIZED|RATE_LIMITED/i.test(message)) return /RATE_LIMITED/.test(message) ? "Panta is receiving too many requests right now. Wait briefly, then request a fresh quote." : "Panta did not authorize this request. Check the configured key and account permissions.";
  if (/simulation|preflight/i.test(message)) return "Solana could not simulate this transaction successfully. Nothing was broadcast.";
  return message;
};

export function TradeTicket(props: {
  market: Market;
  initialOutcome: "YES" | "NO";
  initialAmount?: number;
  autoPrepare?: boolean;
  wallet: SolanaWallet | null;
  onWallet: (wallet: SolanaWallet | null) => void;
  onClose: () => void;
  onComplete: () => void;
}) {
  if (props.market.phase === "secondary") return <SecondaryTradeTicket {...props} />;
  return <PrimaryTradeTicket {...props} />;
}

function PrimaryTradeTicket({ market, initialOutcome, initialAmount, autoPrepare = false, wallet, onWallet, onClose, onComplete }: {
  market: Market;
  initialOutcome: "YES" | "NO";
  initialAmount?: number;
  autoPrepare?: boolean;
  wallet: SolanaWallet | null;
  onWallet: (wallet: SolanaWallet | null) => void;
  onClose: () => void;
  onComplete: () => void;
}) {
  const [outcome, setOutcome] = useState<"YES" | "NO">(initialOutcome);
  const [amount, setAmount] = useState(initialAmount === undefined ? "25" : String(initialAmount));
  const [stage, setStage] = useState<Stage>("edit");
  const [quote, setQuote] = useState<TradeQuote | null>(null);
  const [prepared, setPrepared] = useState<PantaTradeBuild | null>(null);
  const [signature, setSignature] = useState("");
  const [error, setError] = useState("");
  const [pantaStatus, setPantaStatus] = useState("");
  const autoStarted = useRef(false);
  const amountNumber = Number(amount);
  const environment = quote?.environment ?? "unknown";
  const sourceLabel = quote?.source === "demo" ? "DEMO · NO LIVE QUOTE" : environment === "test" ? "PANTA TEST" : environment === "live" ? null : quote ? "ENVIRONMENT UNVERIFIED" : null;
  const requiredCluster = environment === "live" ? "mainnet-beta" : environment === "test" ? "devnet" : "unsupported";
  const networkReady = Boolean(rpc) && cluster === requiredCluster;
  const quoteExpired = isQuoteExpired(quote?.expiresAt ?? null);
  const buildExpired = isQuoteExpired(prepared?.expiresAt ?? null);

  const prepareTransaction = useCallback(async (currentQuote: TradeQuote) => {
    if (!wallet?.publicKey || currentQuote.source !== "panta" || !currentQuote.id) return;
    setStage("building"); setError(""); setPrepared(null);
    try {
      const response = await fetch("/api/trade/build", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quoteId: currentQuote.id, wallet: wallet.publicKey.toBase58() }) });
      const payload = await response.json() as { data?: PantaTradeBuild; error?: string };
      if (!response.ok || !payload.data) throw new Error(payload.error ?? "Panta did not prepare a transaction.");
      if (payload.data.wallet !== wallet.publicKey.toBase58() || payload.data.marketId !== market.id || payload.data.quoteId !== currentQuote.id || payload.data.side.toUpperCase() !== currentQuote.outcome || Number(payload.data.amountUsdc) !== currentQuote.amountUsd) throw new Error("Panta’s prepared transaction did not match the quote on screen. Nothing was signed.");
      setPrepared(payload.data);
      setStage("prepared");
    } catch (cause) { setError(shortError(cause)); setStage("failed"); }
  }, [market.id, wallet]);

  const requestQuote = useCallback(async () => {
    if (!wallet?.publicKey) { setError("Connect a Solana wallet before requesting a quote. No trade has been prepared."); setStage("failed"); return; }
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) { setError("Enter a positive USDC amount."); setStage("failed"); return; }
    setQuote(null); setPrepared(null); setError(""); setStage("quoting");
    try {
      const response = await fetch("/api/trade/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ marketId: market.id, outcome, amountUsd: amountNumber, wallet: wallet.publicKey.toBase58() }) });
      const payload = await response.json() as { data?: TradeQuote; error?: string };
      if (!response.ok || !payload.data) throw new Error(payload.error ?? "Panta did not return a quote.");
      const newQuote = payload.data;
      if (newQuote.marketId !== market.id || newQuote.outcome !== outcome || newQuote.amountUsd !== amountNumber) throw new Error("Panta returned a quote for different trade details. No transaction was prepared.");
      setQuote(newQuote);
      if (newQuote.source === "panta") await prepareTransaction(newQuote);
      else setStage("failed");
    } catch (cause) { setError(shortError(cause)); setStage("failed"); }
  }, [amountNumber, market.id, outcome, prepareTransaction, wallet]);

  useEffect(() => {
    if (!autoPrepare || !wallet?.publicKey || autoStarted.current) return;
    autoStarted.current = true;
    void requestQuote();
  }, [autoPrepare, requestQuote, wallet]);

  async function confirmWithWallet(explicitConfirmAction: boolean) {
    if (!canOpenWalletSigning({ status: stage === "prepared" ? "awaiting-confirmation" : "preparing", source: quote?.source ?? "demo", explicitConfirmAction }) || !prepared || !quote || !wallet?.publicKey) return;
    if (quoteExpired || buildExpired) { setError("This quote or prepared transaction has expired. Request a new Panta quote before confirming."); setStage("failed"); return; }
    if (!networkReady) { setError(`Signing is disabled: configure the required network RPC before signing.`); return; }
    if (prepared.instructions.length === 0 || !prepared.recentBlockhash || !prepared.orderId) { setError("Panta’s build is missing instructions, order reference, or blockhash. Nothing was signed."); return; }
    setStage("signing"); setError("");
    let broadcastSignature = "";
    let broadcastAttempted = false;
    try {
      const instructions = prepared.instructions.map((instruction) => new TransactionInstruction({
        programId: new PublicKey(instruction.programId),
        data: Buffer.from(instruction.data, "base64"),
        keys: instruction.accounts.map((account) => ({ pubkey: new PublicKey(account.pubkey), isSigner: account.isSigner, isWritable: account.isWritable })),
      }));
      const transaction = new VersionedTransaction(new TransactionMessage({ payerKey: new PublicKey(wallet.publicKey.toBase58()), recentBlockhash: prepared.recentBlockhash, instructions }).compileToV0Message());
      const signed = await wallet.signTransaction(transaction);
      setStage("broadcasting");
      const connection = new Connection(rpc, "confirmed");
      broadcastAttempted = true;
      broadcastSignature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 });
      setSignature(broadcastSignature);
      const confirmation = prepared.lastValidBlockHeight === null
        ? connection.confirmTransaction(broadcastSignature, "confirmed")
        : connection.confirmTransaction({ signature: broadcastSignature, blockhash: prepared.recentBlockhash, lastValidBlockHeight: prepared.lastValidBlockHeight }, "confirmed");
      await confirmation;
      const submit = await fetch("/api/trade/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: prepared.orderId, signature: broadcastSignature, wallet: wallet.publicKey.toBase58() }) });
      if (!submit.ok) throw new Error("The transaction was broadcast, but Panta did not register it. Check the transaction before retrying.");
      setStage("verifying");
      const deadline = Date.now() + 30_000;
      let status = "submitted";
      while (Date.now() < deadline) {
        const verify = await fetch("/api/trade/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: prepared.orderId, signature: broadcastSignature, wallet: wallet.publicKey.toBase58() }) });
        const payload = await verify.json() as { status?: string; error?: string };
        if (!verify.ok) throw new Error(payload.error ?? "Panta verification is temporarily unavailable.");
        status = payload.status ?? "unknown";
        setPantaStatus(status);
        if (status === "confirmed") { setStage("complete"); onComplete(); return; }
        if (status === "failed" || status === "expired") throw new Error(status === "expired" ? "Panta reports that this order expired before confirmation." : "Panta reports that the transaction failed. No position was confirmed.");
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      setStage("broadcast-unknown");
      setError("Your transaction was broadcast and is awaiting Panta confirmation. Do not submit it again; check the signature below.");
    } catch (cause) {
      if (broadcastSignature || (broadcastAttempted && !/simulation|preflight/i.test(cause instanceof Error ? cause.message : ""))) {
        setStage("broadcast-unknown");
        setError(broadcastSignature ? "The transaction was broadcast, but confirmation could not be verified. Check the signature below before taking any further action." : "The wallet approved a transaction and broadcast status is uncertain. Do not retry; check your wallet and recent activity before taking further action.");
      } else {
        setError(shortError(cause)); setStage("failed");
      }
    }
  }

  const canConfirm = stage === "prepared" && Boolean(prepared && quote?.source === "panta" && prepared.instructions.length && wallet?.publicKey && networkReady && !quoteExpired && !buildExpired);
  const explorerHref = signature ? `https://explorer.solana.com/tx/${signature}${cluster === "mainnet-beta" ? "" : `?cluster=${encodeURIComponent(cluster)}`}` : null;
  const busy = ["quoting", "building", "signing", "broadcasting", "verifying"].includes(stage);
  return <div className="ticket-scrim" role="presentation" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onClose(); }}>
    <motion.section className="trade-ticket" role="dialog" aria-modal="true" aria-labelledby="ticket-title" initial={{ opacity: 0, y: 12, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: .985 }} transition={{ duration: .2 }}>
      <header className="trade-ticket__header"><div className="trade-ticket__mira"><span className="trade-ticket__mira-art"><MiraCharacter state={stage === "complete" ? "trade-success" : stage === "failed" ? "error" : "trade-ready"} compact /></span><span className="trade-ticket__heading"><span className="trade-ticket__badges"><span className="panel-kicker">MIRA</span>{sourceLabel && <span className={quote?.environment === "unknown" ? "trade-ticket__status trade-ticket__status--warning" : "trade-ticket__status"}>{sourceLabel}</span>}</span><h2 id="ticket-title">{stage === "complete" ? "Trade confirmed" : stage === "broadcast-unknown" ? "Confirmation pending" : busy ? "Checking this before you commit" : stage === "prepared" ? "Trade ready — waiting for you" : "Panta"}</h2></span></div><button className="icon-button" aria-label="Close trade preparation" disabled={busy} onClick={onClose}><X size={18} /></button></header>
      <div className="ticket-market"><span>{market.category ?? "Market"} · Market status: {market.status === "unknown" ? "Unavailable" : market.status}</span><b>{market.question}</b></div>
      <div className="ticket-sides"><button aria-pressed={outcome === "YES"} className={outcome === "YES" ? "ticket-side ticket-side--yes is-selected" : "ticket-side ticket-side--yes"} onClick={() => { setOutcome("YES"); setQuote(null); setPrepared(null); setStage("edit"); }} disabled={busy}><span>BUY YES</span><b>{market.yesProbability === null ? "Unavailable" : `${Math.round(market.yesProbability * 100)}¢`}</b></button><button aria-pressed={outcome === "NO"} className={outcome === "NO" ? "ticket-side ticket-side--no is-selected" : "ticket-side ticket-side--no"} onClick={() => { setOutcome("NO"); setQuote(null); setPrepared(null); setStage("edit"); }} disabled={busy}><span>BUY NO</span><b>{market.noProbability === null ? "Unavailable" : `${Math.round(market.noProbability * 100)}¢`}</b></button></div>
      <label className="ticket-amount-label" htmlFor="ticket-amount">Spend <span>USDC</span></label><div className="ticket-amount"><span>$</span><input id="ticket-amount" type="number" min="0.01" step="0.01" value={amount} onChange={(event) => { setAmount(event.target.value); setQuote(null); setPrepared(null); setStage("edit"); }} disabled={busy || stage === "complete" || stage === "broadcast-unknown"} /></div>
      {!wallet && <div className="ticket-wallet-note"><WalletCardsIcon /> Connect the wallet that should make this purchase. Panta requires its public address for a quote.<WalletButton onWallet={onWallet} currentWallet={wallet} /></div>}
      {stage === "prepared" && quote && prepared && <section className="ticket-quote" aria-label="Pending Panta trade confirmation"><div className="ticket-quote__top"><span>{sourceLabel}</span><span>{quote.expiresAt ? `Quote expires ${new Date(quote.expiresAt).toLocaleString()}` : "Quote expiry unavailable"}</span></div><dl className="ticket-quote__metrics"><div><dt>Order type</dt><dd>Primary market buy</dd></div><div><dt>Side</dt><dd>{quote.outcome}</dd></div><div><dt>Amount</dt><dd>{money(quote.amountUsd)} USDC</dd></div><div><dt>Estimated shares</dt><dd>{prepared.expectedShares ?? (quote.shares === null ? "Unavailable" : quote.shares.toLocaleString(undefined, { maximumFractionDigits: 4 }))}</dd></div><div><dt>Average price</dt><dd>{quote.averagePrice === null ? "Unavailable" : `${(quote.averagePrice * 100).toFixed(2)}¢`}</dd></div><div><dt>Panta fee</dt><dd>{prepared.feeUsdc !== null ? `${prepared.feeUsdc} USDC` : quote.feeUsd === null ? "Unavailable" : `${money(quote.feeUsd)} USDC`}</dd></div><div><dt>Network fee</dt><dd>Unavailable · wallet estimate</dd></div><div><dt>Slippage cap</dt><dd>1.00% (100 bps)</dd></div><div><dt>Wallet</dt><dd>{wallet?.publicKey ? `${wallet.publicKey.toBase58().slice(0, 6)}…${wallet.publicKey.toBase58().slice(-5)}` : "Unavailable"}</dd></div></dl><p className="ticket-confirm-copy">Review the exact market, side, amount, quote and wallet. MIRA will open the wallet signing prompt only after you press <b>Confirm trade</b>.</p>{!networkReady && <p className="demo-quote-warning"><AlertTriangle size={14} /> Signing is disabled: configure a {requiredCluster} RPC for this Panta {environment} key. Current cluster is {cluster}.</p>}</section>}
      {quote?.source === "demo" && <div className="demo-quote-warning"><AlertTriangle size={14} /> Demo mode does not provide a real Panta quote. Price, shares and fees are unavailable; trading is disabled.</div>}
      {busy && <div className="ticket-detail-note" role="status"><LoaderCircle className="spin" size={15} /> {stage === "quoting" ? "Requesting a live Panta quote…" : stage === "building" ? "Preparing unsigned transaction instructions…" : stage === "signing" ? "Waiting for your wallet approval…" : stage === "broadcasting" ? "Broadcasting the wallet-approved transaction…" : "Checking Solana and Panta confirmation…"}</div>}
      {stage === "complete" && <div className="ticket-complete"><CheckCircle2 size={18} /><div><b>YES/NO position purchased successfully · Panta confirmed</b><span>{quote ? `${quote.outcome} · ${money(quote.amountUsd)} USDC · ${prepared?.expectedShares ?? quote.shares ?? "Unavailable"} shares` : "Panta confirmed this trade."}</span>{explorerHref && <a href={explorerHref} target="_blank" rel="noreferrer">View confirmed transaction ↗</a>}</div></div>}
      {stage === "broadcast-unknown" && signature && <div className="ticket-complete"><AlertTriangle size={18} /><div><b>Panta confirmation has not arrived</b><span>Signature: {signature}</span>{explorerHref && <a href={explorerHref} target="_blank" rel="noreferrer">Check transaction status ↗</a>}</div></div>}
      {pantaStatus && stage !== "complete" && <p className="ticket-footnote">Panta status: {pantaStatus}</p>}
      {error && <div className="ticket-error" role="alert"><AlertTriangle size={15} />{error}</div>}
      <div className="ticket-actions">
        {stage === "edit" || stage === "failed" ? <><button className="secondary-action" onClick={onClose}>Cancel</button><button className="primary-action" disabled={!wallet || !Number.isFinite(amountNumber) || amountNumber <= 0} onClick={() => void requestQuote()}>{stage === "failed" ? "Request a fresh quote" : "Get Panta quote"} <ArrowRight size={15} /></button></> : null}
        {stage === "prepared" && <><button className="secondary-action" onClick={onClose}>Cancel trade</button>{quoteExpired || buildExpired ? <button className="primary-action" onClick={() => void requestQuote()}>Refresh expired quote <ArrowRight size={15} /></button> : <button className="primary-action" disabled={!canConfirm} onClick={() => void confirmWithWallet(true)}><ShieldCheck size={15} /> Confirm trade</button>}</>}
        {stage === "complete" && <button className="primary-action" onClick={onClose}>Done <CheckCircle2 size={15} /></button>}
        {stage === "broadcast-unknown" && <button className="secondary-action" onClick={onClose}>Close · don’t retry</button>}
      </div>
      <p className="ticket-footnote"><ShieldCheck size={13} /> Awaiting your explicit confirmation. MIRA cannot sign or send before you choose Confirm trade.</p>
    </motion.section>
  </div>;
}

function SecondaryTradeTicket({ market, initialOutcome, wallet, onWallet, onClose, onComplete }: {
  market: Market; initialOutcome: "YES" | "NO"; initialAmount?: number; autoPrepare?: boolean;
  wallet: SolanaWallet | null; onWallet: (wallet: SolanaWallet | null) => void; onClose: () => void; onComplete: () => void;
}) {
  const [side, setSide] = useState<"YES" | "NO">(initialOutcome);
  const [price, setPrice] = useState("0.50");
  const [shares, setShares] = useState("1");
  const [buy, setBuy] = useState(true);
  const [targetOrder, setTargetOrder] = useState("");
  const [operationType, setOperationType] = useState<"placement" | "cancellation">("placement");
  const [build, setBuild] = useState<{ operationId: string; marketId: string; wallet: string; instructions: PantaTradeBuild["instructions"]; recentBlockhash: string; lastValidBlockHeight: number; expiresAt: string } | null>(null);
  const [stage, setStage] = useState<"edit" | "building" | "prepared" | "signing" | "broadcasting" | "confirming" | "reconciling" | "complete" | "unknown" | "failed">("edit");
  const [signature, setSignature] = useState("");
  const [status, setStatus] = useState("");
  const [notificationStatus, setNotificationStatus] = useState("");
  const [error, setError] = useState("");
  const busy = ["building", "signing", "broadcasting", "confirming", "reconciling"].includes(stage);
  const endpoint = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "";
  const walletAddress = wallet?.publicKey?.toBase58() ?? "";
  const recoveryKey = walletAddress ? `mira-secondary:${market.id}:${walletAddress}` : "";

  useEffect(() => {
    if (!recoveryKey) return;
    let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const raw = localStorage.getItem(recoveryKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as { build?: typeof build; signature?: string };
      if (!saved.build || saved.build.marketId !== market.id || saved.build.wallet !== walletAddress) return;
      recoveryTimer = setTimeout(() => {
        setBuild(saved.build!); setSignature(saved.signature ?? ""); setStage(saved.signature ? "unknown" : "prepared");
        setError(saved.signature ? "Recovered the existing operation. Verify this same signature; do not create a replacement." : "Recovered an unsigned build. It can be used only until its stored expiry.");
      }, 0);
    } catch { /* Malformed browser recovery data is ignored; server build records remain authoritative. */ }
    return () => { if (recoveryTimer) clearTimeout(recoveryTimer); };
  }, [market.id, recoveryKey, walletAddress]);

  useEffect(() => {
    if (!recoveryKey) return;
    try {
      if (build) localStorage.setItem(recoveryKey, JSON.stringify({ build, signature }));
    } catch { /* Browser storage is optional; persisted server operations remain available for same-page retries. */ }
  }, [build, recoveryKey, signature]);

  async function prepare() {
    if (!wallet?.publicKey) { setError("Connect a Solana wallet first."); setStage("failed"); return; }
    setStage("building"); setError(""); setBuild(null);
    if (recoveryKey) try { localStorage.removeItem(recoveryKey); } catch { /* optional */ }
    try {
      const response = await fetch("/api/trade/secondary/build", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operationType, marketId: market.id, wallet: wallet.publicKey.toBase58(), side, price, shares, buy, targetOrder }) });
      const payload = await response.json() as { data?: { operationId: string; marketId: string; wallet: string; instructions: PantaTradeBuild["instructions"]; recentBlockhash: string; lastValidBlockHeight: number; expiresAt: string }; error?: string };
      if (!response.ok || !payload.data) throw new Error(payload.error ?? "Secondary build was rejected.");
      setBuild(payload.data); setStage("prepared");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Secondary build failed."); setStage("failed"); }
  }

  async function signAndSubmit() {
    if (!build || !wallet?.publicKey) return;
    if (Date.now() >= Date.parse(build.expiresAt)) { setError("Build expired. Prepare a fresh transaction."); setStage("failed"); return; }
    if (!endpoint || (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet") !== "mainnet-beta") { setError("Configure the mainnet-beta wallet RPC before signing."); return; }
    setStage("signing"); setError("");
    let sent = "";
    try {
      const instructions = build.instructions.map((item) => new TransactionInstruction({ programId: new PublicKey(item.programId), data: Buffer.from(item.data, "base64"), keys: item.accounts.map((account) => ({ pubkey: new PublicKey(account.pubkey), isSigner: account.isSigner, isWritable: account.isWritable })) }));
      const transaction = new VersionedTransaction(new TransactionMessage({ payerKey: new PublicKey(wallet.publicKey.toBase58()), recentBlockhash: build.recentBlockhash, instructions }).compileToV0Message());
      const signed = await wallet.signTransaction(transaction);
      setStage("broadcasting"); const connection = new Connection(endpoint, "confirmed");
      sent = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 }); setSignature(sent);
      // Persist the submitted signature as soon as the configured mainnet RPC sees it.
      // A 202 response means propagation is still pending; final verification remains separate.
      await fetch("/api/trade/secondary/started", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operationId: build.operationId, signature: sent, wallet: wallet.publicKey.toBase58() }) });
      setStage("confirming"); const confirmation = await connection.confirmTransaction({ signature: sent, blockhash: build.recentBlockhash, lastValidBlockHeight: build.lastValidBlockHeight }, "confirmed");
      if (confirmation.value.err) throw new Error("Solana confirmed the transaction as failed.");
      const submit = await fetch("/api/trade/secondary/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operationId: build.operationId, signature: sent, wallet: wallet.publicKey.toBase58() }) });
      const submitted = await submit.json() as { status?: string; error?: string };
      if (!submit.ok) throw new Error(submitted.error ?? "Execution persistence is pending; retry with the same signature.");
      setNotificationStatus((submitted as { notificationStatus?: string }).notificationStatus ?? "pending");
      if (submitted.status === "failed") throw new Error("The on-chain transaction failed.");
      setStage("reconciling");
      const verify = await fetch("/api/trade/secondary/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operationId: build.operationId, signature: sent, wallet: wallet.publicKey.toBase58() }) });
      const verified = await verify.json() as { reconciliationStatus?: string; error?: string };
      setStatus(verified.reconciliationStatus ?? "pending");
      if (verified.reconciliationStatus === "reconciled") { setStage("complete"); try { localStorage.removeItem(recoveryKey); } catch { /* optional */ } onComplete(); }
      else { setStage("unknown"); setError(verified.error ?? "Execution is confirmed; order-state reconciliation remains pending. Do not create a replacement order."); }
    } catch (cause) {
      if (sent) { setStage("unknown"); setError(`Transaction ${sent} may have executed. Retry verification with this same operation; do not build another order.`); }
      else { setStage("failed"); setError(cause instanceof Error ? cause.message : "Signing or broadcast failed."); }
    }
  }

  async function retrySameOperation() {
    if (!build || !signature || !wallet?.publicKey) return;
    setStage("confirming"); setError("");
    try {
      const response = await fetch("/api/trade/secondary/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operationId: build.operationId, signature, wallet: wallet.publicKey.toBase58() }) });
      const submitted = await response.json() as { status?: string; notificationStatus?: string; error?: string };
      if (!response.ok || submitted.status === "confirmation_pending") throw new Error(submitted.error ?? "The same signature is still awaiting confirmation.");
      setNotificationStatus(submitted.notificationStatus ?? "pending"); setStage("reconciling");
      const verify = await fetch("/api/trade/secondary/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operationId: build.operationId, signature, wallet: wallet.publicKey.toBase58() }) });
      const verified = await verify.json() as { reconciliationStatus?: string; error?: string };
      setStatus(verified.reconciliationStatus ?? "pending");
      if (verified.reconciliationStatus === "reconciled") { setStage("complete"); try { localStorage.removeItem(recoveryKey); } catch { /* optional */ } onComplete(); }
      else { setStage("unknown"); setError(verified.error ?? "Execution remains confirmed, but order state is not fully reconciled."); }
    } catch (cause) { setStage("unknown"); setError(cause instanceof Error ? cause.message : "Could not retry verification."); }
  }

  return <div className="ticket-scrim" role="presentation" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onClose(); }}>
    <motion.section className="trade-ticket" role="dialog" aria-modal="true" aria-labelledby="secondary-ticket-title" initial={{ opacity: 0, y: 12, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: .2 }}>
      <header className="trade-ticket__header"><div className="trade-ticket__heading"><div className="secondary-ticket__topline"><span className="panel-kicker">PANTA · SECONDARY</span><WalletButton onWallet={onWallet} currentWallet={wallet} /></div><h2 id="secondary-ticket-title">{stage === "complete" ? "Order reconciled" : "Secondary order"}</h2></div><button className="icon-button" disabled={busy} onClick={onClose} aria-label="Close secondary ticket"><X size={18} /></button></header>
      <div className="ticket-market"><span>{market.category ?? "Market"} · {market.status}</span><b>{market.question}</b></div>
      <div className="ticket-sides"><button className={side === "YES" ? "ticket-side ticket-side--yes is-selected" : "ticket-side ticket-side--yes"} aria-pressed={side === "YES"} onClick={() => setSide("YES")} disabled={busy}>YES</button><button className={side === "NO" ? "ticket-side ticket-side--no is-selected" : "ticket-side ticket-side--no"} aria-pressed={side === "NO"} onClick={() => setSide("NO")} disabled={busy}>NO</button></div>
      <label className="ticket-amount-label">Operation</label><select value={operationType} onChange={(event) => setOperationType(event.target.value as "placement" | "cancellation")} disabled={busy || Boolean(build)}><option value="placement">Place limit order</option><option value="cancellation">Cancel my order</option></select>
      {operationType === "placement" ? <><label className="ticket-amount-label">Direction</label><select value={buy ? "buy" : "sell"} onChange={(event) => setBuy(event.target.value === "buy")} disabled={busy || Boolean(build)}><option value="buy">Buy</option><option value="sell">Sell</option></select><label className="ticket-amount-label">Limit price · USDC/share</label><input value={price} onChange={(event) => setPrice(event.target.value)} disabled={busy || Boolean(build)} /><label className="ticket-amount-label">Shares</label><input value={shares} onChange={(event) => setShares(event.target.value)} disabled={busy || Boolean(build)} /></> : <><label className="ticket-amount-label">Exact order-node address</label><input value={targetOrder} onChange={(event) => setTargetOrder(event.target.value)} disabled={busy || Boolean(build)} /></>}
      {build && <section className="ticket-quote"><dl className="ticket-quote__metrics"><div><dt>Operation</dt><dd>{operationType}</dd></div><div><dt>Market</dt><dd>{market.id}</dd></div><div><dt>Wallet</dt><dd>{wallet?.publicKey?.toBase58()}</dd></div><div><dt>Build expiry</dt><dd>{new Date(build.expiresAt).toLocaleString()}</dd></div></dl><p className="ticket-confirm-copy">Review the instruction in your wallet. MIRA verifies the exact persisted message and confirms execution before reconciling the order.</p></section>}
      {busy && <div className="ticket-detail-note" role="status"><LoaderCircle className="spin" size={15} /> {stage === "building" ? "Validating market and order-book accounts…" : stage === "signing" ? "Waiting for wallet approval…" : stage === "broadcasting" ? "Broadcasting transaction…" : stage === "confirming" ? "Confirming transaction on mainnet…" : "Reconciling order state…"}</div>}
      {status && <p className="ticket-footnote">Order reconciliation: {status}</p>}{notificationStatus && <p className="ticket-footnote">Panta notification: {notificationStatus}</p>}{signature && <p className="ticket-footnote">Signature: {signature}</p>}{error && <div className="ticket-error" role="alert"><AlertTriangle size={15} />{error}</div>}
      <div className="ticket-actions">{!build && <><button className="secondary-action" onClick={onClose}>Cancel</button><button className="primary-action" disabled={!wallet || busy} onClick={() => void prepare()}>Prepare transaction <ArrowRight size={15} /></button></>}{stage === "prepared" && <><button className="secondary-action" onClick={() => { if (recoveryKey) try { localStorage.removeItem(recoveryKey); } catch { /* optional */ } setBuild(null); setStage("edit"); }}>Back</button><button className="primary-action" onClick={() => void signAndSubmit()}><ShieldCheck size={15} /> Confirm and sign</button></>}{stage === "complete" && <button className="primary-action" onClick={onClose}>Done</button>}{stage === "unknown" && <><button className="primary-action" onClick={() => void retrySameOperation()}>Retry same signature</button><button className="secondary-action" onClick={onClose}>Close · keep same operation</button></>}</div>
      <p className="ticket-footnote"><ShieldCheck size={13} /> MIRA never signs or broadcasts before your explicit wallet approval.</p>
    </motion.section>
  </div>;
}

function WalletCardsIcon() { return <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="2.5" y="4.5" width="15" height="12" rx="2" stroke="currentColor" strokeWidth="1.4"/><path d="M2.5 7h15M13.4 11.5h2.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>; }
