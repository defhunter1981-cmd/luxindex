"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  X,
  Loader2,
  Clock,
  ArrowUpRight,
  Compass,
  Scale,
} from "lucide-react";
import {
  TRENDING_CATEGORIES,
  POPULAR_BRANDS,
} from "@/data/mockCatalog";
import { cn, formatPrice, convertCurrency, classifySearchQuery } from "@/lib/utils";
import { optimizeImageUrl } from "@/lib/imageUrl";

const DISCOVERY_QUICK_CATEGORIES = [
  "Sunscreen",
  "Moisturizer",
  "Serum",
  "Perfume",
  "Lip Balm",
  "Cleanser",
];

const HERO_PROOF = [
  { label: "Flagship retailers", value: "05" },
  { label: "Variant-verified matching", value: "Exact" },
  { label: "Real observed snapshots", value: "Only" },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.07, delayChildren: 0.12 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 14 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
  },
};

export default function SearchSection({
  inputValue,
  onInputChange,
  onSearchSubmit,
  onClear,
  trendingItems = [],
  recentSearches = [],
  onClearRecentSearches,
  activeProductId,
  onSelectTrending,
  currency = "INR",
  searchModePref = "auto",
  onSearchModePrefChange,
  isLoading,
}) {
  const inputRef = useRef(null);
  const formWrapperRef = useRef(null);
  const [activeCategory, setActiveCategory] = useState("All");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setShowSuggestions(false);
        return;
      }
      if (event.key !== "/") return;
      const target = event.target;
      const tag = target?.tagName?.toUpperCase();
      const isEditable =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable;

      if (!isEditable) {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setShowSuggestions(true);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    function handleOutsideClick(e) {
      if (
        formWrapperRef.current &&
        !formWrapperRef.current.contains(e.target)
      ) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const suggestions = useMemo(() => {
    const q = inputValue.trim().toLowerCase();
    if (!q) return trendingItems.slice(0, 5);

    const productMatches = trendingItems.filter((item) => {
      const text = `${item.name} ${item.brand} ${item.category} ${(item.tags || []).join(" ")} ${(item.aliases || []).join(" ")}`.toLowerCase();
      return text.includes(q);
    });

    if (productMatches.length > 0) {
      return productMatches.slice(0, 6);
    }

    return [];
  }, [inputValue, trendingItems]);

  const filteredTrending = useMemo(() => {
    if (activeCategory === "All") return trendingItems;
    return trendingItems.filter(
      (item) =>
        item.category === activeCategory ||
        (Array.isArray(item.tags) && item.tags.includes(activeCategory))
    );
  }, [trendingItems, activeCategory]);

  function handleFormSubmit(e) {
    e.preventDefault();
    if (!inputValue.trim() || isLoading) return;
    setShowSuggestions(false);
    onSearchSubmit(inputValue.trim());
  }

  const effectiveMode =
    searchModePref === "auto"
      ? classifySearchQuery(inputValue).recommendedMode
      : searchModePref;

  function handlePickSuggestion(item) {
    setShowSuggestions(false);
    onSelectTrending(item);
  }

  return (
    <motion.section
      initial="hidden"
      animate="visible"
      variants={containerVariants}
      className="relative isolate border-b border-[#E6E0D4]/40 pb-14 pt-14 sm:pb-18 sm:pt-18"
    >
      {/* Sunlit photographic backdrop (Unsplash License - rose-gold beauty flat-lay) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-24 -z-10 h-[560px] opacity-[0.35] [mask-image:linear-gradient(to_bottom,black_0%,rgba(0,0,0,0.5)_40%,transparent_78%)]"
        style={{
          backgroundImage:
            "url('https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=max&w=1600&q=55')",
          backgroundSize: "cover",
          backgroundPosition: "center 32%",
        }}
      />
      {/* Soft cream overlay keeps the headline readable */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-24 -z-10 h-[560px] bg-[linear-gradient(180deg,rgba(255,255,255,0.5)_0%,rgba(243,239,231,0.45)_36%,rgba(255,255,255,0.9)_66%,rgba(255,255,255,1)_92%)]"
      />

      {/* Ambient editorial wash */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-24 -z-10 h-[460px] bg-[radial-gradient(62%_72%_at_16%_0%,rgba(243,239,231,0.7)_0%,rgba(255,255,255,0)_64%),radial-gradient(42%_52%_at_86%_6%,rgba(230,224,212,0.5)_0%,rgba(255,255,255,0)_60%),radial-gradient(30%_40%_at_78%_8%,rgba(201,242,77,0.18)_0%,rgba(255,255,255,0)_55%)]"
      />

      {/* Editorial asymmetric hero — text left, campaign image + glass proof card right */}
      <div className="mx-auto grid max-w-6xl gap-10 px-5 sm:px-6 lg:grid-cols-[1.08fr_0.92fr] lg:items-center lg:gap-14 lg:px-10">
        <motion.div variants={itemVariants}>
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="h-px w-10 bg-gradient-to-r from-[#C9F24D] to-transparent"
            />
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-[#141311]">
              The Beauty Price Index
            </p>
            <span
              aria-hidden="true"
              className="h-px w-10 bg-gradient-to-l from-[#C9F24D] to-transparent"
            />
          </div>
          <h1 className="mt-5 font-serif text-[2.5rem] font-normal leading-[1.05] tracking-[-0.035em] text-[#141311] sm:text-[3.4rem] lg:text-[3.55rem] lux-serif-display">
            Every luxury formula,{" "}
            <span
              className="rounded px-2"
              style={{ backgroundColor: "#C9F24D", color: "#141311" }}
            >
              compared
            </span>{" "}
            with absolute clarity.
          </h1>
          <p className="mt-5 max-w-[48ch] text-[15px] leading-[1.75] text-[#75716B] sm:text-base">
            Verified pricing, stock availability, variant alignment and shipping
            terms across Sephora, Nykaa, Amazon Luxury, Cult Beauty and Space NK
            — with nothing invented, ever.
          </p>
        </motion.div>

        {/* Campaign image panel with glass proof card */}
        <motion.div
          variants={itemVariants}
          className="relative mx-auto w-full max-w-[440px] lg:max-w-none"
        >
          <div className="relative overflow-hidden rounded-[28px] border border-[#E6E0D4]/80 shadow-[0_36px_90px_-44px_rgba(20,19,17,0.5)]">
            <Image
              src="https://images.unsplash.com/photo-1526510747491-58f928ec870f?auto=format&fit=crop&w=880&h=1060&q=60"
              alt=""
              aria-hidden="true"
              width={880}
              height={1060}
              className="h-[380px] w-full object-cover sm:h-[470px] lg:h-[540px]"
            />
            {/* Warm cream + espresso blend for glass-card readability */}
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.14)_0%,rgba(255,255,255,0)_38%,rgba(20,19,17,0.34)_100%)]"
            />
            {/* Glass proof card */}
            <div className="absolute bottom-4 left-4 right-4 rounded-2xl border border-white/50 bg-white/60 p-4 shadow-[0_12px_40px_-18px_rgba(20,19,17,0.5)] backdrop-blur-md sm:bottom-5 sm:left-5 sm:right-auto sm:w-[272px]">
              <div className="space-y-2.5">
                {HERO_PROOF.map((item) => (
                  <div key={item.label} className="flex items-baseline gap-2.5">
                    <span className="font-serif text-[1.35rem] leading-none text-[#141311] lux-serif-display">
                      {item.value}
                    </span>
                    <span className="font-mono text-[9.5px] uppercase tracking-[0.13em] text-[#75716B]">
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Search Form with Autocomplete Suggestions */}
      <motion.div variants={itemVariants} ref={formWrapperRef} className="relative mt-9 mx-auto max-w-3xl px-5 sm:px-6 lg:px-10">
        <form
          onSubmit={handleFormSubmit}
          role="search"
          aria-label="Search beauty products by name, brand, or category"
        >
          <label htmlFor="luxe-product-search" className="sr-only">
            Search beauty or skincare product
          </label>
          <div
            className={cn(
              "flex flex-col gap-2.5 rounded-full border p-1.5 transition-all duration-400 ease-out sm:flex-row sm:gap-2",
              isFocused
                ? "border-[#8B8780]/40 bg-white shadow-[0_0_0_4px_rgba(201,242,77,0.08),0_24px_60px_-32px_rgba(201,242,77,0.2)]"
                : "border-[#E0DBCB]/80 bg-white/75 shadow-[0_24px_60px_-36px_rgba(26,24,21,0.35)]"
            )}
          >
            <div
              className={cn(
                "relative flex flex-1 items-center rounded-full border bg-white transition-colors duration-250 sm:border-0 sm:bg-transparent",
                isFocused ? "sm:border-0" : "border-[#E6E0D4]"
              )}
            >
              <Search
                className="ml-4 h-[17px] w-[17px] shrink-0 text-[#8B8780]"
                aria-hidden="true"
              />
              <input
                ref={inputRef}
                id="luxe-product-search"
                type="text"
                value={inputValue}
                onFocus={() => {
                  setIsFocused(true);
                  setShowSuggestions(true);
                }}
                onBlur={() => setIsFocused(false)}
                onChange={(e) => {
                  onInputChange(e.target.value);
                  setShowSuggestions(true);
                }}
                placeholder="Search a product, brand (COSRX, Dior) or category…"
                autoComplete="off"
                className="min-h-[50px] w-full bg-transparent px-3 py-2.5 text-[15px] text-[#141311] placeholder:text-[#8B8780] focus:outline-none sm:text-base"
              />
              {inputValue ? (
                <button
                  type="button"
                  onClick={() => {
                    onClear();
                    inputRef.current?.focus();
                    setShowSuggestions(true);
                  }}
                  aria-label="Clear search query"
                  className="mr-2 flex h-8 w-8 items-center justify-center rounded-full text-[#75716B] transition-colors duration-150 hover:bg-[#EEF0DD] hover:text-[#141311] focus-visible:outline-2 focus-visible:outline-[#141311]"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : (
                <kbd
                  className="mr-3 hidden shrink-0 rounded-md border border-[#E6E0D4] bg-[#F0EDE4] px-2 py-1 font-mono text-[10px] text-[#8B8780] sm:inline-flex"
                  title="Press / to focus search"
                >
                  /
                </kbd>
              )}
            </div>

            <motion.button
              type="submit"
              disabled={isLoading || !inputValue.trim()}
              whileHover={{ scale: 1.015 }}
              whileTap={{ scale: 0.97 }}
              className={cn(
                "inline-flex min-h-[50px] shrink-0 items-center justify-center gap-2 rounded-full border px-7 text-[14px] transition-all duration-300 ease-out lux-serif-display",
                isLoading || !inputValue.trim()
                  ? "border-[#141311]/20 bg-[#141311]/20 text-white/50 cursor-not-allowed"
                  : "border-[#141311] bg-[#141311] text-[#FFFFFF] hover:border-[#000000] hover:bg-[#000000] hover:shadow-[0_6px_28px_rgba(20,19,17,0.45)]"
              )}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Indexing</span>
                </>
              ) : effectiveMode === "discover" ? (
                <span>Discover</span>
              ) : (
                <span>Compare</span>
              )}
            </motion.button>
          </div>

          {onSearchModePrefChange && (
            <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 px-1">
              <div
                role="group"
                aria-label="Search engine mode"
                className="inline-flex flex-wrap items-center gap-1.5"
              >
                {[
                  { id: "auto", label: "Auto-Detect" },
                  { id: "discover", label: "Mode A · Discover" },
                  { id: "compare", label: "Mode B · Exact SKU" },
                ].map((opt) => {
                  const selected = searchModePref === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => onSearchModePrefChange(opt.id)}
                      aria-pressed={selected}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] transition-all duration-200",
                        selected
                          ? "border-[#141311] bg-[#141311] text-[#FFFFFF]"
                          : "border-transparent bg-transparent text-[#75716B] hover:border-[#E0DBCB] hover:bg-white hover:text-[#141311]"
                      )}
                    >
                      {opt.id === "discover" && (
                        <Compass className="h-3 w-3" aria-hidden="true" />
                      )}
                      {opt.id === "compare" && (
                        <Scale className="h-3 w-3" aria-hidden="true" />
                      )}
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              {inputValue.trim() && searchModePref === "auto" && (
                <span className="font-mono text-[10px] text-[#75716B]">
                  Routing as{" "}
                  <strong className="font-medium text-[#141311]">
                    {effectiveMode === "discover"
                      ? "Category / Brand Discovery"
                      : "Exact Product Comparison"}
                  </strong>
                </span>
              )}
            </div>
          )}
        </form>

        {/* Suggestion Dropdown */}
        <AnimatePresence>
          {showSuggestions && suggestions.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              role="listbox"
              aria-label="Suggested products"
              className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-2xl border border-[#ECD9CE] bg-white shadow-[0_32px_72px_-36px_rgba(26,24,21,0.45)]"
            >
              <div className="border-b border-[#EEEAE1] bg-[#FFFFFF]/95 px-4 py-2 font-mono text-[9.5px] uppercase tracking-[0.18em] text-[#75716B]">
                Matching Curated &amp; Live Queries
              </div>
              <ul className="divide-y divide-[#F0EDE4]">
                {suggestions.map((item, idx) => {
                  const lowestCurated = Math.min(
                    ...item.offers.filter((o) => o.inStock).map((o) => o.price)
                  );
                  const convertedLow = convertCurrency(
                    lowestCurated,
                    "INR",
                    currency
                  );
                  return (
                    <motion.li
                      key={item.id}
                      role="option"
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: Math.min(idx * 0.035, 0.3), duration: 0.2 }}
                    >
                      <button
                        type="button"
                        onClick={() => handlePickSuggestion(item)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[#EEF0DD]"
                      >
                        <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-xl border border-[#EEEAE1] bg-[#F3EFE7]">
                          {item.image ? (
                            <Image
                              src={optimizeImageUrl(item.image, 80)}
                              alt=""
                              fill
                              sizes="40px"
                              className="object-contain p-1.5"
                            />
                          ) : null}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-[#141311]">
                            {item.name}
                          </p>
                          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-[#75716B]">
                            {item.brand} &middot; {item.category}
                          </p>
                        </div>
                        <span className="shrink-0 font-mono text-xs font-medium text-[#141311] tabular-nums">
                          from {formatPrice(convertedLow, currency)}
                        </span>
                      </button>
                    </motion.li>
                  );
                })}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Recent Searches */}
      <AnimatePresence>
        {recentSearches.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="mt-4 flex flex-wrap items-center gap-2 px-5 sm:px-6 lg:px-10"
          >
            <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[#75716B]">
              <Clock className="h-3 w-3" aria-hidden="true" />
              Recent
            </span>
            {recentSearches.map((q) => (
              <motion.button
                key={q}
                type="button"
                onClick={() => {
                  onInputChange(q);
                  onSearchSubmit(q);
                }}
                whileHover={{ scale: 1.04 }}
                className="rounded-full border border-[#E6E0D4]/70 bg-white/70 px-3 py-1 text-xs text-[#2B2A26] transition-colors hover:border-[#8B8780]/50 hover:bg-[#EEF0DD] hover:text-[#141311]"
              >
                {q}
              </motion.button>
            ))}
            <button
              type="button"
              onClick={onClearRecentSearches}
              className="ml-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[#75716B] underline-offset-2 hover:text-[#141311] hover:underline"
            >
              Clear
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Quick Multi-Brand Category Discovery */}
      <motion.div variants={itemVariants} className="mt-5 flex flex-wrap items-center gap-1.5 px-5 sm:px-6 lg:px-10">
        <span className="mr-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[#141311]">
          Discover
        </span>
        {DISCOVERY_QUICK_CATEGORIES.map((category, idx) => {
          const chipTints = [
            "border-[#E4EAC9] bg-[#EEF0DD] text-[#141311] hover:border-[#8B8780]/60 hover:bg-[#EEF0DD]",
            "border-[#EDE8D8] bg-[#F0EDE4] text-[#5C5340] hover:border-[#C9F24D]/50 hover:bg-[#F8EAD2]",
            "border-[#E4EAC9] bg-[#EEF0DD] text-[#3A3733] hover:border-[#3A3733]/50 hover:bg-[#EEF0DD]",
            "border-[#E4EAC9] bg-[#EEF0DD] text-[#141311] hover:border-[#8B8780]/70 hover:bg-[#EEF0DD]",
            "border-[#D6DFB8] bg-[#F0F3E2] text-[#4A5527] hover:border-[#8A9A68]/50 hover:bg-[#F6F8EA]",
            "border-[#E4EAC9] bg-[#F8EAD2] text-[#6B5D33] hover:border-[#C9F24D]/60 hover:bg-[#FBF1DC]",
          ];
          return (
          <motion.button
            key={category}
            type="button"
            whileHover={{ scale: 1.04, y: -1 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => {
              onInputChange(category);
              onSearchSubmit(category, "discover");
            }}
            className={`rounded-full border px-3 py-1.5 font-mono text-[11px] font-medium transition-all duration-200 hover:-translate-y-px ${chipTints[idx % chipTints.length]}`}
          >
            {category}
          </motion.button>
          );
        })}
      </motion.div>

      {/* Popular Beauty Brands */}
      <motion.div variants={itemVariants} className="mt-2.5 flex flex-wrap items-center gap-1.5 px-5 sm:px-6 lg:px-10">
        <span className="mr-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[#75716B]">
          Houses
        </span>
        {POPULAR_BRANDS.map((brand, idx) => {
          const houseTints = [
            "border-[#E4EAC9] bg-[#EEF0DD] text-[#141311] hover:border-[#8B8780]/70 hover:bg-[#EEF0DD]",
            "border-[#E4EAC9] bg-[#EEF0DD] text-[#141311] hover:border-[#8B8780]/60 hover:bg-[#EEF0DD]",
            "border-[#E4EAC9] bg-[#EEF0DD] text-[#3A3733] hover:border-[#3A3733]/50 hover:bg-[#EEF0DD]",
            "border-[#EDE8D8] bg-[#F0EDE4] text-[#5C5340] hover:border-[#C9F24D]/50 hover:bg-[#F8EAD2]",
            "border-[#D6DFB8] bg-[#F0F3E2] text-[#4A5527] hover:border-[#8A9A68]/50 hover:bg-[#F6F8EA]",
            "border-[#E4EAC9] bg-[#F8EAD2] text-[#6B5D33] hover:border-[#C9F24D]/60 hover:bg-[#FBF1DC]",
          ];
          return (
          <motion.button
            key={brand}
            type="button"
            whileHover={{ scale: 1.04, y: -1 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => {
              onInputChange(brand);
              onSearchSubmit(brand, "discover");
            }}
            className={`rounded-full border px-3 py-1.5 text-[11px] font-medium transition-all duration-200 hover:-translate-y-px ${houseTints[idx % houseTints.length]}`}
          >
            {brand}
          </motion.button>
          );
        })}
      </motion.div>

      {/* Trending Categories & Interactive Product Discovery Strip */}
      <motion.div variants={itemVariants} className="mt-12 border-t border-[#E6E0D4]/40 pt-10 px-5 sm:px-6 lg:px-10">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="flex items-center gap-2.5 font-mono text-[10px] uppercase tracking-[0.2em] text-[#141311]">
              <Image
                aria-hidden="true"
                src="https://images.unsplash.com/photo-1469259943454-aa100abba749?auto=format&fit=crop&w=96&h=96&q=55"
                alt=""
                width={24}
                height={24}
                className="h-6 w-6 rounded-full object-cover ring-1 ring-[#C9F24D]/50"
              />
              The Edit
            </p>
            <h2 className="mt-1.5 font-serif text-[1.9rem] font-normal tracking-[-0.025em] text-[#141311] sm:text-[2.1rem] lux-serif-display">
              Trending in the index
            </h2>
            <p className="mt-1 text-sm text-[#75716B]">
              Select a category, or launch an instant SKU parity check.
            </p>
          </div>

          <div
            role="tablist"
            aria-label="Trending beauty categories"
            className="flex flex-wrap gap-1.5"
          >
            {TRENDING_CATEGORIES.map((cat) => {
              const active = activeCategory === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveCategory(cat)}
                  className={cn(
                    "rounded-full px-3.5 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.07em] transition-all duration-200",
                    active
                      ? "bg-[#141311] text-[#FFFFFF] shadow-[0_2px_10px_rgba(20,19,17,0.3)]"
                      : "text-[#75716B] hover:bg-[#EEF0DD] hover:text-[#141311]"
                  )}
                >
                  {cat}
                </button>
              );
            })}
          </div>
        </div>

        <motion.div
          layout
          className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          {filteredTrending.map((item, idx) => {
            const isActive = item.id === activeProductId;
            const lowestInr = Math.min(
              ...item.offers.filter((o) => o.inStock).map((o) => o.price)
            );
            const displayLow = convertCurrency(lowestInr, "INR", currency);

            return (
              <motion.button
                key={item.id}
                type="button"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(idx * 0.055, 0.6), duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                whileHover={{ y: -4, transition: { duration: 0.2 } }}
                onClick={() => onSelectTrending(item)}
                className={cn(
                  "group relative flex flex-col rounded-[20px] border p-2.5 pb-3.5 text-left transition-all duration-300 ease-out",
                  isActive
                    ? "border-[#B8BCA6] bg-white ring-1 ring-[#8B8780]/40 shadow-[0_14px_44px_rgba(20,19,17,0.2)]"
                    : "border-[#E6E0D4]/70 bg-[#F9F1EA]/70 hover:border-[#8B8780]/45 hover:bg-white hover:shadow-[0_24px_56px_-28px_rgba(20,19,17,0.4)]"
                )}
              >
                {/* Inner product image panel */}
                <div className="relative aspect-square w-full overflow-hidden rounded-[14px] border border-[#F5EDE3] bg-white">
                  <Image
                    src={optimizeImageUrl(item.image, 320)}
                    alt={item.shortName || item.name}
                    fill
                    sizes="(max-width: 640px) 90vw, (max-width: 1024px) 45vw, 22vw"
                    className="object-contain p-6 transition-transform duration-500 ease-out group-hover:scale-[1.06]"
                  />
                </div>
                {/* Name + price row */}
                <div className="mt-3 min-w-0 px-1.5">
                  <p className="truncate font-mono text-[9px] uppercase tracking-[0.16em] text-[#141311]">
                    {item.brand}
                  </p>
                  <div className="mt-1 flex items-start justify-between gap-2.5">
                    <p className="line-clamp-2 font-serif text-[15px] leading-snug text-[#141311] lux-serif-display">
                      {item.shortName}
                    </p>
                    <span className="shrink-0 font-serif text-[15px] leading-snug text-[#141311] tabular-nums lux-serif-display">
                      {formatPrice(displayLow, currency)}
                    </span>
                  </div>
                  {/* Full-width pill CTA */}
                  <span
                    className={cn(
                      "mt-2.5 flex min-h-[38px] items-center justify-center gap-1.5 rounded-full text-[13px] transition-colors duration-300 lux-serif-display",
                      isActive
                        ? "bg-[#141311] text-[#FFFFFF]"
                        : "bg-[#EFE4D6] text-[#141311] group-hover:bg-[#141311] group-hover:text-[#FFFFFF]"
                    )}
                  >
                    Compare prices
                    <ArrowUpRight
                      className={cn(
                        "h-3.5 w-3.5 transition-all duration-300",
                        isActive
                          ? "text-[#FFFFFF]"
                          : "text-[#75716B] group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[#FFFFFF]"
                      )}
                      aria-hidden="true"
                    />
                  </span>
                </div>
              </motion.button>
            );
          })}
        </motion.div>
      </motion.div>
    </motion.section>
  );
}
