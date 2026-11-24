"use client";

import { memo, useMemo, useState } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Star,
  Store,
  ShieldCheck,
  Bookmark,
  BookmarkCheck,
  SlidersHorizontal,
} from "lucide-react";
import DiscoveryFilters from "@/components/DiscoveryFilters";
import { cn, formatPrice } from "@/lib/utils";
import { optimizeImageUrl } from "@/lib/imageUrl";
import { EASE, DURATIONS, STAGGER, SPRINGS } from "@/lib/motion";

const DISCOVERY_SORTS = [
  { id: "relevance", label: "Relevance" },
  { id: "price_asc", label: "Lowest Price" },
  { id: "price_desc", label: "Highest Price" },
  { id: "unit_price", label: "Best Unit Value" },
  { id: "rating", label: "Top Rated" },
  { id: "discount", label: "Highest Discount" },
];

const cardVariants = {
  hidden: { opacity: 0, y: 22 },
  visible: (i) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: Math.min(i * STAGGER.base, 0.5),
      duration: DURATIONS.slow,
      ease: EASE,
    },
  }),
  hover: {
    y: -6,
    transition: { duration: DURATIONS.fast, ease: EASE },
  },
};

const headerVariants = {
  hidden: { opacity: 0, y: 14 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: DURATIONS.slow, ease: EASE },
  },
};

function ProductThumb({ src, alt, brand }) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-[linear-gradient(165deg,#FBF6F1_0%,#F2E9DE_100%)] p-4 text-center">
        <span className="font-serif text-sm italic text-[#3A3733]">
          {brand}
        </span>
        <span className="mt-1.5 font-mono text-[8.5px] uppercase tracking-[0.22em] text-[#6B5D33]">
          Image unavailable
        </span>
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 300px"
      onError={() => setFailed(true)}
      className="object-contain p-5 transition-transform duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.09]"
    />
  );
}

function ProvenancePill({ label, isLive }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[8.5px] uppercase tracking-[0.14em] backdrop-blur",
        isLive
          ? "border-[#DCE5C0] bg-[#F6F8EA]/90 text-[#4A5527]"
          : "border-[#E8DFC8] bg-[#FAF7EF]/90 text-[#6B5D33]"
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "h-1 w-1 rounded-full",
          isLive ? "bg-[#5C6B2E]" : "bg-[#5C6B2E]"
        )}
      />
      {label}
    </span>
  );
}

function DiscoveryWorkspace({
  discoveryData,
  currency = "INR",
  sortBy = "relevance",
  onSortChange,
  filters,
  onUpdateFilters,
  onResetFilters,
  onSelectProduct,
  onPageChange,
  onRefresh,
  isRefreshing = false,
  watchlistIds = new Set(),
  onQuickWatch,
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);

  const products = useMemo(
    () => discoveryData?.products || [],
    [discoveryData?.products]
  );
  const facets = discoveryData?.facets || null;
  const pagination = discoveryData?.pagination || {
    page: 1,
    hasNextPage: false,
  };

  const filteredProducts = useMemo(() => {
    const minP =
      filters.minPrice !== "" && filters.minPrice != null
        ? parseFloat(filters.minPrice)
        : null;
    const maxP =
      filters.maxPrice !== "" && filters.maxPrice != null
        ? parseFloat(filters.maxPrice)
        : null;

    const list = products.filter((p) => {
      if (filters.brands?.length > 0 && !filters.brands.includes(p.brand)) return false;
      if (filters.categories?.length > 0 && !filters.categories.includes(p.category)) return false;
      if (filters.spf?.length > 0 && (!p.spf || !filters.spf.includes(p.spf))) return false;
      if (filters.sizes?.length > 0 && (!p.size || !filters.sizes.includes(p.size))) return false;
      if (filters.skinTypes?.length > 0 && !filters.skinTypes.some((s) => (p.skinTypes || []).includes(s))) return false;
      if (filters.ingredients?.length > 0 && !filters.ingredients.some((i) => (p.ingredients || []).includes(i))) return false;
      if (filters.productTypes?.length > 0 && !filters.productTypes.some((t) => (p.productTypes || []).includes(t))) return false;
      if (filters.finishes?.length > 0 && !filters.finishes.some((f) => (p.finishes || []).includes(f))) return false;
      if (filters.retailers?.length > 0 && !filters.retailers.some((r) => (p.retailers || []).includes(r))) return false;
      if (minP != null && Number.isFinite(minP) && p.lowestPrice < minP) return false;
      if (maxP != null && Number.isFinite(maxP) && p.lowestPrice > maxP) return false;
      if (filters.minRating > 0 && (typeof p.rating !== "number" || p.rating < filters.minRating)) return false;
      if (filters.inStockOnly && !p.inStock) return false;
      if (filters.discountOnly && (!p.maxDiscountPercent || p.maxDiscountPercent <= 0)) return false;
      return true;
    });

    if (sortBy === "price_asc") return [...list].sort((a, b) => (a.lowestPrice ?? Infinity) - (b.lowestPrice ?? Infinity));
    if (sortBy === "price_desc") return [...list].sort((a, b) => (b.lowestPrice ?? 0) - (a.lowestPrice ?? 0));
    if (sortBy === "unit_price") {
      return [...list].sort((a, b) => {
        const aKnown = typeof a.pricePer100Unit === "number";
        const bKnown = typeof b.pricePer100Unit === "number";
        if (aKnown !== bKnown) return aKnown ? -1 : 1;
        return (a.pricePer100Unit ?? Infinity) - (b.pricePer100Unit ?? Infinity);
      });
    }
    if (sortBy === "rating") return [...list].sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
    if (sortBy === "discount") return [...list].sort((a, b) => (b.maxDiscountPercent ?? 0) - (a.maxDiscountPercent ?? 0));
    return list;
  }, [products, filters, sortBy]);

  if (!discoveryData) return null;

  const provenanceLabel =
    discoveryData.dataSource === "CACHED_LIVE"
      ? "Cached Live Discovery"
      : discoveryData.dataSource === "LIVE_OBSERVED"
      ? "Live Observed Discovery"
      : "Curated Demo Baseline";

  const activeFilterCount =
    (filters.brands?.length || 0) +
    (filters.categories?.length || 0) +
    (filters.skinTypes?.length || 0) +
    (filters.ingredients?.length || 0) +
    (filters.productTypes?.length || 0) +
    (filters.finishes?.length || 0) +
    (filters.retailers?.length || 0) +
    (filters.spf?.length || 0) +
    (filters.sizes?.length || 0) +
    (filters.minRating > 0 ? 1 : 0) +
    (filters.inStockOnly ? 1 : 0) +
    (filters.discountOnly ? 1 : 0);

  return (
    <motion.section
      id="discovery-workspace"
      aria-label="Multi-brand product discovery results"
      className="space-y-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: DURATIONS.slow, ease: EASE }}
    >
      {/* Discovery Header */}
      <motion.div
        variants={headerVariants}
        initial="hidden"
        animate="visible"
        className="relative overflow-hidden rounded-[22px] border border-[#E4DFCF]/80 bg-white/85 p-5 shadow-[0_24px_70px_-48px_rgba(26,24,21,0.45)] backdrop-blur-sm sm:px-7 sm:py-6"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-24 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(201,242,77,0.16)_0%,rgba(250,248,245,0)_70%)]"
        />

        <div className="relative flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-[#141311]">
                Mode A &middot; Multi-Brand Discovery
              </span>
              <ProvenancePill
                label={provenanceLabel}
                isLive={Boolean(discoveryData.isLive)}
              />
              {discoveryData.activeProvider && (
                <span className="font-mono text-[9.5px] text-[#8B8780]">
                  via {discoveryData.activeProvider}
                </span>
              )}
            </div>

            <h2 className="mt-3 font-serif text-[1.85rem] font-normal leading-[1.12] tracking-[-0.028em] text-[#141311] sm:text-[2.15rem] lux-serif-display">
              Results for{" "}
              <span className="italic text-[#141311]">
                &ldquo;{discoveryData.query}&rdquo;
              </span>
            </h2>

            <p className="mt-2 font-mono text-[10.5px] text-[#75716B] tabular-nums">
              {filteredProducts.length} of {products.length} canonical products
              &middot; {facets?.brands?.length || 0} recognized brands
              {discoveryData.market?.gl
                ? ` · Market ${discoveryData.market.gl.toUpperCase()} (${discoveryData.market.hl || "en"})`
                : ""}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 self-start sm:self-auto">
            {discoveryData.freshness?.fetchedAt && (
              <span className="font-mono text-[10px] text-[#8B8780]">
                {discoveryData.cacheStatus === "HIT" && discoveryData.cachedAt
                  ? `Cached ${new Date(discoveryData.cachedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`
                  : `Fetched ${new Date(discoveryData.freshness.fetchedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`}
              </span>
            )}
            <motion.button
              type="button"
              onClick={onRefresh}
              disabled={isRefreshing}
              whileHover={isRefreshing ? undefined : { y: -1 }}
              whileTap={{ scale: 0.97 }}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-[#D8D4C6] bg-white px-3.5 py-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-[#141311] shadow-[0_1px_0_rgba(26,24,21,0.04)] transition-colors duration-200 hover:border-[#3A3733] hover:text-[#141311] disabled:opacity-50"
              title="Bypass discovery cache and fetch fresh live results"
            >
              <RefreshCw
                className={cn("h-3 w-3", isRefreshing && "animate-spin")}
                aria-hidden="true"
              />
              <span>{isRefreshing ? "Refreshing" : "Refresh"}</span>
            </motion.button>
          </div>
        </div>

        {/* Sort Bar */}
        <div className="relative mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#EFEDE2]/70 pt-4">
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-[#8B8780]">
              Sort
            </span>
            {DISCOVERY_SORTS.map((opt) => {
              const active = sortBy === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onSortChange(opt.id)}
                  aria-pressed={active}
                  className={cn(
                    "relative rounded-full px-2.5 py-1.5 text-[11px] font-medium transition-colors duration-200",
                    active
                      ? "text-[#FFFFFF]"
                      : "text-[#75716B] hover:bg-[#F0EDE4] hover:text-[#141311]"
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="discovery-sort-pill"
                      aria-hidden="true"
                      className="absolute inset-0 rounded-full bg-[#141311] shadow-[0_2px_10px_rgba(20,19,17,0.3)]"
                      transition={SPRINGS.snappy}
                    />
                  )}
                  <span className="relative z-10">{opt.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setFiltersOpen((v) => !v)}
              aria-expanded={filtersOpen}
              className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-[#D8D4C6] bg-white px-3 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[#141311] transition-colors hover:border-[#3A3733] lg:hidden"
            >
              <SlidersHorizontal className="h-3 w-3" aria-hidden="true" />
              Filters
              {activeFilterCount > 0 && (
                <span className="rounded-full bg-[#141311] px-1.5 py-0.5 text-[8.5px] text-[#FFFFFF]">
                  {activeFilterCount}
                </span>
              )}
            </button>
            <span className="hidden font-mono text-[10px] text-[#8B8780] md:inline">
              Select any SKU for exact retailer verification &rarr;
            </span>
          </div>
        </div>
      </motion.div>

      {/* Main Layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div
          className={cn(
            "lg:col-span-3",
            filtersOpen ? "block" : "hidden lg:block"
          )}
        >
          <DiscoveryFilters
            facets={facets}
            filters={filters}
            onUpdateFilters={onUpdateFilters}
            onResetFilters={onResetFilters}
            currency={currency}
          />
        </div>

        <div className="space-y-6 lg:col-span-9">
          {filteredProducts.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: DURATIONS.slow, ease: EASE }}
              className="relative overflow-hidden rounded-[22px] border border-[#E4DFCF]/80 bg-[linear-gradient(170deg,#FFFDFB_0%,#FAF5EF_100%)] px-6 py-20 text-center shadow-[0_24px_70px_-52px_rgba(26,24,21,0.5)]"
            >
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#8B8780]/40 to-transparent"
              />
              <span className="font-mono text-[9px] uppercase tracking-[0.26em] text-[#141311]">
                No matches
              </span>
              <p className="mt-4 font-serif text-[1.6rem] italic leading-tight text-[#141311]">
                Nothing matches these filters.
              </p>
              <p className="mx-auto mt-3 max-w-[48ch] text-[13.5px] leading-relaxed text-[#6F6B62]">
                Clear one or more attributes to view all {products.length}{" "}
                products found for &ldquo;{discoveryData.query}&rdquo;.
              </p>
              <motion.button
                type="button"
                onClick={onResetFilters}
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.98 }}
                className="mt-7 inline-flex items-center gap-1.5 rounded-full border border-[#141311] bg-[#141311] px-6 py-2.5 text-[13px] text-[#FFFFFF] transition-colors lux-serif-display hover:border-[#000000] hover:bg-[#000000]"
              >
                Reset Filters
              </motion.button>
            </motion.div>
          ) : (
            <motion.div
              layout
              className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3"
            >
              <AnimatePresence mode="popLayout">
                {filteredProducts.map((product, idx) => {
                  const isWatched = watchlistIds.has(product.id);
                  const multiOffer = (product.offerCount || 1) > 1;
                  const displayBadges = [
                    product.size,
                    product.spf,
                    ...(product.finishes || []).slice(0, 1),
                    ...(product.productTypes || []).slice(0, 1),
                  ].filter(Boolean);

                  return (
                    <motion.article
                      key={product.id}
                      custom={idx}
                      variants={cardVariants}
                      initial="hidden"
                      animate="visible"
                      exit={{
                        opacity: 0,
                        scale: 0.96,
                        transition: { duration: 0.2 },
                      }}
                      whileHover="hover"
                      className="group relative flex flex-col overflow-hidden rounded-[20px] border border-[#E6E0D4]/70 bg-[#F9F1EA]/80 shadow-[0_1px_2px_rgba(26,24,21,0.03)] transition-all duration-500 hover:border-[#D5D2C2] hover:bg-white hover:shadow-[0_28px_64px_-32px_rgba(20,19,17,0.35)]"
                    >
                      {/* Image area */}
                      <div className="relative aspect-[5/6] w-full overflow-hidden border-b border-[#F5EDE3] bg-white">
                        <ProductThumb
                          src={optimizeImageUrl(product.image, 600)}
                          alt={product.name}
                          brand={product.brand}
                        />

                        {/* Badges */}
                        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
                          <span
                            className={cn(
                              "rounded-full border px-2 py-0.5 font-mono text-[8px] uppercase tracking-[0.12em] backdrop-blur-md",
                              product.dataSource === "CURATED_DEMO"
                                ? "border-[#E8DFC8] bg-[#FAF7EF]/92 text-[#6B5D33]"
                                : "border-[#DCE5C0] bg-[#F6F8EA]/92 text-[#4A5527]"
                            )}
                          >
                            {product.dataSource === "CACHED_LIVE"
                              ? "Cached Live"
                              : product.dataSource === "LIVE_OBSERVED"
                              ? "Live Feed"
                              : "Demo"}
                          </span>
                          {product.maxDiscountPercent > 0 && (
                            <span className="rounded-full border border-[#E3DFD2] bg-white/92 px-2 py-0.5 font-mono text-[8px] font-semibold text-[#141311] backdrop-blur-md">
                              &minus;{product.maxDiscountPercent}%
                            </span>
                          )}
                        </div>

                        {/* Watch button */}
                        {onQuickWatch && (
                          <motion.button
                            type="button"
                            onClick={() => onQuickWatch(product)}
                            whileHover={{ scale: 1.09 }}
                            whileTap={{ scale: 0.92 }}
                            aria-label={
                              isWatched
                                ? `Saved ${product.name}`
                                : `Save ${product.name} to Watchlist`
                            }
                            className={cn(
                              "absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full border shadow-[0_2px_8px_rgba(26,24,21,0.08)] backdrop-blur-md transition-colors duration-200",
                              isWatched
                                ? "border-[#141311] bg-[#141311] text-[#FFFFFF]"
                                : "border-[#E4DFCF] bg-white/90 text-[#75716B] hover:border-[#3A3733] hover:text-[#141311]"
                            )}
                          >
                            {isWatched ? (
                              <BookmarkCheck className="h-3.5 w-3.5" />
                            ) : (
                              <Bookmark className="h-3.5 w-3.5" />
                            )}
                          </motion.button>
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex flex-1 flex-col p-4">
                        {/* Brand + Rating */}
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate font-mono text-[9px] font-medium uppercase tracking-[0.2em] text-[#141311]">
                            {product.brand}
                          </p>
                          {product.rating != null && (
                            <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[10.5px] text-[#75716B] tabular-nums">
                              <Star className="h-3 w-3 fill-[#A8AC96] text-[#A8AC96]" />
                              {Number(product.rating).toFixed(1)}
                            </span>
                          )}
                        </div>

                        {/* Product name */}
                        <h3 className="mt-1.5 line-clamp-2 font-serif text-[16.5px] font-normal leading-snug tracking-[-0.012em] text-[#141311] transition-colors duration-200 group-hover:text-[#141311]">
                          {product.name}
                        </h3>

                        {/* Category */}
                        <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-[#8B8780]">
                          {product.category}
                        </p>

                        {/* Spec badges */}
                        {displayBadges.length > 0 && (
                          <div className="mt-2.5 flex flex-wrap gap-1">
                            {displayBadges.slice(0, 4).map((badge) => (
                              <span
                                key={badge}
                                className="rounded-full border border-[#EEEAE1]/90 bg-[#F0EDE4]/90 px-2 py-0.5 font-mono text-[8.5px] text-[#75716B]"
                              >
                                {badge}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Actives */}
                        {product.ingredients?.length > 0 && (
                          <p className="mt-2 truncate font-mono text-[9px] text-[#8B8780]">
                            Actives: {product.ingredients.slice(0, 3).join(", ")}
                          </p>
                        )}

                        {/* Price & CTA */}
                        <div className="mt-auto pt-4">
                          <div className="flex items-baseline justify-between gap-2 border-t border-[#EEEAE1]/60 pt-3.5">
                            <div>
                              <span className="font-serif text-[22px] text-[#141311] tabular-nums transition-colors duration-200 group-hover:text-[#141311]">
                                {formatPrice(product.lowestPrice, currency)}
                              </span>
                              {multiOffer &&
                                product.highestPrice > product.lowestPrice && (
                                  <span className="ml-1.5 font-mono text-[10px] text-[#8B8780] tabular-nums">
                                    &ndash; {formatPrice(product.highestPrice, currency)}
                                  </span>
                                )}
                            </div>
                            {product.pricePer100Unit != null && product.unitLabel && (
                              <span className="font-mono text-[8.5px] text-[#8B8780] tabular-nums">
                                {formatPrice(product.pricePer100Unit, currency)}{" "}
                                {product.unitLabel}
                              </span>
                            )}
                          </div>

                          {/* Retailers */}
                          <div className="mt-2 flex flex-wrap items-center gap-1.5 font-mono text-[9px] text-[#75716B]">
                            <Store className="h-3 w-3 shrink-0" aria-hidden="true" />
                            <span className="truncate">
                              {product.retailers?.slice(0, 2).join(", ")}
                              {(product.retailers?.length || 0) > 2
                                ? ` +${product.retailers.length - 2}`
                                : ""}
                            </span>
                            {product.matchConfidence === "exact" && (
                              <span className="ml-auto inline-flex items-center gap-0.5 text-[#4A5527]">
                                <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                                Exact
                              </span>
                            )}
                          </div>

                          <motion.button
                            type="button"
                            onClick={() => onSelectProduct(product)}
                            whileTap={{ scale: 0.98 }}
                            className="mt-3.5 inline-flex min-h-[40px] w-full items-center justify-center gap-1.5 overflow-hidden rounded-full border border-[#141311] bg-[#141311] px-3 py-2 text-[13px] text-[#FFFFFF] transition-all duration-300 lux-serif-display hover:border-[#000000] hover:bg-[#000000] hover:shadow-[0_6px_24px_-6px_rgba(20,19,17,0.55)]"
                          >
                            <span>Compare Retailers</span>
                            <ArrowRight
                              className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-0.5"
                              aria-hidden="true"
                            />
                          </motion.button>
                        </div>
                      </div>
                    </motion.article>
                  );
                })}
              </AnimatePresence>
            </motion.div>
          )}

          {/* Pagination */}
          <AnimatePresence>
            {(pagination.page > 1 || pagination.hasNextPage) && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center justify-between rounded-[18px] border border-[#E4DFCF]/80 bg-white/85 px-4 py-3 backdrop-blur-sm"
              >
                <button
                  type="button"
                  disabled={pagination.page <= 1}
                  onClick={() => onPageChange(pagination.page - 1)}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-[#D8D4C6] bg-white px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[#141311] transition-colors hover:border-[#141311] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  <span>Previous</span>
                </button>

                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#8B8780] tabular-nums">
                  Page {pagination.page}
                </span>

                <button
                  type="button"
                  disabled={!pagination.hasNextPage}
                  onClick={() => onPageChange(pagination.page + 1)}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-[#D8D4C6] bg-white px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[#141311] transition-colors hover:border-[#141311] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span>Next</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.section>
  );
}

export default memo(DiscoveryWorkspace);
