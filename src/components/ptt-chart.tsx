"use client";

import type { PotentialHistoryPoint } from "@/lib/types";

export function PttChart({ points }: { points: PotentialHistoryPoint[] }) {
  const width = 820;
  const height = 236;
  const padding = { top: 20, right: 24, bottom: 20, left: 48 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const values = points.map((point) => point.potential);
  const max = values.length ? Math.max(...values) : 13;
  const min = values.length ? Math.min(...values) : 12;
  const range = Math.max(max - min, 0.2);
  const domainMin = Math.floor((min - range * 0.15) * 10) / 10;
  const domainMax = Math.ceil((max + range * 0.15) * 10) / 10;
  const domainRange = Math.max(domainMax - domainMin, 0.2);
  const pointsForPlot = points.map((point, index) => {
    const x = points.length === 1 ? padding.left + plotWidth / 2 : padding.left + (index / (points.length - 1)) * plotWidth;
    const y = padding.top + ((domainMax - point.potential) / domainRange) * plotHeight;
    return { ...point, x, y };
  });
  const polyline = pointsForPlot.map((point) => `${point.x},${point.y}`).join(" ");
  const area = pointsForPlot.length
    ? `${pointsForPlot[0].x},${padding.top + plotHeight} ${polyline} ${pointsForPlot.at(-1)!.x},${padding.top + plotHeight}`
    : "";

  return (
    <div className="ptt-chart" aria-label="每日潜力值折线图">
      <svg viewBox={`0 0 ${width} ${height}`} role="img">
        <defs>
          <linearGradient id="pttArea" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#6354b8" stopOpacity="0.2" />
            <stop offset="1" stopColor="#6354b8" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((line) => {
          const y = padding.top + (line / 3) * plotHeight;
          const value = domainMax - (line / 3) * domainRange;
          return (
            <g key={line}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} className="chart-grid" />
              <text x={padding.left - 10} y={y + 4} textAnchor="end" className="chart-axis-label">
                {value.toFixed(2)}
              </text>
            </g>
          );
        })}
        {area ? <polygon points={area} fill="url(#pttArea)" /> : null}
        {polyline ? <polyline points={polyline} className="chart-line" fill="none" /> : null}
        {pointsForPlot.map((point) => (
          <g key={`${point.date}-${point.snapshotId}`}>
            <circle cx={point.x} cy={point.y} r="4.5" className="chart-point" />
            <title>{`${point.date} · ${point.potential.toFixed(3)}`}</title>
          </g>
        ))}
      </svg>
      {!points.length ? <div className="chart-empty">每日 23:59:59 的快照会出现在这里</div> : null}
    </div>
  );
}
