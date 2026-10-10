import type { MarketPoint } from "@/lib/panta/types";

export function MiniChart({ points, label, className = "" }: { points: MarketPoint[]; label: string; className?: string }) {
  const observations = points.flatMap((point) => {
    const value = point.yesProbability;
    const timestamp = Date.parse(point.timestamp);
    return value !== null && Number.isFinite(value) && value >= 0 && value <= 1 && Number.isFinite(timestamp)
      ? [{ timestamp, value }]
      : [];
  }).sort((left, right) => left.timestamp - right.timestamp);

  if (!observations.length) return <div className={`chart-empty ${className}`}>Price history unavailable</div>;

  const min = Math.max(0, Math.min(...observations.map(({ value }) => value)) - 0.035);
  const max = Math.min(1, Math.max(...observations.map(({ value }) => value)) + 0.035);
  const range = Math.max(0.01, max - min);
  const start = observations[0]!.timestamp;
  const duration = Math.max(1, observations.at(-1)!.timestamp - start);
  const last = observations.at(-1)!;
  const plotted = observations.map((point) => ({
    ...point,
    x: observations.length === 1 ? 50 : ((point.timestamp - start) / duration) * 96 + 2,
    y: 26 - ((point.value - min) / range) * 20,
  }));
  const observedAt = new Date(last.timestamp).toLocaleString();

  return <div className={`market-history ${className}`}>
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="mini-chart" role="img" aria-label={`${label}: ${observations.length} actual YES price observations; latest ${(last.value * 100).toFixed(1)} percent at ${observedAt}`}>
      <line x1="0" y1="29" x2="100" y2="29" stroke="#dce4d2" strokeWidth=".6" />
      {plotted.map((point, index) => <circle key={`${point.timestamp}-${index}`} cx={point.x} cy={point.y} r={observations.length === 1 ? 2 : 1.35} fill="#527a51">
        <title>{`${(point.value * 100).toFixed(1)}% · ${new Date(point.timestamp).toLocaleString()}`}</title>
      </circle>)}
      <circle cx={last ? plotted.at(-1)!.x : 50} cy={plotted.at(-1)!.y} r="2.35" fill="#fffef8" stroke="#3f6545" strokeWidth="1.1" />
    </svg>
    <span className="market-history__caption">{observations.length} provider {observations.length === 1 ? "observation" : "observations"} · latest {observedAt}</span>
  </div>;
}
