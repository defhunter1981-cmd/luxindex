import { NextResponse } from "next/server";
import {
  aggregateDiscoveryProducts,
  buildDiscoveryFacets,
  classifySearchQuery,
  computePricePer100Unit,
} from "@/lib/catalogIdentity";
import { getRegisteredProduct, registerDiscoveredProduct } from "@/lib/discoveryCache";
import { discoverWithLocalCatalog } from "@/lib/providers/localCatalogProvider";
import { getConfiguredProviders } from "@/lib/providers/providerRegistry";
import { routeMultiProviderDiscovery } from "@/lib/search/queryRouter";
import {
  PROVIDER_IDS,
  getQuotaDiagnostics,
  isProviderEnabled,
  redactSecrets,
} from "@/lib/search/quotaManager";
import {
  buildSearchCacheKey,
  coalescedSearchFetch,
  getSearchCacheEntry,
  setSearchCacheEntry,
} from "@/lib/search/searchCache";
import { convertCurrency, formatPrice } from "@/lib/utils";

function roundPriceForCurrency(amount, currency = "INR") {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return amount;
  return currency === "USD" ? Math.round(amount * 100) / 100 : Math.round(amount);
}

function convertDiscoveryProductsForCurrency(
  products = [],
  targetCurrency = "INR",
  fallbackSourceCurrency = "INR"
) {
  if (!Array.isArray(products) || products.length === 0) return products;
  const needsAnyConversion = products.some(
    (p) => (p?.currency || fallbackSourceCurrency) !== targetCurrency
  );
  if (!needsAnyConversion) return products;

  return products.map((product) => {
    const productSourceCurrency = product?.currency || fallbackSourceCurrency;
    if (productSourceCurrency === targetCurrency) return product;

    const convertedOffers = Array.isArray(product.offersPreview)
      ? product.offersPreview.map((offer) => {
          const offerSource = offer?.currency || productSourceCurrency;
          if (typeof offer?.price !== "number" || offer.price <= 0 || offerSource === targetCurrency) {
            return offer;
          }
          const converted = roundPriceForCurrency(
            convertCurrency(offer.price, offerSource, targetCurrency),
            targetCurrency
          );
          return {
            ...offer,
            price: converted,
            currency: targetCurrency,
            formattedPrice: formatPrice(converted, targetCurrency),
          };
        })
      : [];

    const convLowest =
      typeof product.lowestPrice === "number" && product.lowestPrice > 0
        ? roundPriceForCurrency(
            convertCurrency(product.lowestPrice, productSourceCurrency, targetCurrency),
            targetCurrency
          )
        : product.lowestPrice;
    const convHighest =
      typeof product.highestPrice === "number" && product.highestPrice > 0
        ? roundPriceForCurrency(
            convertCurrency(product.highestPrice, productSourceCurrency, targetCurrency),
            targetCurrency
          )
        : product.highestPrice;
    const convAvg =
      typeof product.averagePrice === "number" && product.averagePrice > 0
        ? roundPriceForCurrency(
            convertCurrency(product.averagePrice, productSourceCurrency, targetCurrency),
            targetCurrency
          )
        : product.averagePrice;
    const convPrice =
      typeof product.price === "number" && product.price > 0
        ? roundPriceForCurrency(
            convertCurrency(product.price, productSourceCurrency, targetCurrency),
            targetCurrency
          )
        : convLowest;
    const convDiff =
      typeof convHighest === "number" && typeof convLowest === "number"
        ? roundPriceForCurrency(Math.max(0, convHighest - convLowest), targetCurrency)
        : product.priceDifference;

    const unitPrice = computePricePer100Unit(
      convLowest,
      {
        normalizedBaseMlOrG: product.normalizedBaseMlOrG,
        normalizedBaseUnit: product.normalizedBaseUnit,
      },
      targetCurrency
    );

    return {
      ...product,
      lowestPrice: convLowest,
      highestPrice: convHighest,
      averagePrice: convAvg,
      price: convPrice,
      priceDifference: convDiff,
      currency: targetCurrency,
      pricePer100Unit: unitPrice.value,
      unitLabel: unitPrice.label,
      offersPreview: convertedOffers,
    };
  });
}

function hasAnyLiveDiscoveryProvider() {
  return (
    isProviderEnabled(PROVIDER_IDS.SERPAPI) ||
    isProviderEnabled(PROVIDER_IDS.SERPER) ||
    isProviderEnabled(PROVIDER_IDS.SEARCHAPI) ||
    isProviderEnabled(PROVIDER_IDS.APIFY) ||
    isProviderEnabled(PROVIDER_IDS.BRIGHTDATA)
  );
}

function formatActiveProviderLabel(successfulProviders = []) {
  const names = {
    serpapi: "SerpApi",
    serper: "Serper",
    searchapi: "SearchApi",
    apify: "Apify",
    brightdata: "Bright Data",
  };
  if (!Array.isArray(successfulProviders) || successfulProviders.length === 0) {
    return "Multi-Provider Google Shopping";
  }
  return successfulProviders.map((id) => names[id] || id).join(" + ") + " Google Shopping";
}

export async function GET(request) {
  const liveConfigured = hasAnyLiveDiscoveryProvider();

  try {
    const { searchParams } = new URL(request.url);
    const query = (searchParams.get("q") || "").trim();
    const glParam = (searchParams.get("gl") || "in").toLowerCase();
    const gl = glParam === "us" ? "us" : "in";
    const hl = "en";
    const currencyParam = searchParams.get("currency")?.toUpperCase();
    const displayCurrency =
      currencyParam === "USD" || currencyParam === "INR"
        ? currencyParam
        : gl === "us"
        ? "USD"
        : "INR";

    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const limit = Math.min(
      40,
      Math.max(6, parseInt(searchParams.get("limit") || "24", 10) || 24)
    );
    const forceRefresh = searchParams.get("refresh") === "true";

    if (!query) {
      return NextResponse.json(
        {
          isLive: false,
          liveConfigured,
          searchMode: "discover",
          error: "Missing discovery search query parameter 'q'.",
          providers: getConfiguredProviders(gl),
        },
        { status: 400 }
      );
    }

    const intentInfo = classifySearchQuery(query);
    const startOffset = (page - 1) * 40;
    const marketBaseCurrency = gl === "us" ? "USD" : "INR";
    // Key cache independently of displayCurrency so toggling INR/USD reuses cached
    // live data and converts locally without incurring extra provider API calls.
    const cacheKey = buildSearchCacheKey("discover_v2", {
      q: query,
      gl,
      hl,
      start: startOffset,
    });

    let cachedHit = !forceRefresh ? getSearchCacheEntry(cacheKey, { allowStale: true }) : null;
    let cacheStatus = forceRefresh
      ? "BYPASS"
      : cachedHit
      ? cachedHit.status
      : "MISS";

    let sortedProducts = null;
    let facets = null;
    let providersQueried = [];
    let successfulProviders = [];
    let providerErrors = {};
    let partialSuccess = false;
    let hasNextPage = false;
    let rawProviderItems = 0;
    let fetchedAt = new Date().toISOString();

    let mode = "curated";
    let dataSource = "CURATED_DEMO";
    let errorType = null;
    let liveQueryConfirmedEmpty = false;
    let fallbackReason = liveConfigured
      ? null
      : "No live Google Shopping provider keys configured";

    if (cachedHit && cachedHit.data && Array.isArray(cachedHit.data.products)) {
      const cachedBaseCurrency = cachedHit.data.baseCurrency || marketBaseCurrency;
      sortedProducts = convertDiscoveryProductsForCurrency(
        cachedHit.data.products,
        displayCurrency,
        cachedBaseCurrency
      );
      facets =
        displayCurrency === cachedBaseCurrency && cachedHit.data.facets
          ? cachedHit.data.facets
          : buildDiscoveryFacets(sortedProducts);
      providersQueried = cachedHit.data.providersQueried || cachedHit.providers || [];
      successfulProviders = cachedHit.data.successfulProviders || cachedHit.providers || [];
      providerErrors = cachedHit.data.providerErrors || {};
      partialSuccess = Boolean(cachedHit.data.partialSuccess);
      hasNextPage = Boolean(cachedHit.data.hasNextPage);
      rawProviderItems = cachedHit.data.rawProviderItems || sortedProducts.length;
      fetchedAt = cachedHit.data.fetchedAt || cachedHit.cachedAt;
      mode = "live";
      dataSource = cachedHit.isStale ? "STALE_CACHE_LIVE" : "CACHED_LIVE";

      // Ensure baseline product registration survives disk-cache hydration across restarts.
      for (const prod of cachedHit.data.products) {
        if (prod?.id && !getRegisteredProduct(prod.id)) {
          registerDiscoveredProduct(prod.id, {
            id: prod.id,
            canonicalKey: prod.canonicalKey || prod.canonicalProductId,
            name: prod.name || prod.title,
            rawTitle: prod.rawTitle || prod.name,
            brand: prod.brand,
            category: prod.category,
            volume: prod.size,
            variant: prod.variant,
            spf: prod.spfFull || prod.spf,
            image: prod.image || prod.imageUrl,
            rating: prod.rating,
            reviewCount: prod.reviewCount,
            offersPreview: prod.offersPreview || [],
            providers: prod.providers || [],
            dataSource: "cached",
          });
        }
      }
    } else if (liveConfigured) {
      const routed = await coalescedSearchFetch(cacheKey, async () => {
        return routeMultiProviderDiscovery({
          query,
          gl,
          hl,
          start: startOffset,
          displayCurrency: marketBaseCurrency,
        });
      });

      providersQueried = routed.providersQueried || [];
      successfulProviders = routed.successfulProviders || [];
      providerErrors = routed.providerErrors || {};
      partialSuccess = Boolean(routed.partialSuccess);
      hasNextPage = Boolean(routed.hasNextProviderPage);

      if (Array.isArray(routed.products) && routed.products.length > 0) {
        // Domestic Indian offers stay prioritized cleanly, followed by offer depth & rating.
        const baseSortedProducts = [...routed.products].sort((a, b) => {
          if (Boolean(b.hasDomesticIndianOffer) !== Boolean(a.hasDomesticIndianOffer)) {
            return b.hasDomesticIndianOffer ? 1 : -1;
          }
          if ((b.providers?.length || 1) !== (a.providers?.length || 1)) {
            return (b.providers?.length || 1) - (a.providers?.length || 1);
          }
          if ((b.offerCount || 1) !== (a.offerCount || 1)) {
            return (b.offerCount || 1) - (a.offerCount || 1);
          }
          if ((b.reviewCount || 0) !== (a.reviewCount || 0)) {
            return (b.reviewCount || 0) - (a.reviewCount || 0);
          }
          return (a.lowestPrice ?? Infinity) - (b.lowestPrice ?? Infinity);
        });

        const baseFacets = buildDiscoveryFacets(baseSortedProducts);
        rawProviderItems = baseSortedProducts.reduce(
          (sum, prod) => sum + (prod.offerCount || 1),
          0
        );
        mode = "live";
        dataSource = "LIVE_OBSERVED";

        const cacheMeta = setSearchCacheEntry(
          cacheKey,
          {
            baseCurrency: marketBaseCurrency,
            products: baseSortedProducts,
            facets: baseFacets,
            providersQueried,
            successfulProviders,
            providerErrors,
            partialSuccess,
            hasNextPage,
            rawProviderItems,
            fetchedAt,
          },
          {
            kind: routed.queryProfile?.cacheKind || "category",
            providers: successfulProviders,
            isFailure: false,
          }
        );

        sortedProducts = convertDiscoveryProductsForCurrency(
          baseSortedProducts,
          displayCurrency,
          marketBaseCurrency
        );
        facets =
          displayCurrency === marketBaseCurrency
            ? baseFacets
            : buildDiscoveryFacets(sortedProducts);

        if (cacheMeta) {
          cachedHit = {
            cachedAt: cacheMeta.cachedAt,
            expiresAt: cacheMeta.expiresAt,
            ttlSeconds: cacheMeta.ttlSeconds,
          };
        }
      } else if (routed.isLiveEmpty) {
        liveQueryConfirmedEmpty = true;
        sortedProducts = [];
        facets = buildDiscoveryFacets([]);
        rawProviderItems = 0;
        mode = "live";
        dataSource = "LIVE_OBSERVED";
        errorType = routed.emptyReason || "EMPTY_RESULTS";
        fallbackReason =
          "No relevant verified beauty products matched this query.";
      } else {
        mode = "fallback";
        const firstErr = Object.values(providerErrors)[0];
        errorType = firstErr?.errorType || "EMPTY_RESULTS";
        fallbackReason =
          firstErr?.message ||
          "All active live shopping providers returned zero matching products.";
      }
    }

    if ((!sortedProducts || sortedProducts.length === 0) && !liveQueryConfirmedEmpty) {
      mode = liveConfigured ? "fallback" : "curated";
      dataSource = "CURATED_DEMO";
      const localRaw = discoverWithLocalCatalog({ query });
      const groupedFallback = aggregateDiscoveryProducts(localRaw.items || [], {
        query,
        gl,
        displayCurrency,
        dataSource: "CURATED_DEMO",
        fetchedAt,
      });
      sortedProducts = groupedFallback;
      facets = buildDiscoveryFacets(sortedProducts);
      rawProviderItems = localRaw.rawCount || sortedProducts.length;
    }

    const safeProducts = Array.isArray(sortedProducts) ? sortedProducts : [];
    const slicedProducts = safeProducts.slice(0, limit);
    const isLiveResponse = liveConfigured && mode === "live";

    return NextResponse.json(
      {
        isLive: isLiveResponse,
        liveConfigured,
        mode,
        searchMode: "discover",
        detectedIntent: intentInfo.intent,
        recommendedAction: intentInfo.recommendedMode,
        intentReason: intentInfo.reason,
        dataSource: isLiveResponse ? dataSource : "CURATED_DEMO",
        cacheStatus,
        cachedAt: cachedHit?.cachedAt || null,
        expiresAt: cachedHit?.expiresAt || null,
        ttlSeconds: cachedHit?.ttlSeconds || 600,
        freshness: {
          fetchedAt,
          cachedAt: cachedHit?.cachedAt || null,
          expiresAt: cachedHit?.expiresAt || null,
          ttlSeconds: cachedHit?.ttlSeconds || 600,
        },
        market: { gl, hl, currency: displayCurrency },
        query,
        providers: getConfiguredProviders(gl),
        activeProvider: isLiveResponse
          ? formatActiveProviderLabel(successfulProviders)
          : "Local Curated Beauty Index",
        providersQueried,
        successfulProviders,
        partialSuccess,
        providerErrors,
        quotaDiagnostics: getQuotaDiagnostics(),
        pagination: {
          page,
          limit,
          totalProductsInBatch: safeProducts.length,
          returnedCount: slicedProducts.length,
          rawProviderItems,
          hasNextPage,
          nextPage: hasNextPage ? page + 1 : null,
        },
        facets,
        products: slicedProducts,
        errorType,
        fallbackReason,
      },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        isLive: false,
        liveConfigured,
        mode: "error",
        searchMode: "discover",
        errorType: "INTERNAL_ERROR",
        error: "An unexpected error occurred during multi-brand product discovery.",
        details: redactSecrets(error?.message || "Internal server error"),
      },
      { status: 500 }
    );
  }
}
