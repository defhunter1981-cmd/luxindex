import { BEAUTY_BRAND_DISPLAY_MAP, classifySearchQuery } from "@/lib/catalogIdentity";
import { ApifyProvider } from "@/lib/providers/apifyProvider";
import { BrightDataProvider } from "@/lib/providers/brightDataProvider";
import { SearchApiProvider } from "@/lib/providers/searchApiProvider";
import { SerpApiProvider } from "@/lib/providers/serpApiProvider";
import { SerperProvider } from "@/lib/providers/serperProvider";
import { normalizeText } from "@/lib/utils";
import { deduplicateAndAggregateProducts } from "./deduplicator";
import {
  PROVIDER_IDS,
  canCallProvider,
  getQuotaDiagnostics,
} from "./quotaManager";
import {
  filterRelevantDiscoveryProducts,
  isObviouslyNonsenseQuery,
} from "./relevance";

function detectQueryProfile(query = "") {
  const norm = normalizeText(query);
  const matchedBrands = [];
  for (const [key, display] of BEAUTY_BRAND_DISPLAY_MAP) {
    const pattern = new RegExp(`\\b${key.replace(/\s+/g, "\\s+")}\\b`, "i");
    if (pattern.test(norm) && !matchedBrands.includes(display)) {
      matchedBrands.push(display);
    }
  }

  const intent = classifySearchQuery(query);
  const isBrandQuery = matchedBrands.length > 0;
  const cacheKind =
    intent?.searchMode === "compare_exact"
      ? "exact"
      : isBrandQuery
      ? "brand"
      : "category";

  return {
    intent,
    matchedBrands,
    isBrandQuery,
    cacheKind,
  };
}

function summarizeCoverage(products = [], queryProfile = null) {
  const domesticProducts = products.filter((p) => !p.isInternationalImport);
  const distinctBrands = new Set(
    domesticProducts
      .map((p) => p.brand)
      .filter((b) => b && b !== "Independent / Other")
  );

  let brandMatchCount = domesticProducts.length;
  if (queryProfile?.matchedBrands?.length > 0) {
    const expected = new Set(queryProfile.matchedBrands.map((b) => normalizeText(b)));
    brandMatchCount = domesticProducts.filter((p) =>
      expected.has(normalizeText(p.brand || ""))
    ).length;
  }

  return {
    totalProducts: products.length,
    domesticCount: domesticProducts.length,
    distinctBrandCount: distinctBrands.size,
    brandMatchCount,
  };
}

function shouldSupplementWithSecondary(primaryResult, products, queryProfile) {
  if (!primaryResult?.ok || primaryResult.items.length === 0) {
    return true;
  }

  const coverage = summarizeCoverage(products, queryProfile);
  if (queryProfile.isBrandQuery) {
    // Brand queries benefit from Serper when primary misses Indian D2C brands
    // (as observed on "Minimalist SPF 50 sunscreen") or returns few brand matches.
    return coverage.brandMatchCount < 4 || coverage.domesticCount < 6;
  }

  // Broad category discovery only supplements when SerpApi returns sparse domestic coverage.
  return coverage.domesticCount < 10 || coverage.distinctBrandCount < 4;
}

/**
 * Intelligent multi-provider router for Mode A beauty discovery (`gl=in`, `hl=en` default).
 * Preserves SerpApi as primary sequentially on both brand and category queries to minimize
 * credit burn, escalates to Serper/SearchApi only when primary results fail or lack domestic
 * brand coverage, and keeps Bright Data strictly as an outage-only last-resort backup.
 */
export async function routeMultiProviderDiscovery({
  query,
  gl = "in",
  hl = "en",
  start = 0,
  displayCurrency = "INR",
}) {
  const queryProfile = detectQueryProfile(query);
  if (isObviouslyNonsenseQuery(query)) {
    return {
      products: [],
      queryProfile,
      providersQueried: [],
      successfulProviders: [],
      providerErrors: {},
      partialSuccess: false,
      isLiveEmpty: true,
      emptyReason: "IRRELEVANT_QUERY",
      serpFilters: [],
      hasNextProviderPage: false,
      nextStart: null,
      quotaDiagnostics: getQuotaDiagnostics(),
    };
  }

  const providersQueried = [];
  const providerErrors = {};
  const collectedNormalizedItems = [];
  const rawResponsesOk = [];
  let serpFilters = [];
  let hasNextProviderPage = false;
  let nextStart = null;

  const serpCallable = canCallProvider(PROVIDER_IDS.SERPAPI).allowed;
  const serperCallable = canCallProvider(PROVIDER_IDS.SERPER).allowed;
  const searchApiCallable = canCallProvider(PROVIDER_IDS.SEARCHAPI).allowed;
  const apifyCallable = canCallProvider(PROVIDER_IDS.APIFY).allowed;
  const brightDataCallable = canCallProvider(PROVIDER_IDS.BRIGHTDATA).allowed;

  const calledProviders = new Set();
  const evaluateIntermediateProducts = () =>
    filterRelevantDiscoveryProducts(
      deduplicateAndAggregateProducts(collectedNormalizedItems, {
        displayCurrency,
        registerInServerCache: false,
      }),
      query,
      queryProfile
    );

  const runProvider = async (adapter) => {
    if (calledProviders.has(adapter.id)) {
      return null;
    }
    calledProviders.add(adapter.id);
    providersQueried.push(adapter.id);
    const res = await adapter.searchProducts(query, { gl, hl, start });
    if (res.ok) {
      rawResponsesOk.push(adapter.id);
    }
    if (!res.ok) {
      providerErrors[adapter.id] = {
        errorType: res.errorType || "PROVIDER_UNAVAILABLE",
        message: res.errorMessage || "Provider call failed.",
      };
    } else if (res.errorType === "EMPTY_RESULTS") {
      providerErrors[adapter.id] = {
        errorType: "EMPTY_RESULTS",
        message: res.errorMessage || "Zero matching results.",
      };
    }
    if (Array.isArray(res.items) && res.items.length > 0) {
      collectedNormalizedItems.push(...res.items);
    }
    if (adapter.id === PROVIDER_IDS.SERPAPI) {
      serpFilters = res.serpFilters || [];
      hasNextProviderPage = Boolean(res.hasNextProviderPage);
      nextStart = res.nextStart ?? null;
    }
    return res;
  };

  /**
   * Sequentially runs Apify strictly as a cost-controlled fallback after existing providers,
   * only when prior providers failed, returned zero usable results, or stayed below minimum coverage.
   */
  const maybeRunApifyFallback = async (currentProducts) => {
    if (!apifyCallable || start !== 0) {
      return currentProducts;
    }
    const healthyZeroRelevant =
      rawResponsesOk.length > 0 &&
      collectedNormalizedItems.length > 0 &&
      currentProducts.length === 0;
    if (healthyZeroRelevant) {
      return currentProducts;
    }

    const cov = summarizeCoverage(currentProducts, queryProfile);
    const needsApify = queryProfile.isBrandQuery
      ? rawResponsesOk.length === 0 ||
        currentProducts.length === 0 ||
        cov.brandMatchCount < 3 ||
        cov.domesticCount < 5
      : rawResponsesOk.length === 0 ||
        currentProducts.length === 0 ||
        cov.domesticCount < 5;

    if (!needsApify) {
      return currentProducts;
    }

    await runProvider(ApifyProvider);
    return evaluateIntermediateProducts();
  };

  // Strategy 1: Brand queries call SerpApi first, invoking Serper, SearchApi, and Apify
  // sequentially only when primary results fail or return insufficient domestic brand matches.
  if (queryProfile.isBrandQuery && start === 0) {
    let serpRes = null;
    if (serpCallable) {
      serpRes = await runProvider(SerpApiProvider);
    }

    let currentProducts = evaluateIntermediateProducts();
    let cov = summarizeCoverage(currentProducts, queryProfile);

    const serpRespondedCleanZeroRelevant =
      serpRes?.ok &&
      Array.isArray(serpRes.items) &&
      serpRes.items.length > 0 &&
      currentProducts.length === 0;

    if (
      serperCallable &&
      !serpRespondedCleanZeroRelevant &&
      (!serpRes?.ok || cov.brandMatchCount < 4 || cov.domesticCount < 6)
    ) {
      await runProvider(SerperProvider);
      currentProducts = evaluateIntermediateProducts();
      cov = summarizeCoverage(currentProducts, queryProfile);
    }

    const anyProviderHealthyWithZeroRelevant =
      rawResponsesOk.length > 0 &&
      collectedNormalizedItems.length > 0 &&
      currentProducts.length === 0;

    // Fallback to SearchApi only when SerpApi / Serper left brand matches sparse or failed.
    if (
      !anyProviderHealthyWithZeroRelevant &&
      (rawResponsesOk.length === 0 || cov.brandMatchCount < 3 || cov.domesticCount < 5) &&
      searchApiCallable
    ) {
      await runProvider(SearchApiProvider);
      currentProducts = evaluateIntermediateProducts();
      cov = summarizeCoverage(currentProducts, queryProfile);
    }

    // Controlled sequential fallback to Apify only if existing providers remain insufficient/failed.
    currentProducts = await maybeRunApifyFallback(currentProducts);

    // Last-resort outage-only failover to Bright Data (never called if any existing provider succeeded).
    const postSearchHealthyZero =
      rawResponsesOk.length > 0 &&
      collectedNormalizedItems.length > 0 &&
      currentProducts.length === 0;
    if (
      brightDataCallable &&
      !postSearchHealthyZero &&
      rawResponsesOk.length === 0
    ) {
      await runProvider(BrightDataProvider);
    }
  } else {
    // Strategy 2: Broad category or paginated discovery leads with SerpApi primary.
    let serpRes = null;
    if (serpCallable) {
      serpRes = await runProvider(SerpApiProvider);
    }

    let intermediateProducts = evaluateIntermediateProducts();

    const serpRespondedCleanZeroRelevant =
      serpRes?.ok &&
      Array.isArray(serpRes.items) &&
      serpRes.items.length > 0 &&
      intermediateProducts.length === 0;

    if (
      start === 0 &&
      !serpRespondedCleanZeroRelevant &&
      shouldSupplementWithSecondary(serpRes, intermediateProducts, queryProfile)
    ) {
      if (serperCallable) {
        const serperRes = await runProvider(SerperProvider);
        intermediateProducts = evaluateIntermediateProducts();

        const bothHealthyZeroRelevant =
          serpRes?.ok && serperRes?.ok && intermediateProducts.length === 0;
        if (bothHealthyZeroRelevant) {
          return {
            products: [],
            queryProfile,
            providersQueried,
            successfulProviders: [...new Set(rawResponsesOk)],
            providerErrors,
            partialSuccess: false,
            isLiveEmpty: true,
            emptyReason: "IRRELEVANT_QUERY",
            serpFilters,
            hasNextProviderPage: false,
            nextStart: null,
            quotaDiagnostics: getQuotaDiagnostics(),
          };
        }
      }

      let postSerperCov = summarizeCoverage(intermediateProducts, queryProfile);
      if (
        searchApiCallable &&
        (!serpRes?.ok || postSerperCov.domesticCount < 10)
      ) {
        await runProvider(SearchApiProvider);
        intermediateProducts = evaluateIntermediateProducts();
        postSerperCov = summarizeCoverage(intermediateProducts, queryProfile);
      }

      intermediateProducts = await maybeRunApifyFallback(intermediateProducts);

      const healthyZeroAfterSecondary =
        rawResponsesOk.length > 0 &&
        collectedNormalizedItems.length > 0 &&
        intermediateProducts.length === 0;
      if (
        brightDataCallable &&
        !healthyZeroAfterSecondary &&
        rawResponsesOk.length === 0
      ) {
        await runProvider(BrightDataProvider);
      }
    } else if (!serpCallable) {
      // SerpApi disabled or circuit open -> degrade gracefully to Serper / SearchApi,
      // then controlled Apify fallback, reserving Bright Data for complete upstream outage.
      if (serperCallable) {
        await runProvider(SerperProvider);
      }
      intermediateProducts = evaluateIntermediateProducts();
      if (intermediateProducts.length < 8 && searchApiCallable) {
        await runProvider(SearchApiProvider);
        intermediateProducts = evaluateIntermediateProducts();
      }
      intermediateProducts = await maybeRunApifyFallback(intermediateProducts);
      if (
        brightDataCallable &&
        start === 0 &&
        rawResponsesOk.length === 0
      ) {
        await runProvider(BrightDataProvider);
      }
    }
  }

  // Final pass deduplicates, filters out irrelevant fuzzy noise, and preserves tokens server-side.
  const aggregatedProducts = deduplicateAndAggregateProducts(collectedNormalizedItems, {
    displayCurrency,
    registerInServerCache: true,
  });
  const finalProducts = filterRelevantDiscoveryProducts(
    aggregatedProducts,
    query,
    queryProfile
  );

  const successfulProviders = [...new Set(rawResponsesOk)];
  const hasAnyError = Object.keys(providerErrors).length > 0;
  const partialSuccess =
    hasAnyError && finalProducts.length > 0 && successfulProviders.length > 0;
  const isLiveEmpty = finalProducts.length === 0 && successfulProviders.length > 0;

  return {
    products: finalProducts,
    queryProfile,
    providersQueried,
    successfulProviders,
    providerErrors,
    partialSuccess,
    isLiveEmpty,
    emptyReason: isLiveEmpty ? "EMPTY_RESULTS" : null,
    serpFilters,
    hasNextProviderPage,
    nextStart,
    quotaDiagnostics: getQuotaDiagnostics(),
  };
}

