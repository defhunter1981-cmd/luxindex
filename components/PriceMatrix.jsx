"use client";

import { memo, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowUpRight,
  ShieldCheck,
  Star,
  Truck,
  Tag,
  EyeOff,
  Store,
  AlertCircle,
  Layers,
  Sparkles,
} from "lucide-react";
import { cn, formatPrice } from "@/lib/utils";
import { EASE, DURATIONS, STAGGER } from "@/lib/motion";

const SORT_OPTIONS = [
  { id: "price", label: "Lowest Price" },
  { id: "shipping", label: "Fastest Delivery" },
  { id: "rating", label: "Retailer Rating" },
  { id: "discount", label: "Highest Discount" },
];

const rowVariants = {
  hidden: { opacity: 0, x: -10 },
  visible: (i) => ({
    opacity: 1,
    x: 0,
    transition: {
      delay: Math.min(i * STAGGER.base, 0.4),
      duration: DURATIONS.base,
      ease: EASE,
    },
  }),
  hover: {
    backgroundColor: "rgba(251, 246, 240, 0.72)",
    transition: { duration: 0.16 },
  },
};

function StockBadge({ stockLabel, inStock, isUnavailablePlaceholder }) {
  if (isUnavailablePlaceholder) {
    return (
      <span className="inline-flex items-center rounded-full border border-[#E4DFCF] bg-[#F0EDE4] px-2.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.06em] text-[#8B8780]">
        Not returned
      </span>
    );
  }

  const labelLower = String(stockLabel || "").toLowerCase();
  const isLowStock = inStock && labelLower.includes("only");

  if (!inStock) {
    return (
      <span className="inline-flex items-center rounded-full border border-[#E4DFCF] bg-[#F0EDE4] px-2.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.06em] text-[#8B8780]">
        Out of stock
      </span>
    );
  }

  if (isLowStock) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-[#E8E3D2] bg-[#FBF1DC] px-2.5 py-0.5 font-mono text-[9px] font-medium text-[#6B5D33]">
        <span className="h-1 w-1 rounded-full bg-[#5C6B2E]" aria-hidden="true" />
        {stockLabel}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[#DCE5C0] bg-[#F6F8EA] px-2.5 py-0.5 font-mono text-[9px] text-[#4A5527]">
      <span className="h-1.5 w-1.5 rounded-full bg-[#5C6B2E]" aria-hidden="true" />
      {stockLabel || "In Stock"}
    </span>
  );
}

function formatTimeLabel(isoString) {
  if (!isoString) return null;
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StoreActionControl({ offer, fullWidth = false }) {
  const hasUrl = Boolean(offer?.storeUrl);

  if (hasUrl && offer?.linkType === "exact_product") {
    return (
      <div className={cn("flex flex-col gap-1.5", fullWidth ? "w-full" : "items-end")}>
        <a
          href={offer.storeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-full border text-[10.5px] font-medium uppercase tracking-[0.11em] transition-all duration-300 ease-out active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#141311]",
            fullWidth ? "min-h-[42px] w-full px-4" : "min-h-[36px] px-4",
            offer.isLowestActive
              ? "border-[#141311] bg-[#141311] text-[#FFFFFF] hover:border-[#000000] hover:bg-[#000000] hover:shadow-[0_6px_20px_-8px_rgba(20,19,17,0.6)]"
              : offer.inStock
              ? "border-[#D8D4C6] bg-white text-[#141311] hover:border-[#5C6B2E] hover:bg-[#FBF1DC] hover:shadow-[0_4px_14px_-6px_rgba(201,242,77,0.5)]"
              : "border-[#E4DFCF] bg-[#F0EDE4] text-[#8B8780] hover:border-[#141311] hover:text-[#141311]"
          )}
        >
          <span>Go to Store</span>
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
        {offer.linkHostname && (
          <span className="font-mono text-[8.5px] uppercase tracking-[0.08em] text-[#8B8780]">
            Exact PDP &middot; {offer.linkHostname}
          </span>
        )}
      </div>
    );
  }

  if (hasUrl && offer?.linkType === "retailer_search") {
    return (
      <div className={cn("flex flex-col gap-1.5", fullWidth ? "w-full" : "items-end")}>
        <a
          href={offer.storeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-full border text-[10.5px] font-medium uppercase tracking-[0.11em] transition-all duration-300 ease-out active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#141311]",
            fullWidth ? "min-h-[42px] w-full px-4" : "min-h-[36px] px-4",
            offer.isLowestActive
              ? "border-[#141311] bg-[#141311] text-[#FFFFFF] hover:border-[#000000] hover:bg-[#000000]"
              : "border-[#D8D4C6] bg-[#F0EDE4] text-[#141311] hover:border-[#5C6B2E] hover:bg-[#FBF1DC] hover:shadow-[0_4px_14px_-6px_rgba(201,242,77,0.5)]"
          )}
        >
          <span>Search Retailer</span>
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
        <span className="font-mono text-[8.5px] uppercase tracking-[0.08em] text-[#8B8780]">
          Retailer search{offer.linkHostname ? ` · ${offer.linkHostname}` : ""}
        </span>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-1.5", fullWidth ? "w-full" : "items-end")}>
      <span
        className={cn(
          "inline-flex cursor-not-allowed items-center justify-center rounded-full border border-dashed border-[#DAD6C8] bg-[#F0EDE4]/70 px-3 py-2 font-mono text-[9px] uppercase tracking-[0.06em] text-[#8B8780]",
          fullWidth ? "min-h-[42px] w-full" : "min-h-[36px]"
        )}
      >
        Link unavailable
      </span>
    </div>
  );
}

function SecondaryVariantSection({
  title,
  subtitle,
  items = [],
  currency = "INR",
  badgeText,
  tone = "neutral",
  icon: Icon = Layers,
}) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const isAmber = tone === "amber";

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATIONS.slow, ease: EASE }}
      className={cn(
        "rounded-[20px] border bg-white/85 p-5 backdrop-blur-sm sm:p-6",
        isAmber
          ? "border-[#E8E3D2]/90 bg-[linear-gradient(170deg,#FFFDFA_0%,#FCF6EB_100%)]"
          : "border-[#E4DFCF]/80"
      )}
    >
      <div className="flex flex-col gap-1 border-b border-[#EFEDE2]/70 pb-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                isAmber ? "bg-[#F8EAD2] text-[#5C6B2E]" : "bg-[#F0EDE4] text-[#75716B]"
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <h3 className="font-serif text-[1.18rem] font-normal tracking-[-0.01em] text-[#141311]">
              {title}
            </h3>
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.12em]",
                isAmber
                  ? "border-[#E8E3D2] bg-[#FBF1DC] text-[#6B5D33]"
                  : "border-[#E4DFCF] bg-[#F0EDE4] text-[#75716B]"
              )}
            >
              {items.length} {items.length === 1 ? "listing" : "listings"}
            </span>
          </div>
          <p className="mt-1.5 max-w-[80ch] text-[11.5px] leading-relaxed text-[#75716B]">
            {subtitle}
          </p>
        </div>
      </div>

      <div className="mt-1 divide-y divide-[#F0EDE4]/70">
        {items.map((offer, idx) => {
          const specChips = [
            offer.detectedVolume,
            offer.detectedSpf ? offer.detectedSpf.toUpperCase() : null,
            offer.detectedConcentration,
            offer.detectedPackCount > 1 ? `Pack of ${offer.detectedPackCount}` : null,
            offer.detectedFormulationLabel,
          ].filter(Boolean);

          return (
            <motion.div
              key={`${offer.retailer}-${offer.matchedTitle || ""}-${idx}`}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(idx * STAGGER.tight, 0.3), duration: DURATIONS.base }}
              className="flex flex-col justify-between gap-3 py-4 first:pt-3.5 last:pb-1 sm:flex-row sm:items-center"
            >
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-serif text-[15px] font-medium text-[#141311]">
                    {offer.retailer}
                  </span>
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 font-mono text-[8.5px] font-medium uppercase tracking-[0.11em]",
                      isAmber
                        ? "border-[#E8E3D2] bg-[#FBF1DC] text-[#6B5D33]"
                        : "border-[#D8D4C6] bg-[#F0EDE4] text-[#75716B]"
                    )}
                  >
                    {offer.variantStatusLabel || badgeText}
                  </span>
                  {specChips.map((chip) => (
                    <span
                      key={chip}
                      className="rounded-full border border-[#EEEAE1]/90 bg-[#F0EDE4]/90 px-2 py-0.5 font-mono text-[8.5px] text-[#75716B]"
                    >
                      {chip}
                    </span>
                  ))}
                </div>
                {offer.matchedTitle && (
                  <p
                    className="line-clamp-2 text-[11.5px] leading-relaxed text-[#75716B]"
                    title={offer.matchedTitle}
                  >
                    {offer.matchedTitle}
                  </p>
                )}
                {offer.variantNote && (
                  <p
                    className={cn(
                      "inline-flex items-center gap-1 font-mono text-[9px]",
                      isAmber ? "text-[#5C6B2E]" : "text-[#8B8780]"
                    )}
                  >
                    <AlertCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span>{offer.variantNote}</span>
                  </p>
                )}
              </div>

              <div className="flex shrink-0 flex-wrap items-center justify-end gap-4">
                <div className="text-left sm:text-right">
                  <div className="font-mono text-[13px] font-semibold text-[#141311] tabular-nums">
                    {offer.displayPrice != null
                      ? formatPrice(offer.displayPrice, currency)
                      : "Unavailable"}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[8.5px] text-[#8B8780]">
                    <span>{offer.stockLabel || (offer.inStock ? "In Stock" : "Out of Stock")}</span>
                    {offer.shippingInfo && (
                      <>
                        <span>&middot;</span>
                        <span>{offer.shippingInfo}</span>
                      </>
                    )}
                  </div>
                </div>

                <StoreActionControl offer={offer} />
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}

function PriceMatrix({
  offers = [],
  unverifiedOffers = [],
  otherVariants = [],
  variantSummary = null,
  totalCount = 5,
  flagshipCoverage = [],
  summary,
  currency = "INR",
  sortBy,
  onSortChange,
  hideOutOfStock,
  onToggleHideOutOfStock,
  targetRetailersOnly = false,
  onToggleTargetRetailersOnly,
  exactVariantsOnly = false,
  onToggleExactVariantsOnly,
}) {
  const [showMissingFlagships, setShowMissingFlagships] = useState(false);

  const missingFlagshipRows = useMemo(() => {
    if (!showMissingFlagships || !Array.isArray(flagshipCoverage)) return [];
    const presentSet = new Set(offers.map((o) => o.retailer));
    return flagshipCoverage
      .filter((f) => !f.available && !presentSet.has(f.retailer))
      .map((f) => ({
        retailer: f.retailer,
        isTargetRetailer: true,
        isUnavailablePlaceholder: true,
        inStock: false,
        stockLabel: "Unavailable in Feed",
        storeTag: "Flagship Store",
        storeRating: null,
        shippingInfo: "—",
        displayPrice: null,
        displayOriginalPrice: null,
        discountPercent: null,
        savingsAmount: 0,
        storeUrl: f.storeUrl || null,
        linkType: f.linkType || "unavailable",
        linkHostname: f.linkHostname || "",
        dataSource: "UNAVAILABLE",
      }));
  }, [showMissingFlagships, flagshipCoverage, offers]);

  const combinedRows = useMemo(
    () => [...offers, ...missingFlagshipRows],
    [offers, missingFlagshipRows]
  );

  const missingCount = useMemo(
    () => flagshipCoverage.filter((f) => !f.available).length,
    [flagshipCoverage]
  );

  return (
    <motion.section
      aria-label="Retailer price comparison matrix"
      className="space-y-5"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATIONS.slow, ease: EASE }}
    >
      {/* Best Deal Callout Banner */}
      <AnimatePresence>
        {summary?.bestStore && summary?.bestPrice != null && (
          <motion.div
            key="best-deal-banner"
            initial={{ opacity: 0, y: -8, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, transition: { duration: 0.2 } }}
            role="status"
            className="relative overflow-hidden rounded-[20px] border border-[#E4EAC9]/80 bg-[linear-gradient(120deg,#FBF1DC_0%,#F8EAD2_52%,#EEF0DD_100%)] px-5 py-4 text-sm text-[#141311] shadow-[0_18px_50px_-40px_rgba(201,242,77,0.7)] sm:flex sm:flex-row sm:items-center sm:px-6"
          >
            <div
              aria-hidden="true"
              className="absolute left-0 top-0 h-full w-[3px] bg-gradient-to-b from-[#C9F24D] via-[#8FA14E] to-[#3A3733]"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-10 -top-16 h-44 w-44 rounded-full bg-[radial-gradient(circle,rgba(201,242,77,0.25)_0%,rgba(255,255,255,0)_70%)]"
            />

            <div className="relative flex items-start gap-3 pl-3 sm:items-center">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/90 text-[#6B5D33] shadow-[0_2px_10px_-2px_rgba(201,242,77,0.45)]">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
              </span>
              <p className="leading-relaxed">
                Best verified deal on{" "}
                <span className="font-semibold">{summary.bestStore}</span> at{" "}
                <span className="font-mono text-[15px] font-semibold text-[#141311] tabular-nums">
                  {formatPrice(summary.bestPrice, currency)}
                </span>
                .{" "}
                {summary.maxSavings > 0 ? (
                  <>
                    Save up to{" "}
                    <span className="font-mono font-semibold text-[#6B5D33] tabular-nums">
                      {formatPrice(summary.maxSavings, currency)}
                    </span>{" "}
                    versus the highest active listing.
                  </>
                ) : (
                  "Matches the lowest parity pricing across returned stores."
                )}
              </p>
            </div>

            {summary.maxSavingsPercent > 0 && (
              <motion.span
                initial={{ scale: 0.7, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.28, type: "spring", stiffness: 320, damping: 22 }}
                className="relative mt-3 self-start rounded-full border border-[#E4EAC9] bg-white px-3 py-1 font-mono text-[10px] font-semibold text-[#6B5D33] tabular-nums shadow-sm sm:mt-0 sm:ml-auto sm:self-auto"
              >
                &minus;{summary.maxSavingsPercent}% vs High
              </motion.span>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Flagship 5-Retailer Coverage Strip */}
      {flagshipCoverage.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: DURATIONS.slow }}
          className="rounded-[20px] border border-[#E4DFCF]/80 bg-white/85 px-4 py-4 backdrop-blur-sm sm:px-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-[#141311]">
              <Store className="h-3.5 w-3.5" aria-hidden="true" />
              Five flagship beauty retailers
            </span>
            {missingCount > 0 && (
              <button
                type="button"
                onClick={() => setShowMissingFlagships((prev) => !prev)}
                className="font-mono text-[10px] text-[#141311] underline-offset-2 transition-colors hover:text-[#141311] hover:underline"
              >
                {showMissingFlagships
                  ? "Hide unavailable flagships"
                  : `Show ${missingCount} unavailable flagship${missingCount > 1 ? "s" : ""}`}
              </button>
            )}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-5">
            {flagshipCoverage.map((item, idx) => {
              const cardClasses = cn(
                "group/card flex h-full flex-col justify-between rounded-xl border px-3 py-2.5 transition-all duration-300",
                item.available
                  ? "border-[#EFEDE2]/90 bg-[#F0EDE4]/80 hover:-translate-y-0.5 hover:border-[#D5D2C2] hover:bg-white hover:shadow-[0_10px_26px_-18px_rgba(26,24,21,0.45)]"
                  : "border-dashed border-[#DAD6C8] bg-[#F2EFE6]/60"
              );

              return (
                <motion.div
                  key={item.retailer}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(idx * 0.055, 0.3), duration: DURATIONS.base }}
                >
                  {item.storeUrl && item.linkType !== "unavailable" ? (
                    <a
                      href={item.storeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cardClasses}
                    >
                      <span className="font-serif text-[12.5px] font-medium text-[#141311]">
                        {item.retailer}
                      </span>
                      <div className="mt-1.5 flex flex-col gap-0.5">
                        <span
                          className={cn(
                            "font-mono text-[10.5px] tabular-nums",
                            item.available
                              ? "font-semibold text-[#4A5527]"
                              : "text-[#8B8780]"
                          )}
                        >
                          {item.available && item.price != null
                            ? formatPrice(item.price, item.currency || currency)
                            : "Not in live feed"}
                        </span>
                        {item.storeUrl && item.linkType === "retailer_search" && (
                          <span className="font-mono text-[7.5px] uppercase tracking-[0.16em] text-[#8B8780]">
                            Search Link
                          </span>
                        )}
                        {item.storeUrl && item.linkType === "exact_product" && (
                          <span className="inline-flex items-center gap-1 font-mono text-[7.5px] uppercase tracking-[0.16em] text-[#4A5527]">
                            <span className="h-1 w-1 rounded-full bg-[#5C6B2E]" aria-hidden="true" />
                            Exact PDP
                          </span>
                        )}
                      </div>
                    </a>
                  ) : (
                    <div className={cardClasses}>
                      <span className="font-serif text-[12.5px] font-medium text-[#141311]">
                        {item.retailer}
                      </span>
                      <div className="mt-1.5 flex flex-col gap-0.5">
                        <span
                          className={cn(
                            "font-mono text-[10.5px] tabular-nums",
                            item.available
                              ? "font-semibold text-[#4A5527]"
                              : "text-[#8B8780]"
                          )}
                        >
                          {item.available && item.price != null
                            ? formatPrice(item.price, item.currency || currency)
                            : "Not in live feed"}
                        </span>
                        {!item.available && (
                          <span className="font-mono text-[7.5px] uppercase tracking-[0.16em] text-[#8B8780]">
                            Not observed
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* Sort & Filter Controls Bar */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.15 }}
        className="flex flex-col justify-between gap-3 border-b border-[#EFEDE2]/70 pb-4 lg:flex-row lg:items-center"
      >
        <div
          className="flex flex-wrap items-center gap-1"
          role="group"
          aria-label="Sort retailer offers"
        >
          <span className="mr-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-[#8B8780]">
            Sort
          </span>
          {SORT_OPTIONS.map((opt) => {
            const active = sortBy === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => onSortChange(opt.id)}
                aria-pressed={active}
                className={cn(
                  "relative min-h-[34px] rounded-full px-3 py-1 text-[11px] font-medium transition-colors duration-200 ease-out active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#141311]",
                  active
                    ? "text-[#FFFFFF]"
                    : "text-[#75716B] hover:bg-white hover:text-[#141311]"
                )}
              >
                {active && (
                  <motion.span
                    layoutId="price-matrix-sort-pill"
                    aria-hidden="true"
                    className="absolute inset-0 rounded-full bg-[#141311] shadow-[0_2px_10px_rgba(20,19,17,0.3)]"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  />
                )}
                <span className="relative z-10">{opt.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <button
            type="button"
            onClick={onToggleHideOutOfStock}
            aria-pressed={hideOutOfStock}
            className={cn(
              "inline-flex min-h-[34px] items-center gap-1.5 rounded-full border px-3 py-1 text-[10.5px] font-medium transition-all duration-200",
              hideOutOfStock
                ? "border-[#141311] bg-[#141311] text-[#FFFFFF] shadow-[0_2px_8px_rgba(20,19,17,0.3)]"
                : "border-[#E4DFCF]/90 bg-white text-[#75716B] hover:border-[#141311]"
            )}
          >
            <EyeOff className="h-3 w-3" aria-hidden="true" />
            <span>In Stock Only</span>
          </button>

          {onToggleTargetRetailersOnly && (
            <button
              type="button"
              onClick={onToggleTargetRetailersOnly}
              aria-pressed={targetRetailersOnly}
              className={cn(
                "inline-flex min-h-[34px] items-center gap-1.5 rounded-full border px-3 py-1 text-[10.5px] font-medium transition-all duration-200",
                targetRetailersOnly
                  ? "border-[#141311] bg-[#141311] text-[#FFFFFF] shadow-[0_2px_8px_rgba(20,19,17,0.3)]"
                  : "border-[#E4DFCF]/90 bg-white text-[#75716B] hover:border-[#141311]"
              )}
            >
              <span>5 Flagships Only</span>
            </button>
          )}

          {onToggleExactVariantsOnly && (
            <button
              type="button"
              onClick={onToggleExactVariantsOnly}
              aria-pressed={exactVariantsOnly}
              className={cn(
                "inline-flex min-h-[34px] items-center gap-1.5 rounded-full border px-3 py-1 text-[10.5px] font-medium transition-all duration-200",
                exactVariantsOnly
                  ? "border-[#141311] bg-[#141311] text-[#FFFFFF] shadow-[0_2px_8px_rgba(20,19,17,0.3)]"
                  : "border-[#E4DFCF]/90 bg-white text-[#75716B] hover:border-[#141311]"
              )}
            >
              <span>Exact Variant Only</span>
            </button>
          )}

          <span className="font-mono text-[10px] text-[#8B8780] tabular-nums">
            {offers.length}/{totalCount} exact matches
          </span>
        </div>
      </motion.div>

      {combinedRows.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-[20px] border border-[#E4DFCF]/80 bg-white/85 px-6 py-14 text-center backdrop-blur-sm"
        >
          <p className="font-serif text-xl italic text-[#141311]">
            {unverifiedOffers.length > 0 || otherVariants.length > 0
              ? "No verified exact-variant matches under these filters."
              : "No offers match the active filters."}
          </p>
          <p className="mx-auto mt-2 max-w-[62ch] text-[12.5px] leading-relaxed text-[#75716B]">
            {unverifiedOffers.length > 0 || otherVariants.length > 0
              ? "Listings without confirmed variant parity — different sizes, packs or formulations — are kept separate below so incompatible SKUs are never compared as identical."
              : "Relax the stock, flagship, or exact-variant filter to inspect all returned store offers."}
          </p>
        </motion.div>
      ) : (
        <>
          {/* Desktop Editorial Comparison Table */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="hidden overflow-hidden rounded-[20px] border border-[#E4DFCF]/80 bg-white/92 shadow-[0_24px_70px_-56px_rgba(26,24,21,0.5)] backdrop-blur-sm md:block"
          >
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-[#EFEDE2]/80 bg-[#F0EDE4]/90 font-mono text-[8.5px] uppercase tracking-[0.16em] text-[#8B8780]">
                    <th scope="col" className="px-5 py-3.5 font-medium">
                      Retailer &amp; Listing
                    </th>
                    <th scope="col" className="px-4 py-3.5 text-right font-medium">
                      Price
                    </th>
                    <th scope="col" className="px-4 py-3.5 font-medium">
                      Discount
                    </th>
                    <th scope="col" className="px-4 py-3.5 font-medium">
                      Availability
                    </th>
                    <th scope="col" className="px-4 py-3.5 font-medium">
                      Delivery
                    </th>
                    <th scope="col" className="px-4 py-3.5 font-medium">
                      Savings
                    </th>
                    <th scope="col" className="px-5 py-3.5 text-right font-medium">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0EDE4]/70">
                  {combinedRows.map((offer, idx) => (
                    <motion.tr
                      key={`${offer.retailer}-${offer.isUnavailablePlaceholder ? "missing" : "live"}`}
                      custom={idx}
                      variants={rowVariants}
                      initial="hidden"
                      animate="visible"
                      whileHover="hover"
                      className={cn(
                        "transition-colors duration-150",
                        offer.isLowestActive
                          ? "bg-[#EEF0DD]/75"
                          : "hover:bg-[#FEFAF7]/70",
                        (!offer.inStock || offer.isUnavailablePlaceholder) && "opacity-75"
                      )}
                    >
                      <td className="px-5 py-4 align-middle">
                        <div className="flex flex-col gap-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-serif text-[15px] font-medium text-[#141311]">
                              {offer.retailer}
                            </span>
                            {offer.isLowestActive && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-[#E4EAC9] bg-[#EEF0DD] px-2 py-0.5 font-mono text-[8px] font-medium uppercase tracking-[0.12em] text-[#141311]">
                                <span
                                  className="h-1 w-1 rounded-full bg-[#141311]"
                                  aria-hidden="true"
                                />
                                Best Deal
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[9px] text-[#8B8780]">
                            <span className="inline-flex items-center gap-1">
                              <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                              {offer.storeTag || "Merchant"}
                            </span>
                            <span>&middot;</span>
                            {offer.storeRating != null ? (
                              <span className="inline-flex items-center gap-1 tabular-nums">
                                <Star
                                  className="h-2.5 w-2.5 fill-[#A8AC96] text-[#A8AC96]"
                                  aria-hidden="true"
                                />
                                {Number(offer.storeRating).toFixed(1)}
                              </span>
                            ) : (
                              <span>Rating N/A</span>
                            )}
                            <span>&middot;</span>
                            <span className="uppercase">
                              {offer.dataSource === "LIVE_OBSERVED"
                                ? "Live Feed"
                                : offer.dataSource === "UNAVAILABLE"
                                ? "No Listing"
                                : "Curated Demo"}
                            </span>
                            {formatTimeLabel(offer.lastUpdated) && (
                              <>
                                <span>&middot;</span>
                                <span className="tabular-nums">
                                  {formatTimeLabel(offer.lastUpdated)}
                                </span>
                              </>
                            )}
                          </div>
                          {offer.matchedTitle && !offer.isUnavailablePlaceholder && (
                            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                              <p
                                className="line-clamp-1 max-w-[320px] text-[11px] text-[#75716B]"
                                title={offer.matchedTitle}
                              >
                                {offer.matchedTitle}
                              </p>
                              {offer.detectedVolume && (
                                <span className="rounded-full border border-[#EEEAE1]/90 bg-[#F0EDE4]/90 px-1.5 py-0.5 font-mono text-[8.5px] text-[#75716B]">
                                  {offer.detectedVolume}
                                </span>
                              )}
                            </div>
                          )}
                          {offer.variantNote &&
                            offer.variantMatchStatus &&
                            offer.variantMatchStatus !== "exact" && (
                              <span className="inline-flex items-center gap-1 font-mono text-[8.5px] text-[#5C6B2E]">
                                <AlertCircle className="h-2.5 w-2.5 shrink-0" />
                                {offer.variantNote}
                              </span>
                            )}
                        </div>
                      </td>

                      <td className="px-4 py-4 text-right align-middle">
                        {offer.displayPrice != null ? (
                          <div>
                            <div className="font-serif text-[17px] font-medium text-[#141311] tabular-nums">
                              {formatPrice(offer.displayPrice, currency)}
                            </div>
                            {offer.displayOriginalPrice != null &&
                              offer.displayOriginalPrice > offer.displayPrice && (
                                <div className="font-mono text-[9.5px] text-[#8B8780] line-through tabular-nums">
                                  {formatPrice(offer.displayOriginalPrice, currency)}
                                </div>
                              )}
                          </div>
                        ) : (
                          <span className="font-mono text-[10px] text-[#8B8780]">
                            Unavailable
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-4 align-middle font-mono text-[10px] tabular-nums">
                        {offer.discountPercent != null && offer.discountPercent > 0 ? (
                          <span className="rounded-full border border-[#E8E3D2] bg-[#FBF1DC] px-2 py-0.5 font-medium text-[#6B5D33]">
                            &minus;{offer.discountPercent}%
                          </span>
                        ) : (
                          <span className="text-[#8B8780]">&mdash;</span>
                        )}
                      </td>

                      <td className="px-4 py-4 align-middle">
                        <StockBadge
                          stockLabel={offer.stockLabel}
                          inStock={offer.inStock}
                          isUnavailablePlaceholder={offer.isUnavailablePlaceholder}
                        />
                      </td>

                      <td className="px-4 py-4 align-middle">
                        <div className="flex items-center gap-1.5 text-[11px] text-[#75716B]">
                          <Truck
                            className="h-3.5 w-3.5 shrink-0 text-[#8B8780]"
                            aria-hidden="true"
                          />
                          <span>{offer.shippingInfo || "Not disclosed"}</span>
                        </div>
                      </td>

                      <td className="px-4 py-4 align-middle font-mono text-[10px] tabular-nums">
                        {offer.isUnavailablePlaceholder ? (
                          <span className="text-[#8B8780]">&mdash;</span>
                        ) : offer.savingsAmount > 0 && offer.displayPrice != null ? (
                          <span className="font-medium text-[#4A5527]">
                            Save {formatPrice(offer.savingsAmount, currency)}
                            <span className="text-[#75716B]">
                              {" "}
                              ({offer.savingsPercent}%)
                            </span>
                          </span>
                        ) : offer.isHighest ? (
                          <span className="text-[#8B8780]">Highest listed</span>
                        ) : (
                          <span className="text-[#8B8780]">&mdash;</span>
                        )}
                      </td>

                      <td className="px-5 py-4 text-right align-middle">
                        <StoreActionControl offer={offer} />
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>

          {/* Mobile Responsive Retailer Cards */}
          <div className="divide-y divide-[#F0EDE4]/80 overflow-hidden rounded-[20px] border border-[#E4DFCF]/80 bg-white/92 backdrop-blur-sm md:hidden">
            {combinedRows.map((offer, idx) => (
              <motion.div
                key={`${offer.retailer}-${offer.isUnavailablePlaceholder ? "missing" : "live"}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(idx * STAGGER.tight, 0.3), duration: DURATIONS.base }}
                className={cn(
                  "px-4 py-4",
                  offer.isLowestActive && "bg-[#F8FAF0]/70",
                  (!offer.inStock || offer.isUnavailablePlaceholder) && "opacity-80"
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-serif text-[17px] font-medium text-[#141311]">
                        {offer.retailer}
                      </h3>
                      {offer.isLowestActive && (
                        <span className="rounded-full border border-[#DCE5C0] bg-[#F6F8EA] px-2 py-0.5 font-mono text-[8px] font-medium uppercase tracking-[0.1em] text-[#4A5527]">
                          Best Deal
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[9px] text-[#8B8780]">
                      <span>{offer.storeTag || "Merchant"}</span>
                      <span>&middot;</span>
                      <span>
                        {offer.storeRating != null
                          ? `★ ${Number(offer.storeRating).toFixed(1)}`
                          : "Rating N/A"}
                      </span>
                      {offer.detectedVolume && (
                        <>
                          <span>&middot;</span>
                          <span className="text-[#75716B]">{offer.detectedVolume}</span>
                        </>
                      )}
                    </div>
                    {offer.matchedTitle && !offer.isUnavailablePlaceholder && (
                      <p
                        className="mt-1.5 line-clamp-2 text-[11px] text-[#75716B]"
                        title={offer.matchedTitle}
                      >
                        {offer.matchedTitle}
                      </p>
                    )}
                  </div>

                  <div className="shrink-0 text-right">
                    <div className="font-serif text-[18px] font-medium text-[#141311] tabular-nums">
                      {offer.displayPrice != null
                        ? formatPrice(offer.displayPrice, currency)
                        : "Unavailable"}
                    </div>
                    {offer.displayOriginalPrice != null &&
                      offer.displayOriginalPrice > (offer.displayPrice ?? 0) && (
                        <div className="font-mono text-[9.5px] text-[#8B8780] line-through tabular-nums">
                          {formatPrice(offer.displayOriginalPrice, currency)}
                        </div>
                      )}
                    {offer.discountPercent > 0 && (
                      <div className="font-mono text-[10px] font-medium text-[#6B5D33]">
                        &minus;{offer.discountPercent}%
                      </div>
                    )}
                  </div>
                </div>

                {offer.savingsAmount > 0 && offer.displayPrice != null && (
                  <p className="mt-2 font-mono text-[10px] font-medium text-[#4A5527] tabular-nums">
                    Save {formatPrice(offer.savingsAmount, currency)} ({offer.savingsPercent}% vs
                    highest)
                  </p>
                )}

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#F0EDE4]/80 pt-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <StockBadge
                      stockLabel={offer.stockLabel}
                      inStock={offer.inStock}
                      isUnavailablePlaceholder={offer.isUnavailablePlaceholder}
                    />
                    <span className="text-[10.5px] text-[#75716B]">
                      {offer.shippingInfo || "Shipping not disclosed"}
                    </span>
                  </div>

                  <StoreActionControl offer={offer} fullWidth />
                </div>
              </motion.div>
            ))}
          </div>
        </>
      )}

      {!exactVariantsOnly && (
        <div className="space-y-4 pt-1">
          <SecondaryVariantSection
            title="Variant unverified"
            subtitle="Retailer listings for this product line that omit explicit bottle size, SPF rating, pack count or formulation details — excluded from primary best-price and savings parity."
            items={unverifiedOffers}
            currency={currency}
            badgeText="Variant unverified"
            tone="amber"
            icon={AlertCircle}
          />

          <SecondaryVariantSection
            title="Other available variants"
            subtitle={`Alternative sizes, packs, SPF tiers or formulations kept separate from exact variant pricing${
              variantSummary?.targetVariant?.volume || variantSummary?.targetVariant?.formulationLabel
                ? ` (${[
                    variantSummary?.targetVariant?.formulationLabel,
                    variantSummary?.targetVariant?.spf?.toUpperCase(),
                    variantSummary?.targetVariant?.volume,
                  ]
                    .filter(Boolean)
                    .join(" · ")} primary SKU)`
                : ""
            }.`}
            items={otherVariants}
            currency={currency}
            badgeText="Other available variant"
            tone="neutral"
            icon={Layers}
          />
        </div>
      )}
    </motion.section>
  );
}

export default memo(PriceMatrix);
