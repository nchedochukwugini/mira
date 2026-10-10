"use client";

import { Check, ChevronDown, Copy, Hash } from "lucide-react";
import { useState } from "react";

export function MarketIdControl({ marketId }: { marketId: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copyId() {
    try {
      await navigator.clipboard.writeText(marketId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      const field = document.createElement("textarea");
      field.value = marketId;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      const ok = document.execCommand("copy");
      field.remove();
      setCopied(ok);
      if (ok) window.setTimeout(() => setCopied(false), 1400);
    }
  }

  return <span className="market-id-control">
    <button type="button" className="market-id-control__toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <Hash size={12} /> Market ID <ChevronDown size={12} className={open ? "market-id-control__chevron is-open" : "market-id-control__chevron"} />
    </button>
    {open && <span className="market-id-control__value">
      <code title={marketId}>{marketId}</code>
      <button type="button" className="market-id-control__copy" onClick={() => void copyId()} aria-label="Copy market ID" title="Copy market ID">
        {copied ? <Check size={13} /> : <Copy size={13} />}{copied ? "Copied" : "Copy"}
      </button>
    </span>}
  </span>;
}
