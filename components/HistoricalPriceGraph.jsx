"use client";

import { memo, useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Info, TrendingDown, TrendingUp, Activity, LineChart } from "lucide-react";
import { cn, computeHistoryAnalytics, formatPrice } from "@/lib/utils";
import { EASE, DURATIONS } from "@/lib/motion";

const WINDOWS = [
  { days: 7, label: "7D" },
  { days: 30, label: "30D" },
  { days: 90, label: "90D" },
];

const METRIC_TILES = [
  { key: "current", label: "Current", tone: "default" },
  { key: "lowest", label: "Recorded Low", tone: "good" },
  { key: "highest", label: "Recorded High", tone: "default" },
  { key: "average", label: "Average", tone: "default" },
];

function HistoricalPriceGraph({
  priceHistory = [],
  sourceCurrency = "INR",
  displayCurrency = "INR",
  historySource = "CURATED_DEMO",
  cacheStatus = "BYPASS",
  isLive = false,
}) {
  const [windowDays, setWindowDays] = useState(30);
  const [hoveredIndex, setHoveredIndex] = useState(null);

  const analytics = useMemo(
    () =>
      computeHistoryAnalytics(
        priceHistory,
        sourceCurrency,
        displayCurrency,
        windowDays
      ),
    [priceHistory, sourceCurrency, displayCurrency, windowDays]
  );

  const chartGeometry = useMemo(() => {
    if (!analytics || analytics.points.length === 0) return null;

    const width = 440;
    const height = 100;
    const padX = 14;
    const padY = 14;
    const innerW = width - padX * 2;
    const innerH = height - padY * 2;

    const minVal = analytics.lowest;
    const maxVal = analytics.highest;
    const range = maxVal - minVal || Math.max(minVal * 0.08, 1);

    const coords = analytics.points.map((pt, index) => {
      const x =
        analytics.points.length === 1
          ? width / 2
          : padX + (index / (analytics.points.length - 1)) * innerW;
      const y =
        analytics.points.length === 1
          ? height / 2
          : padY + innerH - ((pt.value - minVal) / range) * innerH;
      return { ...pt, x, y };
    });

    const linePoints = coords
      .map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`)
      .join(" ");

    const areaPath =
      coords.length >= 2
        ? [
            `M ${coords[0].x.toFixed(1)} ${(height - padY + 4).toFixed(1)}`,
            ...coords.map((c) => `L ${c.x.toFixed(1)} ${c.y.toFixed(1)}`),
            `L ${coords[coords.length - 1].x.toFixed(1)} ${(height - padY + 4).toFixed(1)}`,
            "Z",
          ].join(" ")
        : "";

    return { width, height, padY, coords, linePoints, areaPath };
  }, [analytics]);

  const provenanceBadge = useMemo(() => {
    if (historySource === "LIVE_OBSERVED" || isLive) {
      return cacheStatus === "HIT"
        ? {
            label: "Cached Live Snapshot",
            tone: "border-[#DCE5C0] bg-[#F6F8EA] text-[#4A5527]",
          }
        : {
            label: "Live Observed Ledger",
            tone: "border-[#DCE5C0] bg-[#F6F8EA] text-[#4A5527]",
          };
    }
    return {
      label: "Curated Demo Baseline",
      tone: "border-[#E8E3D2] bg-[#FBF1DC] text-[#6B5D33]",
    };
  }, [historySource, isLive, cacheStatus]);

  if (!analytics || !chartGeometry) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: DURATIONS.slow, ease: EASE }}
        className="rounded-[18px] border border-[#EFEDE2]/90 bg-[linear-gradient(170deg,#FEFBF9_0%,#F2EFE6_100%)] p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-[#6B5D33]">
            <LineChart className="h-3.5 w-3.5" aria-hidden="true" />
            Price Intelligence
          </span>
          <span
            className={cn(
              "rounded-full border px-2.5 py-1 font-mono text-[8.5px] uppercase tracking-[0.12em]",
              provenanceBadge.tone
            )}
          >
            {provenanceBadge.label}
          </span>
        </div>
        <p className="mt-3 text-[11.5px] leading-relaxed text-[#75716B]">
          No historical price snapshots recorded yet for this live search.
          Future lookups record real observed price points — never synthesised
          history.
        </p>
      </motion.div>
    );
  }

  const activePoint =
    hoveredIndex !== null && chartGeometry.coords[hoveredIndex]
      ? chartGeometry.coords[hoveredIndex]
      : chartGeometry.coords[chartGeometry.coords.length - 1];

  const isSingleLivePoint = chartGeometry.coords.length === 1;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATIONS.slow, ease: EASE }}
      className="overflow-hidden rounded-[18px] border border-[#EFEDE2]/90 bg-[linear-gradient(180deg,#FEFBF9_0%,#F9F4EC_100%)] p-4 shadow-[0_18px_50px_-44px_rgba(26,24,21,0.55)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EAE7DC]/80 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-[#6B5D33]">
            <LineChart className="h-3.5 w-3.5" aria-hidden="true" />
            Price Intelligence
          </span>
          <span
            className={cn(
              "rounded-full border px-2.5 py-1 font-mono text-[8.5px] uppercase tracking-[0.12em]",
              provenanceBadge.tone
            )}
          >
            {provenanceBadge.label}
          </span>
        </div>

        <div
          role="group"
          aria-label="Price history window"
          className="inline-flex rounded-full border border-[#E4DFCF] bg-white p-[3px] shadow-[0_1px_0_rgba(26,24,21,0.03)]"
        >
          {WINDOWS.map((win) => {
            const active = windowDays === win.days;
            return (
              <button
                key={win.days}
                type="button"
                onClick={() => {
                  setWindowDays(win.days);
                  setHoveredIndex(null);
                }}
                aria-pressed={active}
                className={cn(
                  "relative rounded-full px-2.5 py-1 font-mono text-[10px] font-medium transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-[#141311]",
                  active ? "text-[#FFFFFF]" : "text-[#8B8780] hover:text-[#141311]"
                )}
              >
                {active && (
                  <motion.span
                    layoutId="price-history-window"
                    aria-hidden="true"
                    className="absolute inset-0 rounded-full bg-[#141311]"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  />
                )}
                <span className="relative z-10">{win.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Key Metrics Row */}
      <div className="mt-3.5 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {METRIC_TILES.map((tile) => (
          <div
            key={tile.key}
            className="rounded-lg border border-[#EFEDE2]/90 bg-white/90 px-2.5 py-2 transition-colors duration-200 hover:border-[#D5D2C2]/70"
          >
            <span className="block font-mono text-[8px] uppercase tracking-[0.14em] text-[#8B8780]">
              {tile.label}
            </span>
            <span
              className={cn(
                "mt-1 block font-mono text-[11.5px] font-semibold tabular-nums",
                tile.tone === "good" ? "text-[#4A5527]" : "text-[#141311]"
              )}
            >
              {formatPrice(analytics[tile.key], displayCurrency)}
            </span>
          </div>
        ))}
        <div className="col-span-2 rounded-lg border border-[#EFEDE2]/90 bg-white/90 px-2.5 py-2 transition-colors duration-200 hover:border-[#D5D2C2]/70 sm:col-span-1">
          <span className="block font-mono text-[8px] uppercase tracking-[0.14em] text-[#8B8780]">
            {windowDays}D Trend
          </span>
          <span
            className={cn(
              "mt-1 inline-flex items-center gap-1 font-mono text-[11.5px] font-semibold tabular-nums",
              analytics.movementPct <= 0 ? "text-[#4A5527]" : "text-[#141311]"
            )}
          >
            {analytics.movementPct < 0 ? (
              <TrendingDown className="h-3 w-3" aria-hidden="true" />
            ) : analytics.movementPct > 0 ? (
              <TrendingUp className="h-3 w-3" aria-hidden="true" />
            ) : (
              <Activity className="h-3 w-3" aria-hidden="true" />
            )}
            {analytics.movementPct > 0 ? "+" : ""}
            {analytics.movementPct}%
          </span>
        </div>
      </div>

      {/* Selected Observation Readout */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] text-[#75716B]">
        <span>
          Volatility:{" "}
          <strong className="font-medium text-[#75716B]">
            {analytics.volatilityLabel} ({analytics.spreadPct}% spread)
          </strong>
        </span>
        <span className="tabular-nums text-[#141311]">
          <span className="text-[#8B8780]">{activePoint.date}: </span>
          <strong>{formatPrice(activePoint.value, displayCurrency)}</strong>
        </span>
      </div>

      {/* Chart Canvas */}
      <div className="mt-2">
        {isSingleLivePoint ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-[#EFEDE2]/90 bg-white px-3.5 py-3 text-[11.5px] text-[#75716B]">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#141311]" aria-hidden="true" />
            <div>
              <p className="font-medium text-[#141311]">
                Initial live observation ({activePoint.date}):{" "}
                <span className="font-mono">
                  {formatPrice(activePoint.value, displayCurrency)}
                </span>
              </p>
              <p className="mt-0.5 text-[10.5px] leading-relaxed text-[#8B8780]">
                LuxeIndex never fabricates historical points. Additional
                observations plot automatically as this SKU is checked over time.
              </p>
            </div>
          </div>
        ) : (
          <>
            <svg
              viewBox={`0 0 ${chartGeometry.width} ${chartGeometry.height}`}
              className="h-24 w-full overflow-visible"
              role="img"
              aria-label={`${windowDays}-day price history chart`}
            >
              <defs>
                <linearGradient id="luxePriceArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3A3733" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#3A3733" stopOpacity="0.0" />
                </linearGradient>
                <linearGradient id="luxePriceLine" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#5C6B2E" />
                  <stop offset="55%" stopColor="#3A3733" />
                  <stop offset="100%" stopColor="#141311" />
                </linearGradient>
              </defs>

              <line
                x1="14"
                y1="14"
                x2="426"
                y2="14"
                stroke="#E4DFCF"
                strokeDasharray="3 3"
                strokeWidth="1"
              />
              <line
                x1="14"
                y1="86"
                x2="426"
                y2="86"
                stroke="#E4DFCF"
                strokeDasharray="3 3"
                strokeWidth="1"
              />

              {chartGeometry.areaPath && (
                <motion.path
                  d={chartGeometry.areaPath}
                  fill="url(#luxePriceArea)"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.6, ease: EASE }}
                />
              )}

              <motion.polyline
                fill="none"
                stroke="url(#luxePriceLine)"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={chartGeometry.linePoints}
                initial={{ pathLength: 0, opacity: 0.4 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 0.9, ease: EASE }}
              />

              {chartGeometry.coords.map((pt, idx) => {
                const isSelected =
                  hoveredIndex === idx ||
                  (hoveredIndex === null &&
                    idx === chartGeometry.coords.length - 1);
                return (
                  <g key={`${pt.date}-${idx}`}>
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={isSelected ? 4.4 : 2.6}
                      fill={isSelected ? "#3A3733" : "#FEFBF9"}
                      stroke="#3A3733"
                      strokeWidth="1.5"
                    />
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r="14"
                      fill="transparent"
                      role="img"
                      className="cursor-pointer"
                      tabIndex={0}
                      aria-label={`${pt.date}: ${formatPrice(
                        pt.value,
                        displayCurrency
                      )}`}
                      onMouseEnter={() => setHoveredIndex(idx)}
                      onMouseLeave={() => setHoveredIndex(null)}
                      onFocus={() => setHoveredIndex(idx)}
                      onBlur={() => setHoveredIndex(null)}
                    />
                  </g>
                );
              })}
            </svg>

            <div className="mt-1 flex items-center justify-between font-mono text-[9px] text-[#8B8780] tabular-nums">
              <span>
                {chartGeometry.coords[0].date} ({analytics.observationCount} pts)
              </span>
              <span className="hidden sm:inline">
                {historySource === "LIVE_OBSERVED"
                  ? "Actual recorded live snapshots"
                  : "Illustrative curated baseline"}
              </span>
              <span>
                {chartGeometry.coords[chartGeometry.coords.length - 1].date}
              </span>
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}

export default memo(HistoricalPriceGraph);
