"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import type { PotentialHistoryPoint } from "@/lib/types";

const height = 236;
const padding = { top: 20, right: 16, bottom: 20, left: 48 };

export function PttChart({ points }: { points: PotentialHistoryPoint[] }) {
  const id = useId();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(820);
  const [zoom, setZoom] = useState<[number, number] | null>(null);
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [selection, setSelection] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    start: number;
    end: number;
  } | null>(null);
  const orderedPoints = useMemo(
    () =>
      [...points]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((point) => ({
          ...point,
          time: Date.parse(`${point.date}T00:00:00+08:00`),
        })),
    [points],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(entry.contentRect.width, 160)));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const values = orderedPoints.map((point) => point.potential);
  const max = values.length ? Math.max(...values) : 13;
  const min = values.length ? Math.min(...values) : 12;
  const range = Math.max(max - min, 0.2);
  const domainMin = Math.floor((min - range * 0.15) * 10) / 10;
  const domainMax = Math.ceil((max + range * 0.15) * 10) / 10;
  const domainRange = Math.max(domainMax - domainMin, 0.2);
  const firstTime = orderedPoints[0]?.time ?? 0;
  const lastTime = orderedPoints.at(-1)?.time ?? firstTime;
  const fullRange = lastTime - firstTime;
  const windowStart = zoom ? Math.max(firstTime, zoom[0]) : firstTime;
  const windowEnd = zoom ? Math.min(lastTime, zoom[1]) : lastTime;
  const zoomed = windowEnd > windowStart && (windowStart > firstTime || windowEnd < lastTime);
  const start = zoomed ? windowStart : firstTime;
  const end = zoomed ? windowEnd : lastTime;
  const timeRange = end - start;
  const pointsForPlot = orderedPoints.map((point) => {
    const x =
      timeRange === 0
        ? padding.left + plotWidth / 2
        : padding.left + ((point.time - start) / timeRange) * plotWidth;
    const y = padding.top + ((domainMax - point.potential) / domainRange) * plotHeight;
    return { ...point, x, y };
  });
  const visiblePoints = pointsForPlot.filter((point) => point.time >= start && point.time <= end);
  const activePoint = visiblePoints.find((point) => point.date === activeDate);
  const polyline = pointsForPlot.map((point) => `${point.x},${point.y}`).join(" ");
  const area = pointsForPlot.length
    ? `${pointsForPlot[0].x},${padding.top + plotHeight} ${polyline} ${pointsForPlot.at(-1)!.x},${padding.top + plotHeight}`
    : "";
  const overviewX = (time: number) =>
    padding.left + (fullRange ? (time - firstTime) / fullRange : 0.5) * plotWidth;
  const overviewLine = pointsForPlot
    .map((point) => `${overviewX(point.time)},${8 + ((domainMax - point.potential) / domainRange) * 32}`)
    .join(" ");

  function pointerPosition(event: PointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(
        padding.left,
        Math.min(width - padding.right, ((event.clientX - bounds.left) * width) / bounds.width),
      ),
      y: ((event.clientY - bounds.top) * height) / bounds.height,
    };
  }

  function showNearest(x: number) {
    const nearest = visiblePoints.reduce<(typeof visiblePoints)[number] | undefined>(
      (best, point) => (!best || Math.abs(point.x - x) < Math.abs(best.x - x) ? point : best),
      undefined,
    );
    setActiveDate(nearest?.date ?? null);
  }

  function finishSelection(event: PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const selected = visiblePoints.filter(
      (point) => point.x >= Math.min(drag.start, drag.end) && point.x <= Math.max(drag.start, drag.end),
    );
    if (Math.abs(drag.end - drag.start) >= 12 && selected.length >= 2) {
      setZoom([selected[0].time, selected.at(-1)!.time]);
      setActiveDate(null);
    }
    dragRef.current = null;
    setSelection(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function zoomIn() {
    const count = Math.max(2, Math.ceil(visiblePoints.length / 2));
    const index = activePoint ? visiblePoints.indexOf(activePoint) : visiblePoints.length - 1;
    const first = Math.max(0, Math.min(index - Math.floor(count / 2), visiblePoints.length - count));
    setZoom([visiblePoints[first].time, visiblePoints[first + count - 1].time]);
  }

  function resetZoom() {
    setZoom(null);
    setActiveDate(null);
    dragRef.current = null;
    setSelection(null);
  }

  function handleKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      resetZoom();
      return;
    }
    if (!visiblePoints.length || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = activePoint ? visiblePoints.indexOf(activePoint) : visiblePoints.length - 1;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? visiblePoints.length - 1
          : Math.max(0, Math.min(visiblePoints.length - 1, current + (event.key === "ArrowLeft" ? -1 : 1)));
    setActiveDate(visiblePoints[next].date);
  }

  return (
    <div className="ptt-chart" aria-label="每日潜力值折线图">
      <div className="chart-canvas" ref={canvasRef}>
        <svg
          className="chart-main"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`潜力值走势，共 ${points.length} 个数据点`}
          aria-describedby={points.length ? `${id}-help` : undefined}
          tabIndex={points.length ? 0 : undefined}
          onFocus={() => setActiveDate((date) => date ?? visiblePoints.at(-1)?.date ?? null)}
          onBlur={(event) => {
            if (!event.currentTarget.closest(".ptt-chart")?.contains(event.relatedTarget))
              setActiveDate(null);
          }}
          onKeyDown={handleKeyDown}
          onPointerMove={(event) => {
            if (!event.isPrimary) return;
            const { x, y } = pointerPosition(event);
            const drag = dragRef.current;
            if (drag && drag.pointerId === event.pointerId) {
              drag.end = x;
              setSelection({ start: drag.start, end: x });
            } else if (y >= padding.top && y <= height - padding.bottom) {
              showNearest(x);
            } else {
              setActiveDate(null);
            }
          }}
          onPointerLeave={(event) => {
            if (
              !dragRef.current &&
              event.pointerType === "mouse" &&
              !event.currentTarget.matches(":focus-visible")
            )
              setActiveDate(null);
          }}
          onPointerDown={(event) => {
            if (!event.isPrimary || event.button !== 0 || !points.length) return;
            const { x, y } = pointerPosition(event);
            if (y < padding.top || y > height - padding.bottom) return;
            showNearest(x);
            dragRef.current = { pointerId: event.pointerId, start: x, end: x };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerUp={finishSelection}
          onPointerCancel={() => {
            dragRef.current = null;
            setSelection(null);
          }}
          onLostPointerCapture={() => {
            dragRef.current = null;
            setSelection(null);
          }}
        >
          <desc>每个点表示当天最高潜力值，保留全部数据与真实日期间距。</desc>
          <defs>
            <linearGradient id={`${id}-area`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#6354b8" stopOpacity="0.12" />
              <stop offset="1" stopColor="#6354b8" stopOpacity="0" />
            </linearGradient>
            <clipPath id={`${id}-plot`}>
              <rect
                x={padding.left - 5}
                y={padding.top - 5}
                width={plotWidth + 10}
                height={plotHeight + 10}
              />
            </clipPath>
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
          <g clipPath={`url(#${id}-plot)`} aria-hidden="true">
            {area ? <polygon points={area} fill={`url(#${id}-area)`} /> : null}
            {polyline ? (
              <polyline
                points={polyline}
                className="chart-line"
                fill="none"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            {pointsForPlot.map((point) => (
              <circle key={point.date} cx={point.x} cy={point.y} r="1.8" className="chart-point" />
            ))}
            {activePoint ? (
              <>
                <line
                  x1={activePoint.x}
                  x2={activePoint.x}
                  y1={padding.top}
                  y2={height - padding.bottom}
                  className="chart-crosshair"
                />
                <circle cx={activePoint.x} cy={activePoint.y} r="4.5" className="chart-active-point" />
              </>
            ) : null}
            {selection && Math.abs(selection.end - selection.start) >= 4 ? (
              <rect
                x={Math.min(selection.start, selection.end)}
                y={padding.top}
                width={Math.abs(selection.end - selection.start)}
                height={plotHeight}
                className="chart-selection"
              />
            ) : null}
          </g>
        </svg>
        {activePoint ? (
          <div
            className="chart-tooltip"
            role="status"
            style={{
              left: `clamp(70px, ${activePoint.x}px, calc(100% - 70px))`,
              top: activePoint.y > 88 ? activePoint.y - 76 : activePoint.y + 14,
            }}
          >
            <time dateTime={activePoint.date}>{activePoint.date}</time>
            <span>
              PTT <strong>{activePoint.potential.toFixed(3)}</strong>
            </span>
          </div>
        ) : null}
        {!points.length ? <div className="chart-empty">同步官网历史或获取 B50 后显示潜力值走势</div> : null}
      </div>
      {points.length ? (
        <div className="chart-controls">
          <span id={`${id}-help`} className="chart-help">
            共 {points.length} 个点 · 拖选放大
            <span className="sr-only">
              。悬停或点击查看日期与潜力值，左右方向键逐点查看，Home 和 End 跳至首尾，Escape 恢复完整范围。
            </span>
          </span>
          <div className="chart-zoom-buttons">
            <button type="button" disabled={visiblePoints.length <= 2} onClick={zoomIn}>
              放大
            </button>
            <button type="button" disabled={!zoomed} onClick={resetZoom}>
              查看全部
            </button>
          </div>
        </div>
      ) : null}
      {zoomed ? (
        <div className="chart-overview">
          <svg
            viewBox={`0 0 ${width} 48`}
            role="img"
            aria-label="完整潜力值走势，阴影为当前放大区间"
            aria-hidden="true"
          >
            <polyline points={overviewLine} className="chart-overview-line" fill="none" />
            {pointsForPlot.map((point) => (
              <circle
                key={point.date}
                cx={overviewX(point.time)}
                cy={8 + ((domainMax - point.potential) / domainRange) * 32}
                r="1.2"
                className="chart-point"
              />
            ))}
            <rect
              x={overviewX(start)}
              y="3"
              width={overviewX(end) - overviewX(start)}
              height="42"
              className="chart-selection"
            />
          </svg>
          <span>
            {visiblePoints[0]?.date} — {visiblePoints.at(-1)?.date}
            <span className="sr-only">，当前放大区间，完整走势保留全部 {points.length} 个数据点。</span>
          </span>
        </div>
      ) : null}
    </div>
  );
}
