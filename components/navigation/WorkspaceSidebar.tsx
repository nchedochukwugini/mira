"use client";

import { Bookmark, ChartNoAxesCombined, Clock3, Compass, Leaf, MessageSquarePlus, PanelLeftClose, PanelLeftOpen, Trash2, WalletCards, X } from "lucide-react";
import type { AnalysisHistoryItem } from "@/components/workspace/WorkspaceApp";

export type WorkspaceView = "analysis" | "markets" | "portfolio" | "watchlist";

const navItems: { id: WorkspaceView; label: string; icon: typeof Compass }[] = [
  { id: "markets", label: "Markets", icon: ChartNoAxesCombined },
  { id: "portfolio", label: "Portfolio", icon: WalletCards },
  { id: "watchlist", label: "Watchlist", icon: Bookmark },
];

export function WorkspaceSidebar({ view, setView, history, openHistory, deleteHistory, newAnalysis, mobileOpen, closeMobile, collapsed, setCollapsed }: {
  view: WorkspaceView;
  setView: (view: WorkspaceView) => void;
  history: AnalysisHistoryItem[];
  openHistory: (item: AnalysisHistoryItem) => void;
  deleteHistory: (item: AnalysisHistoryItem) => void;
  newAnalysis: () => void;
  mobileOpen: boolean;
  closeMobile: () => void;
  collapsed: boolean;
  setCollapsed: (value: boolean) => void;
}) {
  return <>
    {mobileOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={closeMobile} />}
    <aside className={`workspace-sidebar ${collapsed ? "workspace-sidebar--collapsed" : ""} ${mobileOpen ? "workspace-sidebar--mobile-open" : ""}`}>
      <div className="workspace-sidebar__top"><a className="workspace-brand" href="#home" onClick={(event) => { event.preventDefault(); newAnalysis(); }}><span className="brand-sign"><Leaf size={16} fill="currentColor" /></span><span>MIRA <small>MARKET INTELLIGENCE</small></span></a><button className="sidebar-mobile-close" onClick={closeMobile} aria-label="Close navigation"><X size={18} /></button><button className="sidebar-collapse" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>{collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}</button></div>
      <button className="new-analysis-button" onClick={() => { newAnalysis(); closeMobile(); }}><MessageSquarePlus size={16} /><span>New analysis</span><kbd>⌘ J</kbd></button>
      <nav className="workspace-nav" aria-label="Workspace"><span className="workspace-nav__label">YOUR SPACE</span>{navItems.map(({ id, label, icon: Icon }) => <button key={id} className={`workspace-nav__item ${view === id ? "is-active" : ""}`} onClick={() => { setView(id); closeMobile(); }}><Icon size={16} /><span>{label}</span></button>)}</nav>
      <section className="history-section"><div className="history-heading"><span className="workspace-nav__label">RECENT ANALYSES</span><Clock3 size={13} /></div>{history.length ? <div className="history-list">{history.slice(0, 8).map((item) => <div className="history-item" key={item.id}><button onClick={() => { openHistory(item); closeMobile(); }} title={item.query}><span className="history-item__dot" /><span>{item.query}</span></button><button className="history-delete" aria-label={`Delete ${item.query}`} title="Delete conversation" onClick={() => deleteHistory(item)}><Trash2 size={13} /></button></div>)}</div> : <p className="history-empty">Your questions will appear here.</p>}</section>
      <div className="sidebar-bottom"><div className="sidebar-note"><span>◌</span><p>Markets move. MIRA keeps the evidence in view.</p></div><span className="sidebar-version">MIRA WORKSPACE</span></div>
    </aside>
  </>;
}
