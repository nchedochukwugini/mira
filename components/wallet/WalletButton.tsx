"use client";

import { useState } from "react";
import { Check, ChevronDown, Copy, LogOut, Wallet } from "lucide-react";
import type { SolanaWallet } from "@/lib/wallet/types";

export function WalletButton({ onWallet, currentWallet }: { onWallet: (wallet: SolanaWallet | null) => void; currentWallet?: SolanaWallet | null }) {
  const [wallet, setWallet] = useState<SolanaWallet | null>(null);
  const [address, setAddress] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const activeWallet = currentWallet === undefined ? wallet : currentWallet;
  const activeAddress = currentWallet === undefined ? address : currentWallet?.publicKey?.toBase58() ?? "";

  async function connect() {
    const provider = window.solana;
    if (!provider?.isPhantom) {
      window.open("https://phantom.app/", "_blank", "noopener,noreferrer");
      return;
    }
    try {
      const response = await provider.connect();
      setWallet(provider);
      setAddress(response.publicKey.toBase58());
      onWallet(provider);
    } catch { /* The wallet owns its own connection error UI. */ }
  }

  async function disconnect() {
    await activeWallet?.disconnect();
    setWallet(null);
    setAddress("");
    setMenuOpen(false);
    onWallet(null);
  }

  async function copyAddress() {
    await navigator.clipboard.writeText(activeAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return activeWallet && activeAddress ? <div className="wallet-menu-wrap">
    <button className="wallet-connected" onClick={() => setMenuOpen((value) => !value)} aria-expanded={menuOpen}><span className="wallet-connected__dot" />{activeAddress.slice(0, 4)}…{activeAddress.slice(-4)}<ChevronDown size={14} /></button>
    {menuOpen && <div className="wallet-popover"><span className="wallet-popover__label">SOLANA WALLET</span><b>{activeAddress.slice(0, 8)}…{activeAddress.slice(-7)}</b><button onClick={copyAddress}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Copied" : "Copy address"}</button><button onClick={disconnect}><LogOut size={14} />Disconnect</button></div>}
  </div> : <button className="wallet-connect" onClick={connect}><Wallet size={15} /> Connect wallet</button>;
}
