"use client";

import { memo } from "react";
import { Bell, Bookmark, Scale } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

function Navbar({
  currency,
  onCurrencyChange,
  isLive,
  mode,
  activeMode = "compare",
  dataSource = null,
  cacheStatus,
  watchlistCount = 0,
  triggeredAlertCount = 0,
  onOpenWatchlist,
  onResetHome,
}) {
  const liveActive =
    typeof isLive === "boolean" ? isLive : mode === "live";

  const statusLabel = liveActive
    ? dataSource === "CACHED_LIVE" || cacheStatus === "HIT"
      ? "Cached Live"
      : "Live Feed"
    : "Curated Demo";

  const engineModeLabel =
    activeMode === "discover" ? "Mode A · Discovery" : "Mode B · Comparison";

  return (
    <motion.header
      initial={{ y: -12, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="sticky top-0 z-30 border-b border-[#E6E0D4]/40 bg-[#FFFFFF]/75 backdrop-blur-2xl supports-[backdrop-filter]:bg-[#FFFFFF]/60"
    >
      {/* Thin terracotta accent line at top */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#3A3733]/25 to-transparent"
      />

      <div className="relative mx-auto flex h-[68px] max-w-7xl items-center justify-between gap-4 px-5 sm:px-6 lg:px-10">
        {/* ── Logo area ──────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onResetHome}
            className="group flex items-center gap-3 text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#141311]"
            aria-label="LuxeIndex Beauty Price Index — go to home"
          >
            {/* Luxe Index mark — elegant rose-gold tone */}
            <span className="relative flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-[#EAE7DC] to-[#8B8780]/40 ring-1 ring-[#8B8780]/25 transition-all duration-300 group-hover:from-[#3A3733] group-hover:to-[#141311] group-hover:text-[#FFFFFF] group-hover:ring-[#3A3733] shadow-sm">
              <Scale className="h-[17px] w-[17px] stroke-[1.8] text-[#141311] transition-colors duration-300 group-hover:text-[#FFFFFF]" />
            </span>
            <span className="flex flex-col justify-center leading-none">
              <span className="font-serif text-[22px] font-medium tracking-[-0.02em] text-[#141311] lux-serif-display">
                LuxeIndex
              </span>
              {/* whitespace-only flex child: not rendered, but keeps visible text "LuxeIndex Beauty Price Index" matching the accessible name */}
              {" "}
              <span className="mt-1 hidden font-mono text-[8px] uppercase tracking-[0.32em] text-[#6B5D33] sm:block">
                Beauty Price Index
              </span>
            </span>
          </button>

          {/* Back to valley — elegant pill */}
          <a
            href="#top"
            className="ml-1 hidden items-center gap-1.5 rounded-full border border-[#E6E0D4]/70 bg-white/40 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[#75716B] transition-all duration-200 hover:border-[#3A3733]/60 hover:bg-[#EEF0DD]/80 hover:text-[#141311] lg:inline-flex lux-focus-ring"
            title="Return to Fernhollow 3D Valley"
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full transition-colors duration-200",
                liveActive
                  ? "bg-[#5C6B2E] shadow-[0_0_0_3px_rgba(92,107,46,0.18)] lux-dot-pulse"
                  : "bg-[#8B8780]/70"
              )}
              aria-hidden="true"
            />
            <span>Valley Top</span>
          </a>
        </div>

        {/* AestheticMatch-style section nav — real in-page anchors only */}
        <nav
          aria-label="Page sections"
          className="hidden flex-1 items-center justify-center gap-7 xl:flex"
        >
          {[
            { label: "The Index", href: "#luxe-index" },
            { label: "Best Sellers", href: "#best-sellers-heading" },
            { label: "FAQ", href: "#faq-heading" },
          ].map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#75716B] transition-colors duration-200 hover:text-[#141311] lux-focus-ring"
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/* ── Right actions ─────────────────────────────────── */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Mode badge — only on xl */}
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.16em] text-[#75716B] xl:inline-flex">
            {engineModeLabel}
          </span>
          <span
            className="hidden h-4 w-px bg-[#E0DBCB] xl:block"
            aria-hidden="true"
          />

          {/* Live / Curated badge */}
          <span
            className={cn(
              "hidden items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] sm:inline-flex transition-all duration-200 lux-focus-ring",
              liveActive
                ? "border-[#E4EAC9] bg-[#F6F8EA] text-[#3B4A1F]"
                : "border-[#E6E0D4]/70 bg-white/50 text-[#75716B]"
            )}
            title={
              liveActive
                ? dataSource === "CACHED_LIVE" || cacheStatus === "HIT"
                  ? "Served from verified 10-minute live snapshot cache"
                  : "Retrieved from live Google Shopping feed"
                : "Serving curated catalog baseline (demonstration dataset)"
            }
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full transition-colors duration-200",
                liveActive
                  ? "bg-[#5C6B2E] shadow-[0_0_0_3px_rgba(92,107,46,0.15)]"
                  : "bg-[#8B8780]"
              )}
              aria-hidden="true"
            />
            {statusLabel}
          </span>

          {/* Watchlist button */}
          <button
            type="button"
            onClick={onOpenWatchlist}
            aria-label={`Open Watchlist and Price Alerts (${watchlistCount} saved)`}
            className={cn(
              "relative inline-flex h-9 items-center gap-1.5 rounded-full border px-3 font-mono text-[11px] font-medium transition-all duration-200 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#141311]",
              triggeredAlertCount > 0
                ? "border-[#E4EAC9] bg-[#F6F8EA] text-[#3B4A1F] hover:bg-[#EEF2DC]"
                : "border-[#E6E0D4]/80 bg-white/70 text-[#141311] hover:border-[#141311] hover:bg-white"
            )}
          >
            {triggeredAlertCount > 0 ? (
              <Bell className="h-3.5 w-3.5 text-[#5C6B2E]" aria-hidden="true" />
            ) : (
              <Bookmark className="h-3.5 w-3.5 text-[#75716B]" aria-hidden="true" />
            )}
            <span className="hidden sm:inline">Watchlist</span>
            <span className="tabular-nums text-[#75716B]">({watchlistCount})</span>
            {triggeredAlertCount > 0 && (
              <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[#5C6B2E] px-1 text-[9px] font-semibold text-white tabular-nums">
                {triggeredAlertCount}
              </span>
            )}
          </button>

          {/* Currency toggle */}
          <div
            role="group"
            aria-label="Display currency"
            className="inline-flex items-center rounded-full border border-[#E6E0D4]/70 bg-[#F3EFE7]/60 p-[3px]"
          >
            {["INR", "USD"].map((code) => {
              const active = currency === code;
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => onCurrencyChange(code)}
                  aria-pressed={active}
                  className={cn(
                    "h-[28px] rounded-full px-2.5 font-mono text-[11px] font-medium tabular-nums transition-all duration-200 ease-out active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#141311]",
                    active
                      ? "bg-[#141311] text-[#FFFFFF] shadow-[0_1px_4px_rgba(20,19,17,0.35)]"
                      : "text-[#75716B] hover:text-[#141311]"
                  )}
                >
                  {code === "INR" ? "₹ INR" : "$ USD"}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </motion.header>
  );
}

export default memo(Navbar);
