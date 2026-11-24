"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { MotionConfig, motion, AnimatePresence } from "framer-motion";
import { AlertCircle, ArrowLeft, ArrowRight, ArrowUp, Bell } from "lucide-react";
import FernhollowHero from "@/components/FernhollowHero";
import Navbar from "@/components/Navbar";
import SearchSection from "@/components/SearchSection";
import DiscoveryWorkspace from "@/components/DiscoveryWorkspace";
import EditorialSections from "@/components/EditorialSections";
import ProductHeader from "@/components/ProductHeader";
import PriceMatrix from "@/components/PriceMatrix";
import DealIntelligencePanel from "@/components/DealIntelligencePanel";
import WatchlistDrawer from "@/components/WatchlistDrawer";
import SkeletonLoader from "@/components/SkeletonLoader";
import { mockCatalog, TARGET_RETAILERS, buildRetailerSearchUrl } from "@/data/mockCatalog";
import {
  computeOfferAnalytics,
  sortOffers,
  convertCurrency,
  formatPrice,
  classifySearchQuery,
} from "@/lib/utils";
import {
  getWatchlist,
  upsertWatchItem,
  removeWatchItem,
  getRecentSearches,
  pushRecentSearch,
  clearRecentSearches,
  getComparisonHistory,
  pushComparisonHistory,
  recordClientLiveObservation,
  getClientLiveObservations,
} from "@/lib/watchlist";

const DEFAULT_PRODUCT = mockCatalog[0];

const DEFAULT_DISCOVERY_FILTERS = {
  brands: [],
  categories: [],
  spf: [],
  sizes: [],
  skinTypes: [],
  ingredients: [],
  productTypes: [],
  finishes: [],
  retailers: [],
  minPrice: "",
  maxPrice: "",
  minRating: 0,
  inStockOnly: false,
  discountOnly: false,
};

function buildInitialState() {
  return {
    isLive: false,
    mode: "curated",
    dataSource: "CURATED_DEMO",
    cacheStatus: "BYPASS",
    fallbackReason: null,
    historySource: "CURATED_DEMO",
    sourceCurrency: "INR",
    priceIntelligence: null,
    activeProductIdParam: null,
    productIdentity: {
      confidence: "exact",
      isBroadQuery: false,
      detectedVolume: DEFAULT_PRODUCT.volume,
      excludedMismatchCount: 0,
      warning: null,
    },
    flagshipCoverage: TARGET_RETAILERS.map((retailer) => {
      const offer = DEFAULT_PRODUCT.offers.find((o) => o.retailer === retailer);
      return {
        retailer,
        available: Boolean(offer),
        inStock: offer ? offer.inStock : false,
        price: offer ? offer.price : null,
        currency: offer ? offer.currency : null,
        storeUrl:
          offer?.storeUrl || buildRetailerSearchUrl(retailer, DEFAULT_PRODUCT.name),
      };
    }),
    product: {
      id: DEFAULT_PRODUCT.id,
      name: DEFAULT_PRODUCT.name,
      shortName: DEFAULT_PRODUCT.shortName,
      brand: DEFAULT_PRODUCT.brand,
      category: DEFAULT_PRODUCT.category,
      volume: DEFAULT_PRODUCT.volume,
      variant: DEFAULT_PRODUCT.variant,
      rating: DEFAULT_PRODUCT.rating,
      reviewCount: DEFAULT_PRODUCT.reviewCount,
      description: DEFAULT_PRODUCT.description,
      keyNotes: DEFAULT_PRODUCT.keyNotes,
      image: DEFAULT_PRODUCT.image,
      dataSource: "CURATED_DEMO",
      lastUpdated: null,
    },
    offers: DEFAULT_PRODUCT.offers,
    unverifiedOffers: [],
    otherVariants: [],
    variantSummary: null,
    priceHistory: DEFAULT_PRODUCT.priceHistory,
  };
}

export default function HomePage() {
  const [currency, setCurrency] = useState("INR");
  const [inputValue, setInputValue] = useState(DEFAULT_PRODUCT.name);
  const [sortBy, setSortBy] = useState("price");
  const [hideOutOfStock, setHideOutOfStock] = useState(false);
  const [targetRetailersOnly, setTargetRetailersOnly] = useState(false);
  const [exactVariantsOnly, setExactVariantsOnly] = useState(false);

  const [comparisonData, setComparisonData] = useState(buildInitialState);
  const [activeMode, setActiveMode] = useState("compare"); // "discover" | "compare"
  const [searchModePref, setSearchModePref] = useState("auto"); // "auto" | "discover" | "compare"
  const [discoveryData, setDiscoveryData] = useState(null);
  const [discoverySortBy, setDiscoverySortBy] = useState("relevance");
  const [discoveryFilters, setDiscoveryFilters] = useState(
    DEFAULT_DISCOVERY_FILTERS
  );
  const [cameFromDiscovery, setCameFromDiscovery] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorState, setErrorState] = useState(null);

  const [watchlist, setWatchlist] = useState([]);
  const [recentSearches, setRecentSearches] = useState([]);
  const [comparisonHistory, setComparisonHistory] = useState([]);
  const [isWatchlistOpen, setIsWatchlistOpen] = useState(false);

  const abortControllerRef = useRef(null);

  const applySuccessPayload = useCallback(
    (payload, targetCurrency, recordedQuery, activeProductIdParam = null) => {
      const resolvedIsLive =
        typeof payload.isLive === "boolean"
          ? payload.isLive
          : payload.mode === "live";

      let resolvedHistory = payload.priceHistory || [];
      if (
        resolvedIsLive &&
        payload.product?.id &&
        payload.summary?.bestPrice != null
      ) {
        const clientKey = `${payload.product.id}::${payload.baseCurrency || targetCurrency}`;
        const bestBasePrice = convertCurrency(
          payload.summary.bestPrice,
          targetCurrency,
          payload.baseCurrency || targetCurrency
        );
        const clientObs = recordClientLiveObservation(clientKey, {
          timestamp: payload.updatedAt || new Date().toISOString(),
          date: new Intl.DateTimeFormat("en-US", {
            month: "short",
            day: "2-digit",
          }).format(new Date()),
          price: bestBasePrice,
          currency: payload.baseCurrency || targetCurrency,
          bestRetailer: payload.summary.bestStore,
        });

        if (clientObs.length > resolvedHistory.length) {
          resolvedHistory = clientObs;
        } else if (resolvedHistory.length === 0) {
          resolvedHistory = getClientLiveObservations(clientKey);
        }
      }

      setComparisonData({
        isLive: resolvedIsLive,
        mode: payload.mode || (resolvedIsLive ? "live" : "curated"),
        dataSource:
          payload.dataSource ||
          (resolvedIsLive
            ? payload.cacheStatus === "HIT"
              ? "CACHED_LIVE"
              : "LIVE_OBSERVED"
            : "CURATED_DEMO"),
        cacheStatus: payload.cacheStatus || "BYPASS",
        fallbackReason: payload.fallbackReason || null,
        historySource:
          payload.historySource ||
          (resolvedIsLive ? "LIVE_OBSERVED" : "CURATED_DEMO"),
        sourceCurrency:
          payload.baseCurrency || payload.currency || targetCurrency,
        priceIntelligence: payload.priceIntelligence || null,
        activeProductIdParam,
        productIdentity: payload.productIdentity || null,
        variantSummary: payload.variantSummary || null,
        flagshipCoverage: payload.flagshipCoverage || [],
        product: payload.product,
        offers: payload.offers || [],
        unverifiedOffers: payload.unverifiedOffers || [],
        otherVariants: payload.otherVariants || [],
        priceHistory: resolvedHistory,
      });

      if (recordedQuery) {
        setRecentSearches(pushRecentSearch(recordedQuery));
      }

      if (payload.product?.name) {
        setComparisonHistory(
          pushComparisonHistory({
            id: payload.product.id,
            name: payload.product.name,
            brand: payload.product.brand,
            bestPrice: payload.summary?.bestPrice ?? null,
            currency: targetCurrency,
            bestStore: payload.summary?.bestStore ?? null,
            offerCount: (payload.offers || []).length,
            isLive: resolvedIsLive,
          })
        );

        // Update lastObservedPrice for any matching watchlist entry
        const currentWatch = getWatchlist();
        const matchingWatch = currentWatch.find(
          (w) => w.id === payload.product.id
        );
        if (matchingWatch && payload.summary?.bestPrice != null) {
          const updatedList = upsertWatchItem({
            ...matchingWatch,
            lastObservedPrice: convertCurrency(
              payload.summary.bestPrice,
              targetCurrency,
              matchingWatch.currency || "INR"
            ),
            bestRetailer: payload.summary.bestStore,
            isLive: resolvedIsLive,
          });
          setWatchlist(updatedList);
        }
      }
    },
    []
  );

  const runDiscovery = useCallback(
    async (
      query,
      {
        page = 1,
        targetCurrency = currency,
        refresh = false,
        syncUrl = true,
        resetFilters = page === 1 && !refresh,
      } = {}
    ) => {
      const trimmed = query.trim();
      if (!trimmed) return;

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      if (refresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setErrorState(null);
      setActiveMode("discover");
      setCameFromDiscovery(false);

      try {
        const gl = targetCurrency === "USD" ? "us" : "in";
        const res = await fetch(
          `/api/discover?q=${encodeURIComponent(
            trimmed
          )}&page=${page}&limit=24&gl=${gl}&currency=${targetCurrency}&refresh=${refresh}`,
          {
            method: "GET",
            signal: controller.signal,
          }
        );

        const payload = await res.json();
        if (!res.ok) {
          setErrorState({
            message:
              payload?.error ||
              "Unable to discover matching products for this query.",
            fallbackReason: payload?.fallbackReason || null,
            suggestions: mockCatalog,
            query: trimmed,
          });
          return;
        }

        setDiscoveryData(payload);
        if (resetFilters) {
          setDiscoveryFilters(DEFAULT_DISCOVERY_FILTERS);
          setDiscoverySortBy("relevance");
        }
        if (page === 1) {
          setRecentSearches(pushRecentSearch(trimmed));
        }

        if (syncUrl && typeof window !== "undefined") {
          const nextUrl = new URL(window.location.href);
          nextUrl.searchParams.set("q", trimmed);
          nextUrl.searchParams.set("mode", "discover");
          nextUrl.searchParams.set("page", String(page));
          nextUrl.searchParams.set("currency", targetCurrency);
          nextUrl.searchParams.delete("productId");
          window.history.replaceState(null, "", nextUrl.toString());
        }
      } catch (err) {
        if (err?.name === "AbortError") return;
        setErrorState({
          message:
            "Network error while discovering products. Please retry or choose a curated SKU below.",
          suggestions: mockCatalog,
          query: trimmed,
        });
      } finally {
        if (abortControllerRef.current === controller) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [currency]
  );

  const runSearch = useCallback(
    async (
      query,
      targetCurrency = currency,
      syncUrl = true,
      {
        productId = null,
        refresh = false,
        fromDiscovery = false,
      } = {}
    ) => {
      const trimmed = query.trim();
      if (!trimmed) return;

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      if (refresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setErrorState(null);
      setActiveMode("compare");
      setCameFromDiscovery(fromDiscovery);

      try {
        const gl = targetCurrency === "USD" ? "us" : "in";
        const url = `/api/compare?q=${encodeURIComponent(
          trimmed
        )}&currency=${targetCurrency}&gl=${gl}${
          productId ? `&productId=${encodeURIComponent(productId)}` : ""
        }${refresh ? "&refresh=true" : ""}`;

        const res = await fetch(url, {
          method: "GET",
          signal: controller.signal,
        });

        const payload = await res.json();

        if (!res.ok) {
          setComparisonData((prev) => ({
            ...prev,
            isLive: Boolean(payload?.isLive),
            mode: payload?.mode || prev.mode,
            fallbackReason: payload?.fallbackReason || null,
          }));
          setErrorState({
            message:
              payload?.error ||
              "Unable to find matching pricing for this product.",
            fallbackReason: payload?.fallbackReason || null,
            suggestions: payload?.suggestions || mockCatalog,
            query: trimmed,
          });
          setIsLoading(false);
          setIsRefreshing(false);
          return;
        }

        applySuccessPayload(payload, targetCurrency, trimmed, productId);

        if (syncUrl && typeof window !== "undefined") {
          const nextUrl = new URL(window.location.href);
          nextUrl.searchParams.set("q", payload.product?.name || trimmed);
          nextUrl.searchParams.set("mode", "compare");
          nextUrl.searchParams.set("currency", targetCurrency);
          nextUrl.searchParams.delete("page");
          if (productId) {
            nextUrl.searchParams.set("productId", productId);
          } else {
            nextUrl.searchParams.delete("productId");
          }
          window.history.replaceState(null, "", nextUrl.toString());
        }
      } catch (err) {
        if (err?.name === "AbortError") return;
        setErrorState({
          message:
            "Network error while querying price comparison. Please retry or select a curated SKU below.",
          suggestions: mockCatalog,
          query: trimmed,
        });
      } finally {
        if (abortControllerRef.current === controller) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [currency, applySuccessPayload]
  );

  const handleSearchSubmit = useCallback(
    (query, explicitModeOverride = null) => {
      const trimmed = String(query || "").trim();
      if (!trimmed) return;

      const resolvedMode =
        explicitModeOverride ||
        (searchModePref !== "auto"
          ? searchModePref
          : classifySearchQuery(trimmed).recommendedMode);

      if (resolvedMode === "discover") {
        runDiscovery(trimmed, {
          page: 1,
          targetCurrency: currency,
          refresh: false,
          syncUrl: true,
        });
      } else {
        runSearch(trimmed, currency, true, { fromDiscovery: false });
      }
    },
    [searchModePref, runDiscovery, runSearch, currency]
  );

  const handleSelectDiscoveredProduct = useCallback(
    (item) => {
      const productName = item?.name || item?.title;
      const productId = item?.id || item?.canonicalId || null;
      if (!productName) return;
      setInputValue(productName);
      runSearch(productName, currency, true, {
        productId,
        fromDiscovery: true,
      });
      const anchor = document.getElementById("comparison-workspace");
      if (anchor) {
        anchor.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },
    [currency, runSearch]
  );

  // Initial hydration: read localStorage state + fetch initial comparison from /api/compare
  useEffect(() => {
    if (typeof window === "undefined") return;

    let cancelled = false;

    async function hydratePage() {
      const savedWatch = getWatchlist();
      const savedRecent = getRecentSearches();
      const savedHistory = getComparisonHistory();
      if (!cancelled) {
        setWatchlist(savedWatch);
        setRecentSearches(savedRecent);
        setComparisonHistory(savedHistory);
      }

      const params = new URLSearchParams(window.location.search);
      const urlQuery = params.get("q")?.trim();
      const urlMode = params.get("mode")?.toLowerCase();
      const urlProductId = params.get("productId")?.trim() || null;
      const urlPage = Math.max(1, parseInt(params.get("page") || "1", 10) || 1);
      const urlCurrency = params.get("currency")?.toUpperCase();
      const resolvedCurrency =
        urlCurrency === "USD" || urlCurrency === "INR" ? urlCurrency : "INR";

      if (!cancelled && resolvedCurrency !== "INR") {
        setCurrency(resolvedCurrency);
      }

      const gl = resolvedCurrency === "USD" ? "us" : "in";

      if (urlMode === "discover" && urlQuery) {
        if (!cancelled) {
          setInputValue(urlQuery);
          setActiveMode("discover");
          setIsLoading(true);
        }
        try {
          const res = await fetch(
            `/api/discover?q=${encodeURIComponent(
              urlQuery
            )}&page=${urlPage}&limit=24&gl=${gl}&currency=${resolvedCurrency}`
          );
          const payload = await res.json();
          if (cancelled) return;
          if (!res.ok) {
            setErrorState({
              message:
                payload?.error ||
                "Unable to discover matching products for this query.",
              fallbackReason: payload?.fallbackReason || null,
              suggestions: mockCatalog,
              query: urlQuery,
            });
          } else {
            setDiscoveryData(payload);
          }
        } catch {
          if (!cancelled) {
            setErrorState({
              message: "Network error while loading discovery catalog.",
              suggestions: mockCatalog,
              query: urlQuery,
            });
          }
        } finally {
          if (!cancelled) setIsLoading(false);
        }
        return;
      }

      const queryToFetch = urlQuery || DEFAULT_PRODUCT.name;
      const hasCustomQuery = Boolean(
        urlQuery && urlQuery !== DEFAULT_PRODUCT.name
      );

      if (hasCustomQuery && !cancelled) {
        setInputValue(urlQuery);
        setIsLoading(true);
      }

      try {
        const res = await fetch(
          `/api/compare?q=${encodeURIComponent(
            queryToFetch
          )}&currency=${resolvedCurrency}&gl=${gl}${
            urlProductId ? `&productId=${encodeURIComponent(urlProductId)}` : ""
          }`
        );
        const payload = await res.json();
        if (cancelled) return;

        if (!res.ok) {
          setComparisonData((prev) => ({
            ...prev,
            isLive: Boolean(payload?.isLive),
            mode: payload?.mode || prev.mode,
            fallbackReason: payload?.fallbackReason || null,
          }));
          if (hasCustomQuery) {
            setErrorState({
              message:
                payload?.error ||
                "Unable to find matching pricing for this product.",
              fallbackReason: payload?.fallbackReason || null,
              suggestions: payload?.suggestions || mockCatalog,
              query: urlQuery,
            });
          }
        } else {
          applySuccessPayload(
            payload,
            resolvedCurrency,
            hasCustomQuery ? urlQuery : null,
            urlProductId
          );
        }
      } catch {
        if (!cancelled && hasCustomQuery) {
          setErrorState({
            message: "Network error while loading comparison.",
            suggestions: mockCatalog,
            query: urlQuery,
          });
        }
      } finally {
        if (!cancelled && hasCustomQuery) {
          setIsLoading(false);
        }
      }
    }

    hydratePage();

    return () => {
      cancelled = true;
    };
  }, [applySuccessPayload]);

  const handleSelectTrending = useCallback(
    (item) => {
      setInputValue(item.name);
      runSearch(item.name, currency, true, { fromDiscovery: false });
      const anchor = document.getElementById("comparison-workspace");
      if (anchor) {
        anchor.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },
    [currency, runSearch]
  );

  const activeProductName = comparisonData.product?.name;
  const activeIsLive = comparisonData.isLive;
  const activeProductIdParam = comparisonData.activeProductIdParam;
  const activeDiscoveryQuery = discoveryData?.query;
  const activeDiscoveryPage = discoveryData?.pagination?.page || 1;

  const handleCurrencyChange = useCallback(
    (nextCurrency) => {
      if (nextCurrency === currency) return;
      setCurrency(nextCurrency);

      if (typeof window !== "undefined") {
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set("currency", nextCurrency);
        window.history.replaceState(null, "", nextUrl.toString());
      }

      if (activeMode === "discover" && activeDiscoveryQuery) {
        runDiscovery(activeDiscoveryQuery, {
          page: activeDiscoveryPage,
          targetCurrency: nextCurrency,
          syncUrl: true,
          resetFilters: false,
        });
      } else if (activeIsLive && activeProductName) {
        runSearch(activeProductName, nextCurrency, true, {
          productId: activeProductIdParam,
          fromDiscovery: cameFromDiscovery,
        });
      }
    },
    [
      currency,
      activeMode,
      activeDiscoveryQuery,
      activeDiscoveryPage,
      activeIsLive,
      activeProductName,
      activeProductIdParam,
      cameFromDiscovery,
      runDiscovery,
      runSearch,
    ]
  );

  const handleResetHome = useCallback(() => {
    setErrorState(null);
    setActiveMode("compare");
    setDiscoveryData(null);
    setDiscoveryFilters(DEFAULT_DISCOVERY_FILTERS);
    setCameFromDiscovery(false);
    setInputValue(DEFAULT_PRODUCT.name);
    setSortBy("price");
    setHideOutOfStock(false);
    setTargetRetailersOnly(false);
    setExactVariantsOnly(false);
    setComparisonData(buildInitialState());

    if (typeof window !== "undefined") {
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.delete("q");
      nextUrl.searchParams.delete("mode");
      nextUrl.searchParams.delete("productId");
      nextUrl.searchParams.delete("page");
      window.history.replaceState(null, "", nextUrl.toString());
    }

    runSearch(DEFAULT_PRODUCT.name, currency, false);
  }, [currency, runSearch]);

  const {
    visibleOffers,
    visibleUnverifiedOffers,
    visibleOtherVariants,
    totalCount,
    summary,
  } = useMemo(() => {
    const rawOffers = comparisonData.offers || [];
    const { enrichedOffers, summary: computedSummary } = computeOfferAnalytics(
      rawOffers,
      currency,
      comparisonData.product?.volume
    );
    const sorted = sortOffers(enrichedOffers, sortBy, {
      hideOutOfStock,
      targetRetailersOnly,
      exactVariantsOnly,
    });

    const { enrichedOffers: enrichedUnverified } = computeOfferAnalytics(
      comparisonData.unverifiedOffers || [],
      currency,
      null
    );
    const sortedUnverified = sortOffers(enrichedUnverified, sortBy, {
      hideOutOfStock,
      targetRetailersOnly,
      exactVariantsOnly: false,
    });

    const { enrichedOffers: enrichedVariants } = computeOfferAnalytics(
      comparisonData.otherVariants || [],
      currency,
      null
    );
    const sortedVariants = sortOffers(enrichedVariants, sortBy, {
      hideOutOfStock,
      targetRetailersOnly,
      exactVariantsOnly: false,
    });

    return {
      visibleOffers: sorted,
      visibleUnverifiedOffers: sortedUnverified,
      visibleOtherVariants: sortedVariants,
      totalCount: rawOffers.length,
      summary: computedSummary,
    };
  }, [
    comparisonData.offers,
    comparisonData.unverifiedOffers,
    comparisonData.otherVariants,
    comparisonData.product?.volume,
    currency,
    sortBy,
    hideOutOfStock,
    targetRetailersOnly,
    exactVariantsOnly,
  ]);

  const watchlistIds = useMemo(
    () => new Set(watchlist.map((w) => w.id)),
    [watchlist]
  );

  const handleQuickWatchDiscovery = useCallback(
    (item) => {
      const id = item.id || item.canonicalId;
      const name = item.name || item.title;
      if (!id || !name) return;
      if (watchlist.some((w) => w.id === id)) {
        setWatchlist(removeWatchItem(id));
        return;
      }
      const nextList = upsertWatchItem({
        id,
        name,
        brand: item.brand,
        volume: item.size || null,
        image: item.image || null,
        targetPrice: item.lowestPrice ?? null,
        lastObservedPrice: item.lowestPrice ?? null,
        bestRetailer: item.bestRetailer || item.retailers?.[0] || null,
        currency,
        isLive: Boolean(discoveryData?.isLive),
      });
      setWatchlist(nextList);
    },
    [watchlist, currency, discoveryData?.isLive]
  );

  const navState = useMemo(
    () =>
      activeMode === "discover" && discoveryData
        ? {
            isLive: discoveryData.isLive,
            mode: discoveryData.mode,
            dataSource: discoveryData.dataSource,
            cacheStatus: discoveryData.cacheStatus,
          }
        : {
            isLive: comparisonData.isLive,
            mode: comparisonData.mode,
            dataSource: comparisonData.dataSource,
            cacheStatus: comparisonData.cacheStatus,
          },
    [
      activeMode,
      discoveryData,
      comparisonData.isLive,
      comparisonData.mode,
      comparisonData.dataSource,
      comparisonData.cacheStatus,
    ]
  );

  const handleOpenWatchlist = useCallback(() => setIsWatchlistOpen(true), []);
  const handleCloseWatchlist = useCallback(() => setIsWatchlistOpen(false), []);
  const handleClearSearchInput = useCallback(() => setInputValue(""), []);
  const handleResetDiscoveryFilters = useCallback(
    () => setDiscoveryFilters(DEFAULT_DISCOVERY_FILTERS),
    []
  );
  const handleToggleHideOutOfStock = useCallback(
    () => setHideOutOfStock((prev) => !prev),
    []
  );
  const handleToggleTargetRetailersOnly = useCallback(
    () => setTargetRetailersOnly((prev) => !prev),
    []
  );
  const handleToggleExactVariantsOnly = useCallback(
    () => setExactVariantsOnly((prev) => !prev),
    []
  );
  const handleSaveWatchTarget = useCallback(
    (entry) => setWatchlist(upsertWatchItem(entry)),
    []
  );
  const handleRemoveWatchItem = useCallback(
    (id) => setWatchlist(removeWatchItem(id)),
    []
  );

  const handleDiscoveryPageChange = useCallback(
    (nextPage) => {
      runDiscovery(discoveryData?.query, {
        page: nextPage,
        targetCurrency: currency,
        refresh: false,
        syncUrl: true,
        resetFilters: false,
      });
    },
    [runDiscovery, discoveryData?.query, currency]
  );

  const handleDiscoveryRefresh = useCallback(() => {
    runDiscovery(discoveryData?.query, {
      page: discoveryData?.pagination?.page || 1,
      targetCurrency: currency,
      refresh: true,
      syncUrl: true,
      resetFilters: false,
    });
  }, [runDiscovery, discoveryData?.query, discoveryData?.pagination?.page, currency]);

  const handleRefreshLiveComparison = useCallback(() => {
    runSearch(comparisonData.product?.name || inputValue, currency, true, {
      productId: comparisonData.activeProductIdParam,
      refresh: true,
      fromDiscovery: cameFromDiscovery,
    });
  }, [
    runSearch,
    comparisonData.product?.name,
    comparisonData.activeProductIdParam,
    inputValue,
    currency,
    cameFromDiscovery,
  ]);

  const handleSelectWatchQuery = useCallback(
    (q) => {
      setInputValue(q);
      handleSearchSubmit(q);
    },
    [handleSearchSubmit]
  );

  const triggeredAlerts = useMemo(() => {
    return watchlist.filter((item) => {
      if (item.lastObservedPrice == null || !item.targetPrice) return false;
      const targetDisp = convertCurrency(
        item.targetPrice,
        item.currency || "INR",
        currency
      );
      const obsDisp = convertCurrency(
        item.lastObservedPrice,
        item.currency || "INR",
        currency
      );
      return obsDisp != null && targetDisp != null && obsDisp <= targetDisp;
    });
  }, [watchlist, currency]);

  const isActiveProductWatched = useMemo(() => {
    if (!comparisonData.product?.id) return false;
    return watchlist.some((w) => w.id === comparisonData.product.id);
  }, [watchlist, comparisonData.product]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-screen flex-col bg-[#FFFFFF] text-[#141311]">
        {/* Chapter I: Preserved Fernhollow Nocturnal 3D Valley */}
        <FernhollowHero />

        {/* Chapter II: LuxeIndex Price Intelligence Workspace */}
        <div id="luxe-index" className="relative flex flex-1 flex-col bg-[#FFFFFF]">
          <Navbar
            currency={currency}
            onCurrencyChange={handleCurrencyChange}
            isLive={navState.isLive}
            mode={navState.mode}
            activeMode={activeMode}
            dataSource={navState.dataSource}
            cacheStatus={navState.cacheStatus}
            watchlistCount={watchlist.length}
            triggeredAlertCount={triggeredAlerts.length}
            onOpenWatchlist={handleOpenWatchlist}
            onResetHome={handleResetHome}
          />

          <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-20 sm:px-6 lg:px-10">
            {/* Ambient editorial wash between navbar and search */}
            <div
              aria-hidden="true"
              className="pointer-events-none relative mx-auto -mt-12 h-[320px] w-full max-w-4xl bg-[radial-gradient(50%_80%_at_50%_0%,rgba(230,224,212,0.25)_0%,rgba(250,248,245,0)_70%)]"
            />
            <div id="search-anchor" className="scroll-mt-24">
            <SearchSection
              inputValue={inputValue}
              onInputChange={setInputValue}
              onSearchSubmit={handleSearchSubmit}
              onClear={handleClearSearchInput}
              trendingItems={mockCatalog}
              recentSearches={recentSearches}
              onClearRecentSearches={() => setRecentSearches(clearRecentSearches())}
              activeProductId={
                activeMode === "compare" && !errorState
                  ? comparisonData.product?.id
                  : null
              }
              onSelectTrending={handleSelectTrending}
              currency={currency}
              searchModePref={searchModePref}
              onSearchModePrefChange={setSearchModePref}
              isLoading={isLoading}
            />
            </div>

            {/* Triggered Watchlist Price-Drop Banner */}
            {triggeredAlerts.length > 0 && (
              <div
                role="status"
                className="mt-6 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#E4EAC9] bg-[#F6F8EA] px-4 py-3 text-xs text-[#3B4A1F]"
              >
                <div className="flex items-center gap-2.5">
                  <Bell className="h-3.5 w-3.5 text-[#5C6B2E]" aria-hidden="true" />
                  <span>
                    <strong className="font-semibold">Price alert triggered:</strong>{" "}
                    {triggeredAlerts[0].name} reached{" "}
                    <span className="font-mono font-semibold">
                      {formatPrice(
                        convertCurrency(
                          triggeredAlerts[0].lastObservedPrice,
                          triggeredAlerts[0].currency || "INR",
                          currency
                        ),
                        currency
                      )}
                    </span>{" "}
                    (within your target).
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsWatchlistOpen(true)}
                  className="rounded-full border border-[#E4EAC9] bg-white/70 px-3 py-1 font-mono text-[9.5px] font-medium uppercase tracking-[0.08em] text-[#3B4A1F] transition-colors hover:bg-white"
                >
                  Review ({triggeredAlerts.length})
                </button>
              </div>
            )}

            {/* Honest Fallback / Quota Disclosure Notice */}
            {!isLoading &&
              !errorState &&
              ((activeMode === "discover" && discoveryData?.fallbackReason) ||
                (activeMode === "compare" && comparisonData.fallbackReason)) && (
                <div
                  role="note"
                  className="mt-6 rounded-xl border border-[#E8DFC8] bg-[#F7F3E8]/80 px-4 py-3 font-mono text-[10px] leading-relaxed text-[#6B5D33]"
                >
                  Live feed notice:{" "}
                  {activeMode === "discover"
                    ? discoveryData?.fallbackReason
                    : comparisonData.fallbackReason}{" "}
                  Showing curated demonstration baseline for preview.
                </div>
              )}

            {/* Back to Discovery Navigation Banner when inspecting a discovered SKU */}
            {activeMode === "compare" &&
              cameFromDiscovery &&
              discoveryData &&
              !isLoading && (
                <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E6E0D4] bg-white/70 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => {
                      setErrorState(null);
                      setActiveMode("discover");
                      setInputValue(discoveryData.query || "");
                      if (typeof window !== "undefined") {
                        const nextUrl = new URL(window.location.href);
                        nextUrl.searchParams.set("q", discoveryData.query || "");
                        nextUrl.searchParams.set("mode", "discover");
                        nextUrl.searchParams.set(
                          "page",
                          String(discoveryData.pagination?.page || 1)
                        );
                        nextUrl.searchParams.delete("productId");
                        window.history.replaceState(null, "", nextUrl.toString());
                      }
                    }}
                    className="inline-flex items-center gap-2 font-mono text-[10.5px] font-medium text-[#141311] transition-colors hover:text-[#3A3733]"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>
                      Back to &ldquo;{discoveryData.query}&rdquo; discovery (
                      {discoveryData.products?.length || 0} products)
                    </span>
                  </button>
                  <span className="rounded-full border border-[#E6E0D4] bg-[#FFFFFF] px-2.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[#8B8780]">
                    Mode B &middot; Exact SKU parity
                  </span>
                </div>
              )}

            <div id="comparison-workspace" className="mt-9 scroll-mt-24 space-y-7">
              {isLoading ? (
                <SkeletonLoader />
              ) : errorState ? (
                <section
                  aria-live="polite"
                  className="overflow-hidden rounded-2xl border border-[#E6E0D4] bg-white"
                >
                  <div className="flex flex-col gap-3 border-b border-[#EEEAE1] bg-[#FFFFFF] px-6 py-5 sm:flex-row sm:items-center sm:px-8">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#EEF0DD] text-[#3A3733]">
                      <AlertCircle className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div>
                      <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#3A3733]">
                        No verified match
                      </p>
                      <h2 className="mt-1 font-serif text-[1.4rem] font-normal leading-tight text-[#141311]">
                        &ldquo;{errorState.query}&rdquo;
                      </h2>
                    </div>
                  </div>

                  <div className="px-6 py-6 sm:px-8">
                    <p className="max-w-[68ch] text-[13.5px] leading-[1.75] text-[#75716B]">
                      {errorState.message}
                    </p>
                    {errorState.fallbackReason && (
                      <p className="mt-2 rounded-lg bg-[#F7F3E8] px-3 py-2 font-mono text-[10px] text-[#6B5D33]">
                        Provider detail: {errorState.fallbackReason}
                      </p>
                    )}

                    <div className="mt-6">
                      <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#8B8780]">
                        Verified curated formulations
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {(errorState.suggestions || mockCatalog).map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => handleSelectTrending(item)}
                            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-full border border-[#E6E0D4] bg-white px-4 py-1.5 text-[11.5px] font-medium text-[#141311] transition-all duration-200 hover:-translate-y-px hover:border-[#3A3733] hover:text-[#3A3733] active:scale-[0.98]"
                          >
                            <span>{item.shortName || item.name}</span>
                            <ArrowRight className="h-3.5 w-3.5 text-[#8B8780]" />
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>
              ) : activeMode === "discover" && discoveryData ? (
                <DiscoveryWorkspace
                  discoveryData={discoveryData}
                  currency={currency}
                  sortBy={discoverySortBy}
                  onSortChange={setDiscoverySortBy}
                  filters={discoveryFilters}
                  onUpdateFilters={setDiscoveryFilters}
                  onResetFilters={handleResetDiscoveryFilters}
                  onSelectProduct={handleSelectDiscoveredProduct}
                  onPageChange={handleDiscoveryPageChange}
                  onRefresh={handleDiscoveryRefresh}
                  isRefreshing={isRefreshing}
                  watchlistIds={watchlistIds}
                  onQuickWatch={handleQuickWatchDiscovery}
                />
              ) : (
                <AnimatePresence mode="wait">
                  <motion.div
                    key={comparisonData.product?.id || "active-product"}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.22, ease: "easeOut" }}
                    className="space-y-6"
                  >
                    <ProductHeader
                      product={comparisonData.product}
                      priceHistory={comparisonData.priceHistory}
                      summary={summary}
                      historySource={comparisonData.historySource}
                      dataSource={comparisonData.dataSource}
                      cacheStatus={comparisonData.cacheStatus}
                      isLive={comparisonData.isLive}
                      productIdentity={comparisonData.productIdentity}
                      currency={currency}
                      baseCurrency={comparisonData.sourceCurrency}
                      isWatched={isActiveProductWatched}
                      onOpenAlertModal={handleOpenWatchlist}
                      onRefreshLive={handleRefreshLiveComparison}
                      isRefreshing={isRefreshing}
                    />

                    <div id="price-matrix-anchor" className="space-y-6">
                      <PriceMatrix
                        offers={visibleOffers}
                        unverifiedOffers={visibleUnverifiedOffers}
                        otherVariants={visibleOtherVariants}
                        variantSummary={comparisonData.variantSummary}
                        totalCount={totalCount}
                        flagshipCoverage={comparisonData.flagshipCoverage}
                        summary={summary}
                        currency={currency}
                        sortBy={sortBy}
                        onSortChange={setSortBy}
                        hideOutOfStock={hideOutOfStock}
                        onToggleHideOutOfStock={handleToggleHideOutOfStock}
                        targetRetailersOnly={targetRetailersOnly}
                        onToggleTargetRetailersOnly={handleToggleTargetRetailersOnly}
                        exactVariantsOnly={exactVariantsOnly}
                        onToggleExactVariantsOnly={handleToggleExactVariantsOnly}
                      />

                      <DealIntelligencePanel
                        offers={visibleOffers}
                        summary={summary}
                        priceIntelligence={comparisonData.priceIntelligence}
                        currency={currency}
                      />
                    </div>
                  </motion.div>
                </AnimatePresence>
              )}
            </div>
          </main>

          {/* Sections C–K: AestheticMatch-inspired editorial commerce bands (real index data only) */}
          <EditorialSections
            catalog={mockCatalog}
            currency={currency}
            onSelectProduct={handleSelectTrending}
            onOpenWatchlist={handleOpenWatchlist}
          />

          {/* Light editorial footer — AestheticMatch direction */}
          <motion.footer
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="mt-8 border-t border-[#E6E0D4] bg-white"
          >
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10">
              {/* Newsletter band */}
              <div className="flex flex-col gap-6 rounded-[2rem] bg-[#F3EFE7] px-6 py-10 sm:px-10 lg:flex-row lg:items-center lg:justify-between">
                <div className="max-w-[46ch]">
                  <h2 className="font-serif text-[1.7rem] leading-tight tracking-[-0.02em] text-[#141311] lux-serif-display sm:text-[2.1rem]">
                    Price drops, quietly reported.
                  </h2>
                  <p className="mt-2 text-[14px] leading-relaxed text-[#75716B]">
                    LuxeIndex alerts run entirely in your browser — save a target
                    price on any product and the watchlist does the watching.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleOpenWatchlist}
                  className="inline-flex min-h-[50px] w-fit items-center gap-2 rounded-full bg-[#141311] px-8 text-[15px] font-medium text-white transition-transform duration-200 hover:-translate-y-0.5 active:scale-[0.98]"
                >
                  Open your watchlist
                </button>
              </div>

              {/* Link columns */}
              <div className="grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-12">
                <div className="lg:col-span-5">
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#8B8780]">
                    LuxeIndex &times; Fernhollow
                  </p>
                  <p className="mt-4 max-w-[44ch] text-[13.5px] leading-[1.8] text-[#75716B]">
                    A transparent beauty price index across Sephora, Nykaa,
                    Amazon Luxury, Cult Beauty and Space NK. Real observed
                    snapshots — zero fabricated pricing.
                  </p>
                  <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-[#E6E0D4] px-3.5 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-[#141311]">
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-[#C9F24D] ring-4 ring-[#C9F24D]/20 lux-dot-pulse"
                      aria-hidden="true"
                    />
                    Editorial beauty intelligence
                  </div>
                </div>

                <div className="lg:col-span-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#8B8780]">
                    Explore
                  </p>
                  <ul className="mt-4 space-y-3 text-[13.5px] text-[#141311]">
                    <li>
                      <a href="#luxe-index" className="lux-underline-reveal inline-block transition-colors duration-200 hover:text-[#3A3733]">
                        The Index
                      </a>
                    </li>
                    <li>
                      <a href="#comparison-workspace" className="lux-underline-reveal inline-block transition-colors duration-200 hover:text-[#3A3733]">
                        Price comparison
                      </a>
                    </li>
                    <li>
                      <a href="#best-sellers-heading" className="lux-underline-reveal inline-block transition-colors duration-200 hover:text-[#3A3733]">
                        Best sellers
                      </a>
                    </li>
                    <li>
                      <a href="#faq-heading" className="lux-underline-reveal inline-block transition-colors duration-200 hover:text-[#3A3733]">
                        FAQ
                      </a>
                    </li>
                    <li>
                      <a href="#top" className="lux-underline-reveal inline-block transition-colors duration-200 hover:text-[#3A3733]">
                        Fernhollow valley
                      </a>
                    </li>
                  </ul>
                </div>

                <div className="lg:col-span-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#8B8780]">
                    Provider transparency
                  </p>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {["SerpApi", "Serper", "SearchApi"].map((provider) => (
                      <span
                        key={provider}
                        className="rounded-full border border-[#E6E0D4] bg-[#F3EFE7] px-2.5 py-1 font-mono text-[9.5px] text-[#141311]"
                      >
                        {provider}
                      </span>
                    ))}
                    <span className="rounded-full border border-[#E6E0D4] px-2.5 py-1 font-mono text-[9.5px] text-[#8B8780]">
                      Apify
                    </span>
                  </div>
                  <p className="mt-4 text-[12px] leading-[1.8] text-[#8B8780]">
                    Sequenced live discovery with cache-first delivery, quota
                    safeguards and variant-verified matching.
                  </p>
                </div>
              </div>

              {/* Bottom bar */}
              <div className="flex flex-col justify-between gap-3 border-t border-[#E6E0D4] py-5 sm:flex-row sm:items-center">
                <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-[#8B8780]">
                  &copy; {new Date().getFullYear()} LuxeIndex &middot; Prices are
                  observed, never invented
                </span>
                <a
                  href="#top"
                  className="group inline-flex w-fit items-center gap-1.5 rounded-full border border-[#E6E0D4] px-3.5 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-[#141311] transition-all duration-200 hover:border-[#141311]"
                >
                  <span>Valley Top</span>
                  <ArrowUp className="h-3 w-3 transition-transform group-hover:-translate-y-0.5" aria-hidden="true" />
                </a>
              </div>

              {/* Oversized serif wordmark */}
              <div aria-hidden="true" className="overflow-hidden pb-6 pt-2">
                <p className="select-none whitespace-nowrap text-center font-serif text-[clamp(3.5rem,14vw,11rem)] font-medium leading-[0.95] tracking-[-0.04em] text-[#F3EFE7] lux-serif-display">
                  LuxeIndex
                </p>
              </div>
            </div>
          </motion.footer>
        </div>

        <WatchlistDrawer
          isOpen={isWatchlistOpen}
          onClose={handleCloseWatchlist}
          activeProduct={comparisonData.product}
          activeBestPrice={summary?.bestPrice ?? null}
          activeBestStore={summary?.bestStore ?? null}
          currency={currency}
          isLive={comparisonData.isLive}
          watchlist={watchlist}
          comparisonHistory={comparisonHistory}
          onSaveTarget={handleSaveWatchTarget}
          onRemoveWatch={handleRemoveWatchItem}
          onSelectQuery={handleSelectWatchQuery}
        />
      </div>
    </MotionConfig>
  );
}
