"use client";

import { memo, useState } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import {
  Star,
  Link2,
  Check,
  Bookmark,
  BookmarkCheck,
  AlertTriangle,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";
import HistoricalPriceGraph from "@/components/HistoricalPriceGraph";
import { cn, formatPrice } from "@/lib/utils";
import { optimizeImageUrl } from "@/lib/imageUrl";

function formatTimestamp(iso) {
  if (!iso) return "Just now";
  try {
    return new Intl.DateTimeFormat("en-IN", {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "Just now";
  }
}

function ProductHeader({
  product,
  priceHistory,
  summary = null,
  historySource = "CURATED_DEMO",
  dataSource = null,
  cacheStatus = "BYPASS",
  isLive = false,
  productIdentity = null,
  currency,
  baseCurrency = "INR",
  isWatched = false,
  onOpenAlertModal,
  onRefreshLive = null,
  isRefreshing = false,
}) {
  const [failedSrc, setFailedSrc] = useState(null);
  const [copied, setCopied] = useState(false);

  if (!product) return null;

  const imgError = Boolean(failedSrc && failedSrc === product.image);
  const identityConfidence = productIdentity?.confidence || "exact";

  async function handleCopyLink() {
    try {
      const shareUrl = new URL(window.location.href);
      shareUrl.searchParams.set("q", product.name);
      shareUrl.searchParams.set("currency", currency);

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl.toString());
      } else {
        const tempInput = document.createElement("input");
        tempInput.value = shareUrl.toString();
        document.body.appendChild(tempInput);
        tempInput.select();
        document.execCommand("copy");
        document.body.removeChild(tempInput);
      }

      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <motion.article
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="overflow-hidden rounded-2xl border border-[#E6E0D4]/70 bg-white shadow-[0_1px_2px_rgba(26,24,21,0.04),0_30px_70px_-50px_rgba(26,24,21,0.35)]"
    >
      <div className="grid grid-cols-1 gap-0 lg:grid-cols-12">
        {/* ── Product image panel ─────────────────────────── */}
        <div className="border-b border-[#EEEAE1]/60 p-5 sm:p-6 lg:col-span-5 lg:border-b-0 lg:border-r">
          <motion.div
            key={product.image || product.id}
            initial={{ opacity: 0.6, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, ease: "easeOut", delay: 0.1 }}
            className="relative aspect-[4/5] w-full overflow-hidden rounded-xl border border-[#EEEAE1]/60 bg-[linear-gradient(160deg,#F9F5F0_0%,#F2ECE3_55%,#EFE6DB_100%)] group"
          >
            {!imgError && product.image ? (
              <Image
                src={optimizeImageUrl(product.image, 900)}
                alt={product.name}
                fill
                sizes="(max-width: 1024px) 100vw, 420px"
                priority
                onError={() => setFailedSrc(product.image)}
                className="object-contain p-7 transition-transform duration-700 ease-out group-hover:scale-[1.04]"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center">
                <svg
                  viewBox="0 0 80 96"
                  className="h-20 w-16 text-[#8B8780]"
                  fill="none"
                  aria-hidden="true"
                >
                  <rect x="28" y="10" width="24" height="14" stroke="currentColor" strokeWidth="1.5" />
                  <rect x="18" y="24" width="44" height="62" stroke="currentColor" strokeWidth="1.5" />
                  <line x1="26" y1="42" x2="54" y2="42" stroke="currentColor" strokeWidth="1.2" />
                  <line x1="26" y1="52" x2="46" y2="52" stroke="currentColor" strokeWidth="1.2" />
                </svg>
                <span className="mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-[#6B5D33]">
                  {product.brand}
                </span>
              </div>
            )}

            <span
              className={cn(
                "absolute left-3 top-3 rounded-full border px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.1em] backdrop-blur-md",
                isLive
                  ? "border-[#E4EAC9] bg-[#F6F8EA]/90 text-[#3B4A1F]"
                  : "border-[#E8E3D2] bg-[#F7F3E8]/90 text-[#6B5D33]"
              )}
            >
              {isLive
                ? dataSource === "CACHED_LIVE" || cacheStatus === "HIT"
                  ? "Cached Live"
                  : "Live Observed"
                : "Curated Demo"}
            </span>
          </motion.div>

          <div className="mt-3 grid grid-cols-2 gap-2.5 font-mono text-[10px] text-[#75716B]">
            <div className="rounded-xl border border-[#EEEAE1]/60 bg-[#FFFFFF]/60 px-3 py-2">
              <span className="block text-[8.5px] uppercase tracking-[0.14em]">Size / Volume</span>
              <span className="mt-0.5 block font-medium text-[#141311]">
                {product.volume || "Unverified"}
              </span>
            </div>
            <div className="rounded-xl border border-[#EEEAE1]/60 bg-[#FFFFFF]/60 px-3 py-2 text-right">
              <span className="block text-[8.5px] uppercase tracking-[0.14em]">
                {summary?.pricePer100Unit && summary?.unitLabel
                  ? summary.unitLabel
                  : "Updated"}
              </span>
              <span className="mt-0.5 block font-medium text-[#141311] tabular-nums">
                {summary?.pricePer100Unit && summary?.unitLabel
                  ? formatPrice(summary.pricePer100Unit, currency)
                  : formatTimestamp(product.lastUpdated)}
              </span>
            </div>
          </div>
        </div>

        {/* ── Product info panel ──────────────────────────── */}
        <div className="flex flex-col justify-between gap-6 p-5 sm:p-7 lg:col-span-7">
          <div>
            {/* Header row: brand, GTIN/SKU, actions */}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-[#141311]">
                  {product.brand} &middot; {product.category}
                </p>
                {(product.gtin || product.sku) && (
                  <span className="rounded-full border border-[#EEEAE1]/60 bg-[#FFFFFF]/80 px-2 py-0.5 font-mono text-[9px] text-[#75716B] tabular-nums">
                    {product.gtin ? `GTIN ${product.gtin}` : `SKU ${product.sku}`}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {onRefreshLive && (
                  <button
                    type="button"
                    onClick={onRefreshLive}
                    disabled={isRefreshing}
                    title="Bypass cache and re-check live retailer offers"
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-[#E0DBCB] bg-white px-3.5 py-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-[#141311] transition-colors duration-200 hover:border-[#141311] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RefreshCw className={cn("h-3 w-3", isRefreshing && "animate-spin")} aria-hidden="true" />
                    <span>{isRefreshing ? "Refreshing" : "Refresh"}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={onOpenAlertModal}
                  className={cn(
                    "inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[11px] font-medium transition-all duration-200",
                    isWatched
                      ? "border-[#141311] bg-[#141311] text-[#FFFFFF]"
                      : "border-[#E0DBCB] bg-white text-[#141311] hover:border-[#3A3733] hover:text-[#141311]"
                  )}
                >
                  {isWatched ? (
                    <>
                      <BookmarkCheck className="h-3.5 w-3.5" />
                      <span>Watching</span>
                    </>
                  ) : (
                    <>
                      <Bookmark className="h-3.5 w-3.5" />
                      <span>Track Price</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleCopyLink}
                  className={cn(
                    "inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[11px] font-medium transition-all duration-200 ease-out",
                    copied
                      ? "border-[#E4EAC9] bg-[#F6F8EA] text-[#3B4A1F]"
                      : "border-[#E0DBCB] bg-white text-[#141311] hover:border-[#141311]"
                  )}
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Link2 className="h-3.5 w-3.5" />
                      <span>Share</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Product name */}
            <h2 className="mt-3 font-serif text-[1.9rem] font-normal leading-[1.1] tracking-[-0.025em] text-[#141311] sm:text-[2.4rem]">
              {product.name}
            </h2>

            {product.variant && (
              <p className="mt-1.5 font-mono text-[10.5px] text-[#75716B]">
                Variant:{" "}
                <span className="text-[#75716B]">{product.variant}</span>
              </p>
            )}

            {/* Rating + key notes row */}
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-[#EEEAE1]/40 py-3">
              {product.rating != null ? (
                <div className="flex items-center gap-1.5 font-mono text-[11px] tabular-nums">
                  <Star className="h-3.5 w-3.5 fill-[#9AA08A] text-[#9AA08A]" aria-hidden="true" />
                  <span className="font-semibold text-[#141311]">
                    {Number(product.rating).toFixed(1)}
                  </span>
                  {product.reviewCount != null && product.reviewCount > 0 && (
                    <span className="text-[#8B8780]">
                      ({Number(product.reviewCount).toLocaleString("en-US")} reviews)
                    </span>
                  )}
                </div>
              ) : (
                <span className="font-mono text-[11px] text-[#8B8780]">Rating not provided by feed</span>
              )}

              {Array.isArray(product.keyNotes) && product.keyNotes.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {product.keyNotes.map((note) => (
                    <span
                      key={note}
                      className="rounded-full border border-[#E4EAC9]/70 bg-[#F8EAD2]/80 px-2.5 py-0.5 font-mono text-[9.5px] text-[#6B5D33]"
                    >
                      {note}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Best price callout */}
            {summary?.bestPrice != null && (
              <motion.div
                layout
                className="mt-4 flex flex-wrap items-end justify-between gap-4 rounded-xl border border-[#EDE8D8]/70 bg-gradient-to-br from-[#EEF0DD] to-[#F0EDE4] px-4 py-3.5 shadow-[0_10px_30px_-18px_rgba(20,19,17,0.35)]"
              >
                <div>
                  <span className="font-mono text-[8.5px] uppercase tracking-[0.2em] text-[#141311]">
                    Best verified price
                  </span>
                  <div className="mt-1 flex flex-wrap items-baseline gap-2">
                    <span className="font-serif text-[1.9rem] leading-none text-[#141311] tabular-nums">
                      {formatPrice(summary.bestPrice, currency)}
                    </span>
                    {summary.bestStore && (
                      <span className="font-mono text-[10.5px] text-[#75716B]">
                        at {summary.bestStore}
                      </span>
                    )}
                  </div>
                </div>
                {summary.maxSavings > 0 && (
                  <span className="rounded-full border border-[#E8E4D8]/80 bg-white px-3 py-1 font-mono text-[9.5px] font-medium text-[#3B4A1F] tabular-nums shadow-sm">
                    Save {formatPrice(summary.maxSavings, currency)}
                    {summary.maxSavingsPercent > 0
                      ? ` · ${summary.maxSavingsPercent}%`
                      : ""}
                  </span>
                )}
              </motion.div>
            )}

            {/* Identity verification */}
            {productIdentity?.warning ? (
              <div
                role="note"
                className="mt-4 flex items-start gap-2.5 rounded-xl border border-[#E8E3D2] bg-[#F7F3E8] px-3.5 py-3 text-xs text-[#6B5D33]"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#5C6B2E]" aria-hidden="true" />
                <p className="leading-relaxed">
                  <strong className="font-semibold">Variant notice: </strong>
                  {productIdentity.warning}
                  {productIdentity.excludedMismatchCount > 0 &&
                    ` (${productIdentity.excludedMismatchCount} mismatched bundle/size listings excluded automatically.)`}
                </p>
              </div>
            ) : (
              identityConfidence === "exact" && (
                <div className="mt-3.5 inline-flex items-center gap-1.5 rounded-full bg-[#F6F8EA] px-2.5 py-1 font-mono text-[9.5px] text-[#3B4A1F]">
                  <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                  <span>SKU size &amp; variant verification aligned</span>
                </div>
              )
            )}

            <p className="mt-4 max-w-[68ch] text-[13.5px] leading-[1.75] text-[#75716B]">
              {product.description}
            </p>
          </div>

          {/* Historical price graph */}
          <HistoricalPriceGraph
            priceHistory={priceHistory}
            sourceCurrency={baseCurrency}
            displayCurrency={currency}
            historySource={historySource}
            cacheStatus={cacheStatus}
            isLive={isLive}
          />
        </div>
      </div>
    </motion.article>
  );
}

export default memo(ProductHeader);
