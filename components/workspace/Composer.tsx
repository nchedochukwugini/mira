"use client";

import { ArrowUp, Paperclip, Sparkles } from "lucide-react";
import { FormEvent, KeyboardEvent, useRef } from "react";
import { isComposerSendDisabled } from "@/lib/ui/composer-state";

export function Composer({ value, onChange, onSubmit, disabled, compact = false, inputRef }: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  compact?: boolean;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const internalRef = useRef<HTMLTextAreaElement>(null);
  function submit(event: FormEvent) { event.preventDefault(); onSubmit(); }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); onSubmit(); }
  }
  return <form className={`composer ${compact ? "composer--compact" : ""}`} onSubmit={submit}>
    <textarea ref={inputRef ?? internalRef} aria-label="Ask MIRA about prediction markets" value={value} onChange={(event) => { onChange(event.target.value); event.target.style.height = "auto"; event.target.style.height = `${Math.min(event.target.scrollHeight, 140)}px`; }} onKeyDown={onKeyDown} rows={compact ? 1 : 2} maxLength={500} placeholder="Ask about markets, probabilities, or what's moving…" disabled={disabled} />
    <div className="composer__bottom"><span><Sparkles size={13} /> MIRA compares market data, not outcomes</span><div><button className="composer-attach" type="button" title="Attachments are not available yet" disabled><Paperclip size={15} /></button><button className="composer-send" type="submit" disabled={isComposerSendDisabled(value, disabled)} aria-label="Send message"><ArrowUp size={18} /></button></div></div>
  </form>;
}
