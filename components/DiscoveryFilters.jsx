"use client";

import { memo, useState } from "react";
import { SlidersHorizontal, RotateCcw, ChevronDown, ChevronUp } from "lucide-react";
import { cn, formatPrice } from "@/lib/utils";

function FilterFacetGroup({
  title,
  options = [],
  selected = [],
  onToggle,
  initialLimit = 8,
}) {
  const [expanded, setExpanded] = useState(false);
  if (!Array.isArray(options) || options.length === 0) return null;

  const visibleOptions = expanded ? options : options.slice(0, initialLimit);
  const hasMore = options.length > initialLimit;

  return (
    <div className="border-b border-[#EEEAE1]/60 py-4 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-[#75716B]">
          {title}
        </span>
        {selected.length > 0 && (
          <span className="rounded-full bg-[#EFEDE2] px-1.5 py-0.5 font-mono text-[9px] font-medium text-[#141311] tabular-nums">
            {selected.length}
          </span>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {visibleOptions.map((opt) => {
          const isSelected = selected.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onToggle(opt.value)}
              aria-pressed={isSelected}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all duration-200",
                isSelected
                  ? "border-[#141311] bg-[#141311] text-[#FFFFFF] shadow-[0_2px_8px_rgba(20,19,17,0.3)]"
                  : "border-[#E6E0D4]/80 bg-[#FFFFFF]/80 text-[#75716B] hover:border-[#9AA08A] hover:bg-white hover:text-[#141311]"
              )}
            >
              <span>{opt.value}</span>
              <span
                className={cn(
                  "font-mono text-[9px] tabular-nums",
                  isSelected ? "text-[#FFFFFF]/70" : "text-[#8B8780]"
                )}
              >
                {opt.count}
              </span>
            </button>
          );
        })}
      </div>

      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="mt-2.5 font-mono text-[10px] text-[#141311] underline-offset-2 hover:underline"
        >
          {expanded ? "Show fewer" : `+${options.length - initialLimit} more`}
        </button>
      )}
    </div>
  );
}

function DiscoveryFilters({
  facets,
  filters,
  onUpdateFilters,
  onResetFilters,
  currency = "INR",
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  if (!facets) return null;

  const toggleMulti = (field, value) => {
    const current = Array.isArray(filters[field]) ? filters[field] : [];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    onUpdateFilters({ ...filters, [field]: next });
  };

  const activeFilterCount =
    (filters.brands?.length || 0) +
    (filters.categories?.length || 0) +
    (filters.spf?.length || 0) +
    (filters.sizes?.length || 0) +
    (filters.skinTypes?.length || 0) +
    (filters.ingredients?.length || 0) +
    (filters.productTypes?.length || 0) +
    (filters.finishes?.length || 0) +
    (filters.retailers?.length || 0) +
    (filters.minPrice !== "" && filters.minPrice != null ? 1 : 0) +
    (filters.maxPrice !== "" && filters.maxPrice != null ? 1 : 0) +
    (filters.minRating > 0 ? 1 : 0) +
    (filters.inStockOnly ? 1 : 0) +
    (filters.discountOnly ? 1 : 0);

  return (
    <aside
      aria-label="Discovery attribute filters"
      className="overflow-hidden rounded-2xl border border-[#E6E0D4]/70 bg-white/90 backdrop-blur-sm lg:sticky lg:top-[84px]"
    >
      <div className="flex items-center justify-between gap-2 border-b border-[#EEEAE1]/60 bg-[#FFFFFF]/80 px-4 py-3.5">
        <div className="flex items-center gap-2">
          <SlidersHorizontal
            className="h-3.5 w-3.5 text-[#141311]"
            aria-hidden="true"
          />
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-[#141311]">
            Refine
          </span>
          {activeFilterCount > 0 && (
            <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#3A3733] px-1 font-mono text-[9px] font-semibold text-white tabular-nums">
              {activeFilterCount}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={onResetFilters}
              className="inline-flex items-center gap-1 font-mono text-[9.5px] uppercase tracking-[0.1em] text-[#141311] hover:underline"
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              <span>Reset</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setMobileOpen((prev) => !prev)}
            className="inline-flex items-center gap-1 rounded-full border border-[#E0DBCB] bg-white px-2.5 py-1 font-mono text-[10px] text-[#141311] lg:hidden"
          >
            <span>{mobileOpen ? "Hide" : "Show"}</span>
            {mobileOpen ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </button>
        </div>
      </div>

      <div
        className={cn(
          "px-4 py-1 transition-all duration-300",
          mobileOpen ? "block" : "hidden lg:block"
        )}
      >
        {/* Price Bounds */}
        {facets.priceRange?.max > facets.priceRange?.min && (
          <div className="border-b border-[#EEEAE1]/60 py-4">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-[#75716B]">
                Price Range
              </span>
              <span className="font-mono text-[9.5px] text-[#8B8780] tabular-nums">
                {formatPrice(facets.priceRange.min, currency)} &ndash;{" "}
                {formatPrice(facets.priceRange.max, currency)}
              </span>
            </div>
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              <input
                type="number"
                min="0"
                placeholder={`Min ${facets.priceRange.min}`}
                aria-label="Minimum price filter"
                value={filters.minPrice ?? ""}
                onChange={(e) =>
                  onUpdateFilters({ ...filters, minPrice: e.target.value })
                }
                className="min-h-[36px] w-full rounded-lg border border-[#E0DBCB] bg-[#FFFFFF] px-2.5 font-mono text-xs text-[#141311] transition-colors focus:border-[#3A3733] focus:bg-white focus:outline-none"
              />
              <input
                type="number"
                min="0"
                placeholder={`Max ${facets.priceRange.max}`}
                aria-label="Maximum price filter"
                value={filters.maxPrice ?? ""}
                onChange={(e) =>
                  onUpdateFilters({ ...filters, maxPrice: e.target.value })
                }
                className="min-h-[36px] w-full rounded-lg border border-[#E0DBCB] bg-[#FFFFFF] px-2.5 font-mono text-xs text-[#141311] transition-colors focus:border-[#3A3733] focus:bg-white focus:outline-none"
              />
            </div>
          </div>
        )}

        {/* Availability, Discount & Rating Quick Toggles */}
        {(facets.inStockCount > 0 ||
          facets.discountedCount > 0 ||
          facets.ratedCount > 0) && (
          <div className="space-y-2.5 border-b border-[#EEEAE1]/60 py-4">
            <span className="block font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-[#75716B]">
              Availability &amp; Signals
            </span>
            <div className="flex flex-wrap gap-1.5">
              {facets.inStockCount > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    onUpdateFilters({
                      ...filters,
                      inStockOnly: !filters.inStockOnly,
                    })
                  }
                  aria-pressed={Boolean(filters.inStockOnly)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all duration-200",
                    filters.inStockOnly
                      ? "border-[#141311] bg-[#141311] text-[#FFFFFF] shadow-[0_2px_8px_rgba(20,19,17,0.3)]"
                      : "border-[#E6E0D4]/80 bg-[#FFFFFF]/80 text-[#75716B] hover:border-[#9AA08A] hover:bg-white"
                  )}
                >
                  In Stock ({facets.inStockCount})
                </button>
              )}

              {facets.discountedCount > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    onUpdateFilters({
                      ...filters,
                      discountOnly: !filters.discountOnly,
                    })
                  }
                  aria-pressed={Boolean(filters.discountOnly)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all duration-200",
                    filters.discountOnly
                      ? "border-[#141311] bg-[#141311] text-[#FFFFFF] shadow-[0_2px_8px_rgba(20,19,17,0.3)]"
                      : "border-[#E6E0D4]/80 bg-[#FFFFFF]/80 text-[#75716B] hover:border-[#9AA08A] hover:bg-white"
                  )}
                >
                  On Discount ({facets.discountedCount})
                </button>
              )}

              {facets.ratedCount > 0 && (
                <>
                  {[4.0, 4.5].map((threshold) => {
                    const active = filters.minRating === threshold;
                    return (
                      <button
                        key={threshold}
                        type="button"
                        onClick={() =>
                          onUpdateFilters({
                            ...filters,
                            minRating: active ? 0 : threshold,
                          })
                        }
                        aria-pressed={active}
                        className={cn(
                          "rounded-full border px-2.5 py-1 font-mono text-[11px] font-medium transition-all duration-200",
                          active
                            ? "border-[#141311] bg-[#141311] text-[#FFFFFF] shadow-[0_2px_8px_rgba(20,19,17,0.3)]"
                            : "border-[#E6E0D4]/80 bg-[#FFFFFF]/80 text-[#75716B] hover:border-[#9AA08A] hover:bg-white"
                        )}
                      >
                        &ge; {threshold.toFixed(1)}&#9733;
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          </div>
        )}

        <FilterFacetGroup
          title="Brands"
          options={facets.brands}
          selected={filters.brands || []}
          onToggle={(v) => toggleMulti("brands", v)}
          initialLimit={6}
        />
        <FilterFacetGroup
          title="SPF Protection"
          options={facets.spf}
          selected={filters.spf || []}
          onToggle={(v) => toggleMulti("spf", v)}
        />
        <FilterFacetGroup
          title="Product Size"
          options={facets.sizes}
          selected={filters.sizes || []}
          onToggle={(v) => toggleMulti("sizes", v)}
        />
        <FilterFacetGroup
          title="Category"
          options={facets.categories}
          selected={filters.categories || []}
          onToggle={(v) => toggleMulti("categories", v)}
        />
        <FilterFacetGroup
          title="Product Type"
          options={facets.productTypes}
          selected={filters.productTypes || []}
          onToggle={(v) => toggleMulti("productTypes", v)}
        />
        <FilterFacetGroup
          title="Finish"
          options={facets.finishes}
          selected={filters.finishes || []}
          onToggle={(v) => toggleMulti("finishes", v)}
        />
        <FilterFacetGroup
          title="Key Ingredients"
          options={facets.ingredients}
          selected={filters.ingredients || []}
          onToggle={(v) => toggleMulti("ingredients", v)}
        />
        <FilterFacetGroup
          title="Skin Type"
          options={facets.skinTypes}
          selected={filters.skinTypes || []}
          onToggle={(v) => toggleMulti("skinTypes", v)}
        />
        <FilterFacetGroup
          title="Retailer Coverage"
          options={facets.retailers}
          selected={filters.retailers || []}
          onToggle={(v) => toggleMulti("retailers", v)}
        />
      </div>
    </aside>
  );
}

export default memo(DiscoveryFilters);
