import { NextResponse } from "next/server";
import {
  mockCatalog,
  TARGET_RETAILERS,
  RETAILER_DEFAULTS,
  buildRetailerSearchUrl,
} from "@/data/mockCatalog";
import {
  matchMockProduct,
  parsePriceString,
  computeOfferAnalytics,
  computePriceIntelligence,
  sortOffers,
  extractVariantSignature,
  evaluateProductIdentity,
  evaluateVariantComparison,
  volumesCompatible,
  areFormulationsCompatible,
  isBroadCategoryQuery,
  normalizeText,
} from "@/lib/utils";
import {
  buildSnapshotKey,
  recordLivePriceSnapshot,
} from "@/lib/priceSnapshots";
import { validateRetailerProductUrl } from "@/lib/urlValidator";
import { extractBrandFromItem } from "@/lib/catalogIdentity";
import {
  getRegisteredProduct,
  registerDiscoveredProduct,
  getCachedComparison,
  setCachedComparison,
  coalescedComparisonFetch,
} from "@/lib/discoveryCache";
import {
  fetchOffersByProductToken,
  SearchApiProvider,
} from "@/lib/providers/searchApiProvider";
import { fetchImmersiveStoresByTokens } from "@/lib/providers/serpApiProvider";
import { getConfiguredProviders } from "@/lib/providers/providerRegistry";
import {
  PROVIDER_IDS,
  canCallProvider,
  getQuotaDiagnostics,
  redactSecrets,
} from "@/lib/search/quotaManager";
import {
  CACHE_TTL_MS as SEARCH_CACHE_TTL_MS,
  buildSearchCacheKey,
  getSearchCacheEntry,
  setSearchCacheEntry,
} from "@/lib/search/searchCache";

const CACHE_TTL_MS = SEARCH_CACHE_TTL_MS.offers;

function getCompareCache() {
  if (!globalThis.__luxeCompareCache) {
    globalThis.__luxeCompareCache = new Map();
  }
  return globalThis.__luxeCompareCache;
}

function mapToTargetRetailer(source = "", link = "") {
  const combined = `${source} ${link}`.toLowerCase();
  if (combined.includes("sephora")) return "Sephora";
  if (combined.includes("nykaa")) return "Nykaa";
  if (combined.includes("amazon")) return "Amazon Luxury";
  if (combined.includes("cultbeauty") || combined.includes("cult beauty")) {
    return "Cult Beauty";
  }
  if (combined.includes("spacenk") || combined.includes("space nk")) {
    return "Space NK";
  }
  return null;
}

function cleanMerchantName(source = "") {
  let resolved = source;
  if (resolved && typeof resolved === "object" && !Array.isArray(resolved)) {
    resolved =
      resolved.name ||
      resolved.display_name ||
      resolved.title ||
      resolved.merchant_name ||
      resolved.seller_name ||
      resolved.store ||
      "";
  }
  const raw = typeof resolved === "string" ? resolved.trim() : "";
  if (!raw || raw.toLowerCase() === "[object object]") return null;

  const lower = raw.toLowerCase();
  if (lower.includes("minimalist")) return "Minimalist";
  if (lower.includes("deconstruct")) return "The Deconstruct";
  if (lower.includes("dmart")) return "DMart Ready";
  if (lower.includes("dawaadost")) return "DawaaDost";
  if (lower.includes("looknstyle")) return "Looknstyle";
  if (lower.includes("purplle")) return "Purplle";
  if (lower.includes("ajio")) return "Ajio Luxe";
  if (lower.includes("myntra")) return "Myntra";
  if (lower.includes("flipkart")) return "Flipkart";
  if (lower.includes("clinikally")) return "Clinikally";
  if (lower.includes("tira")) return "Tira Beauty";
  if (lower.includes("shoppers stop")) return "Shoppers Stop";
  if (lower.includes("tatacliq") || lower.includes("tata cliq")) return "Tata CLiQ";
  if (lower.includes("maccaron")) return "Maccaron";
  if (lower.includes("jiomart")) return "JioMart";
  if (lower.includes("1mg")) return "Tata 1mg";
  if (lower.includes("pharmeasy")) return "PharmEasy";
  if (lower.includes("apollo")) return "Apollo 247";
  if (lower.includes("blinkit")) return "Blinkit";
  if (lower.includes("zepto")) return "Zepto";
  if (lower.includes("instamart")) return "Swiggy Instamart";
  if (lower.includes("bigbasket") || lower.includes("bbnow")) return "BigBasket";
  if (lower.includes("foxy")) return "Foxy";
  if (lower.includes("boddess")) return "Boddess";
  if (lower.includes("kindlife")) return "Kindlife";
  if (lower.includes("sweetcare")) return "SweetCare";
  if (lower.includes("styledotty")) return "StyleDotty";
  if (lower.includes("smytten")) return "Smytten";
  if (lower.includes("healthmug")) return "HealthMug";
  if (lower.includes("beautybarn") || lower.includes("beauty barn")) return "Beauty Barn";
  if (lower.includes("limese")) return "Limese";
  if (lower.includes("kiwla")) return "KIWLA";
  if (lower.includes("gosupps")) return "GoSupps";
  if (lower.includes("meesho")) return "Meesho";
  if (lower.includes("desertcart")) return "Desertcart";
  if (lower.includes("ubuy")) return "Ubuy";
  if (lower.includes("ulta")) return "Ulta Beauty";
  if (lower.includes("nordstrom")) return "Nordstrom";
  if (lower.includes("dermstore")) return "Dermstore";

  return raw
    .replace(/\s+-\s+.*$/, "")
    .replace(/\s+(?:now|minutes|express)$/i, "")
    .replace(/\.(com|in|co\.uk|co\.in|ae|sa)$/i, "")
    .replace(/[&,:;-]+$/g, "")
    .trim();
}

const KNOWN_REPUTABLE_STORES = new Set([
  "Minimalist",
  "The Deconstruct",
  "DMart Ready",
  "DawaaDost",
  "Looknstyle",
  "Tira Beauty",
  "Ajio Luxe",
  "Myntra",
  "Purplle",
  "Clinikally",
  "Shoppers Stop",
  "Tata CLiQ",
  "Maccaron",
  "Flipkart",
  "JioMart",
  "Tata 1mg",
  "PharmEasy",
  "Apollo 247",
  "Blinkit",
  "Zepto",
  "Swiggy Instamart",
  "BigBasket",
  "Foxy",
  "Boddess",
  "Kindlife",
  "SweetCare",
  "StyleDotty",
  "Smytten",
  "HealthMug",
  "Beauty Barn",
  "Limese",
  "KIWLA",
  "GoSupps",
  "Meesho",
  "Desertcart",
  "Ubuy",
  "Ulta Beauty",
  "Nordstrom",
  "Dermstore",
]);

/**
 * Strictly resolve a live retailer product URL without ever falling back
 * to Google Shopping (`product_link`), retailer homepages, or generic search pages.
 */
function resolveLiveDirectUrl(item, retailerName, expectedProduct = null) {
  const candidates = [
    item?.direct_link,
    item?.link,
    item?.merchant_link,
    item?.url,
  ];
  let lastReason = "Merchant destination URL missing";

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "string") continue;
    const check = validateRetailerProductUrl(candidate, retailerName, {
      allowSearchUrl: false,
      expectedProduct,
    });
    if (check.valid && check.linkType === "exact_product") {
      return {
        storeUrl: check.url,
        linkType: "exact_product",
        linkHostname: check.hostname,
        linkStatusLabel: "Exact Product Link",
        linkRejectReason: null,
      };
    }
    if (check.reason) {
      lastReason = check.reason;
    }
  }

  return {
    storeUrl: null,
    linkType: "unavailable",
    linkHostname: "",
    linkStatusLabel: "Direct product link unavailable",
    linkRejectReason: lastReason,
  };
}

function isLikelyPromoOrSample(item, parsed, query) {
  const queryLower = query.toLowerCase();
  const titleLower = String(item.title || "").toLowerCase();
  const minThreshold = parsed.currency === "USD" ? 2 : 50;

  if (parsed.amount < minThreshold) return true;

  if (
    !queryLower.includes("sample") &&
    !queryLower.includes("mini") &&
    !queryLower.includes("sachet") &&
    /\b(free gift|sample|sachet|trial pack|tester)\b/i.test(titleLower)
  ) {
    return true;
  }

  return false;
}

function parseDeliveryMetadata(deliveryText, currencyFallback) {
  if (!deliveryText || typeof deliveryText !== "string" || !deliveryText.trim()) {
    return {
      shippingInfo: "Shipping not disclosed",
      shippingDisclosed: false,
      shippingCost: null,
      shippingDays: null,
      estimatedDelivery: null,
    };
  }

  const raw = deliveryText.trim();
  const lower = raw.toLowerCase();

  let shippingCost = null;
  if (/\bfree\b/i.test(lower)) {
    shippingCost = 0;
  } else {
    const costParsed = parsePriceString(raw, currencyFallback);
    if (costParsed.amount != null && /[₹$]|\brs|\binr|\busd|\bdelivery\b/i.test(lower)) {
      shippingCost = costParsed.amount;
    }
  }

  let shippingDays = null;
  if (
    lower.includes("next day") ||
    lower.includes("tomorrow") ||
    lower.includes("1 day") ||
    lower.includes("1-day") ||
    lower.includes("same day")
  ) {
    shippingDays = 1;
  } else {
    const rangeMatch = lower.match(/(\d+)\s*(?:-|to|–)\s*(\d+)\s*(?:business\s*)?days?/i);
    const singleMatch = lower.match(/(\d+)\s*(?:business\s*)?days?/i);
    if (rangeMatch) {
      shippingDays = parseInt(rangeMatch[2], 10);
    } else if (singleMatch) {
      shippingDays = parseInt(singleMatch[1], 10);
    } else if (lower.includes("express")) {
      shippingDays = 2;
    }
  }

  return {
    shippingInfo: raw,
    shippingDisclosed: true,
    shippingCost,
    shippingDays,
    estimatedDelivery: raw,
  };
}

function parseOfferFromSerpItem(
  item,
  retailerName,
  isTargetRetailer,
  gl,
  query,
  identityEval,
  fetchedAt
) {
  const defaultCurr = gl === "us" ? "USD" : "INR";
  const parsed =
    typeof item.extracted_price === "number" && item.extracted_price > 0
      ? {
          amount: item.extracted_price,
          currency: parsePriceString(item.price, defaultCurr).currency,
        }
      : parsePriceString(item.price, defaultCurr);

  if (!parsed.amount || parsed.amount <= 0) return null;
  if (isLikelyPromoOrSample(item, parsed, query)) return null;

  let originalPrice = null;
  const extractedOld = item.extracted_old_price ?? item.extracted_base_price;
  const rawOld = item.old_price || item.base_price || item.original_price;
  if (typeof extractedOld === "number" && extractedOld > parsed.amount) {
    originalPrice = extractedOld;
  } else if (rawOld) {
    const parsedOld = parsePriceString(rawOld, parsed.currency);
    if (parsedOld.amount && parsedOld.amount > parsed.amount) {
      originalPrice = parsedOld.amount;
    }
  }

  const discountPercent =
    originalPrice && originalPrice > parsed.amount
      ? Math.round(((originalPrice - parsed.amount) / originalPrice) * 100)
      : null;

  const shipping = parseDeliveryMetadata(
    item.delivery || item.shipping,
    parsed.currency
  );
  const tagText = `${item.tag || ""} ${item.second_hand_condition || ""}`;
  const isOutOfStock = /out of stock|unavailable|sold out/i.test(tagText);
  const lowStockMatch = tagText.match(/only \d+ left/i);
  const explicitInStock = /in stock|available/i.test(tagText);
  const expectedProduct = {
    brand:
      extractBrandFromItem({ title: query }) !== "Independent / Other"
        ? extractBrandFromItem({ title: query })
        : extractBrandFromItem({ title: item.title || "", source: retailerName }),
    size: identityEval?.detectedVolume || null,
  };
  const urlInfo = resolveLiveDirectUrl(item, retailerName, expectedProduct);
  const detectedPackCount = identityEval?.detectedPackCount || 1;
  const variantBadgeParts = [
    identityEval?.detectedFormulationLabel || null,
    identityEval?.detectedSpf ? identityEval.detectedSpf.toUpperCase() : null,
    identityEval?.detectedConcentration || null,
    detectedPackCount > 1 ? `Pack of ${detectedPackCount}` : null,
    identityEval?.detectedVolume || null,
  ].filter(Boolean);

  return {
    retailer: retailerName,
    price: parsed.amount,
    originalPrice,
    discountPercent,
    currency: parsed.currency || defaultCurr,
    inStock: !isOutOfStock,
    stockLabel: isOutOfStock
      ? "Out of Stock"
      : lowStockMatch
      ? lowStockMatch[0]
      : explicitInStock
      ? "In Stock"
      : "Listed Active",
    shippingInfo: shipping.shippingInfo,
    shippingDisclosed: shipping.shippingDisclosed,
    shippingCost: shipping.shippingCost,
    shippingDays: shipping.shippingDays,
    estimatedDelivery: shipping.estimatedDelivery,
    storeRating: typeof item.rating === "number" ? item.rating : null,
    verified: isTargetRetailer || urlInfo.linkType === "exact_product",
    storeTag: isTargetRetailer
      ? "Verified Flagship Store"
      : urlInfo.linkType === "exact_product"
      ? "Verified Product Page"
      : "Google Shopping Merchant",
    isTargetRetailer,
    dataSource: "LIVE_OBSERVED",
    variantClassification: identityEval?.classification || "unverified",
    variantMatchStatus: identityEval?.matchStatus || "unverified-size",
    variantStatusLabel:
      identityEval?.variantStatusLabel ||
      (identityEval?.classification === "exact"
        ? "Exact Variant Match"
        : identityEval?.classification === "variant"
        ? "Other available variant"
        : "Variant unverified"),
    variantNote: identityEval?.reason || null,
    variantDifferences: identityEval?.variantDifferences || [],
    missingVariantFields: identityEval?.missingVariantFields || [],
    detectedVolume: identityEval?.detectedVolume || null,
    detectedSpf: identityEval?.detectedSpf || null,
    detectedConcentration: identityEval?.detectedConcentration || null,
    detectedPackCount,
    detectedFormulation: identityEval?.detectedFormulation || null,
    detectedFormulationLabel: identityEval?.detectedFormulationLabel || null,
    variant: variantBadgeParts.join(" · ") || null,
    matchedTitle: item.title || query,
    lastUpdated: fetchedAt,
    storeUrl: urlInfo.storeUrl,
    linkType: urlInfo.linkType,
    linkHostname: urlInfo.linkHostname,
    linkStatusLabel: urlInfo.linkStatusLabel,
    isLive: true,
  };
}

function classifySerpError(err) {
  const msg = String(err?.message || "");
  const lower = msg.toLowerCase();
  if (lower.includes("429") || lower.includes("quota") || lower.includes("run out of searches")) {
    return {
      errorType: "QUOTA_EXHAUSTED",
      reason: "Live search quota temporarily exhausted on Google Shopping provider.",
    };
  }
  if (err?.name === "TimeoutError" || lower.includes("timeout") || lower.includes("abort")) {
    return {
      errorType: "TIMEOUT",
      reason: "Live shopping provider timed out before completing store aggregation.",
    };
  }
  return {
    errorType: "PROVIDER_ERROR",
    reason: msg || "Live shopping feed unavailable for this request.",
  };
}

function registerLiveOffer(targetRetailersMap, otherStoresMap, offer) {
  const bucket = offer.isTargetRetailer ? targetRetailersMap : otherStoresMap;
  const existing = bucket.get(offer.retailer);

  if (!existing) {
    bucket.set(offer.retailer, offer);
    return;
  }

  const newHasDirect = offer.linkType === "exact_product";
  const oldHasDirect = existing.linkType === "exact_product";

  if (newHasDirect && !oldHasDirect) {
    bucket.set(offer.retailer, offer);
    return;
  }
  if (newHasDirect === oldHasDirect && offer.price < existing.price) {
    bucket.set(offer.retailer, offer);
  }
}

function getItemCandidateMeta(item = {}) {
  return [
    Array.isArray(item.extensions) ? item.extensions.join(" ") : "",
    item.snippet || "",
    item.description || "",
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function selectDominantVariantTarget(storeEntries = [], baseTarget = {}) {
  const broad = isBroadCategoryQuery(baseTarget.query) && !baseTarget.referenceTitle;
  if (broad) return baseTarget;
  if (baseTarget.volume && baseTarget.formulation && baseTarget.spf) {
    return baseTarget;
  }

  const clusters = new Map();
  for (const item of storeEntries) {
    const merchantUrl = item.direct_link || item.link || "";
    const meta = getItemCandidateMeta(item);
    const prelim = evaluateVariantComparison({
      query: baseTarget.query,
      candidateTitle: item.title || "",
      candidateUrl: merchantUrl,
      candidateSource: cleanMerchantName(item.source || item.merchant) || "",
      candidateMetadata: meta,
      referenceTitle: baseTarget.referenceTitle,
      expectedVolume: baseTarget.volume,
      expectedSpf: baseTarget.spf,
      expectedConcentration: baseTarget.concentration,
      expectedPackCount: baseTarget.packCount,
      expectedFormulation: baseTarget.formulation,
      expectedFormulationLabel: baseTarget.formulationLabel,
    });
    if (prelim.classification === "unrelated") continue;
    const sig = prelim.candidateSignature;
    if (!sig) continue;

    // Only cluster within entries compatible with whatever variant axes were explicitly requested.
    // When target volume is already known (e.g., 30g), ignore sizeless listings so another bottle's
    // formulation (e.g., sizeless Light Fluid) cannot override the 30g formulation.
    if (
      baseTarget.volume &&
      (!sig.volume || !volumesCompatible(baseTarget.volume, sig.volume))
    ) {
      continue;
    }
    if (baseTarget.spf && sig.spf && sig.spf !== baseTarget.spf) {
      continue;
    }
    if (
      baseTarget.formulation &&
      sig.formulation &&
      !areFormulationsCompatible(
        baseTarget.formulation,
        sig.formulation,
        sig.formulationTags,
        baseTarget.formulationTags || []
      )
    ) {
      continue;
    }
    if (!baseTarget.isBundle && sig.packCount > 1) continue;
    if (!sig.volume && !sig.formulation && !sig.spf) continue;

    const key = [
      sig.volume || "",
      sig.spf || "",
      sig.formulation || "",
      sig.concentration || "",
    ].join("|");
    if (!clusters.has(key)) {
      clusters.set(key, { count: 0, sig });
    }
    clusters.get(key).count += 1;
  }

  if (clusters.size === 0) return baseTarget;
  const best = [...clusters.values()].sort((a, b) => {
    const aRich =
      (a.sig.volume ? 2 : 0) + (a.sig.formulation ? 1 : 0) + (a.sig.spf ? 1 : 0);
    const bRich =
      (b.sig.volume ? 2 : 0) + (b.sig.formulation ? 1 : 0) + (b.sig.spf ? 1 : 0);
    if (b.count !== a.count) return b.count - a.count;
    return bRich - aRich;
  })[0];

  return {
    ...baseTarget,
    volume: baseTarget.volume || best.sig.volume || null,
    spf: baseTarget.spf || best.sig.spf || null,
    concentration: baseTarget.concentration || best.sig.concentration || null,
    formulation: baseTarget.formulation || best.sig.formulation || null,
    formulationLabel: baseTarget.formulationLabel || best.sig.formulationLabel || null,
    formulationTags:
      baseTarget.formulationTags?.length > 0
        ? baseTarget.formulationTags
        : best.sig.formulationTags || [],
  };
}

/**
 * Partitions candidate merchant items strictly into:
 * - exactOffers: Verified exact SKU matches ONLY (drives primary price comparison & summary)
 * - unverifiedOffers: Same product line missing size/SPF/formulation confirmation ("Variant unverified")
 * - otherVariants: Related sibling variants ("Other available variants": 30g/100ml, multipacks, SPFs, formulations)
 */
function partitionVariantOffers({
  items = [],
  baseTarget = {},
  gl = "in",
  fetchedAt,
}) {
  const resolvedTarget = selectDominantVariantTarget(items, baseTarget);
  const exactTargetMap = new Map();
  const exactOtherMap = new Map();
  const unverifiedMap = new Map();
  const otherVariantsMap = new Map();
  const seenItems = new Set();
  let excludedUnrelatedCount = 0;

  for (const storeItem of items) {
    const merchantUrl = storeItem.direct_link || storeItem.link || "";
    const targetRetailer = mapToTargetRetailer(
      storeItem.source || storeItem.merchant,
      merchantUrl
    );
    const retailerName =
      targetRetailer || cleanMerchantName(storeItem.source || storeItem.merchant);
    if (!retailerName) continue;

    const dedupeKey = normalizeText(
      `${retailerName} ${storeItem.title || ""} ${merchantUrl}`
    );
    if (seenItems.has(dedupeKey)) continue;
    seenItems.add(dedupeKey);

    const identityEval = evaluateVariantComparison({
      query: resolvedTarget.query,
      candidateTitle: storeItem.title || "",
      candidateUrl: merchantUrl,
      candidateSource: retailerName,
      candidateMetadata: getItemCandidateMeta(storeItem),
      referenceTitle: resolvedTarget.referenceTitle,
      expectedVolume: resolvedTarget.volume,
      expectedSpf: resolvedTarget.spf,
      expectedConcentration: resolvedTarget.concentration,
      expectedPackCount: resolvedTarget.packCount,
      expectedFormulation: resolvedTarget.formulation,
      expectedFormulationLabel: resolvedTarget.formulationLabel,
      expectedFormulationTags: resolvedTarget.formulationTags || [],
    });

    if (identityEval.classification === "unrelated") {
      excludedUnrelatedCount++;
      continue;
    }

    const parsedOffer = parseOfferFromSerpItem(
      storeItem,
      retailerName,
      Boolean(targetRetailer),
      gl,
      resolvedTarget.query,
      identityEval,
      fetchedAt
    );
    if (!parsedOffer) continue;

    if (identityEval.classification === "exact") {
      registerLiveOffer(exactTargetMap, exactOtherMap, parsedOffer);
      continue;
    }

    if (identityEval.classification === "unverified") {
      const uKey = normalizeText(
        `${parsedOffer.retailer} ${parsedOffer.matchedTitle || ""}`
      );
      const existing = unverifiedMap.get(uKey);
      if (
        !existing ||
        (parsedOffer.linkType === "exact_product" &&
          existing.linkType !== "exact_product") ||
        (parsedOffer.linkType === existing.linkType &&
          parsedOffer.price < existing.price)
      ) {
        unverifiedMap.set(uKey, parsedOffer);
      }
      continue;
    }

    // classification === "variant" -> separate "Other available variants" bucket
    const vKey = normalizeText(
      `${parsedOffer.retailer} ${parsedOffer.variant || parsedOffer.matchedTitle}`
    );
    const existing = otherVariantsMap.get(vKey);
    if (
      !existing ||
      (parsedOffer.linkType === "exact_product" &&
        existing.linkType !== "exact_product") ||
      (parsedOffer.linkType === existing.linkType &&
        parsedOffer.price < existing.price)
    ) {
      otherVariantsMap.set(vKey, parsedOffer);
    }
  }

  const exactOffers = [];
  for (const retailer of TARGET_RETAILERS) {
    if (exactTargetMap.has(retailer)) {
      exactOffers.push(exactTargetMap.get(retailer));
    }
  }
  const prioritizedExactOthers = [...exactOtherMap.values()].sort((a, b) => {
    const aDirect = a.linkType === "exact_product" ? 0 : 1;
    const bDirect = b.linkType === "exact_product" ? 0 : 1;
    if (aDirect !== bDirect) return aDirect - bDirect;
    const aKnown = KNOWN_REPUTABLE_STORES.has(a.retailer) ? 0 : 1;
    const bKnown = KNOWN_REPUTABLE_STORES.has(b.retailer) ? 0 : 1;
    if (aKnown !== bKnown) return aKnown - bKnown;
    return (a.price ?? Infinity) - (b.price ?? Infinity);
  });
  for (const offer of prioritizedExactOthers) {
    if (exactOffers.length >= 8) break;
    exactOffers.push(offer);
  }

  const sortSecondaryBucket = (list, limit) =>
    list
      .sort((a, b) => {
        const aDirect = a.linkType === "exact_product" ? 0 : 1;
        const bDirect = b.linkType === "exact_product" ? 0 : 1;
        if (aDirect !== bDirect) return aDirect - bDirect;
        if (a.isTargetRetailer !== b.isTargetRetailer) {
          return a.isTargetRetailer ? -1 : 1;
        }
        return (a.price ?? Infinity) - (b.price ?? Infinity);
      })
      .slice(0, limit);

  const unverifiedOffers = sortSecondaryBucket([...unverifiedMap.values()], 12);
  const otherVariants = sortSecondaryBucket([...otherVariantsMap.values()], 16);

  const flagshipCoverage = TARGET_RETAILERS.map((retailer) => {
    const matchedOffer = exactTargetMap.get(retailer);
    return {
      retailer,
      available: Boolean(matchedOffer),
      inStock: matchedOffer ? matchedOffer.inStock : false,
      price: matchedOffer ? matchedOffer.price : null,
      currency: matchedOffer ? matchedOffer.currency : null,
      storeUrl: matchedOffer?.storeUrl || null,
      linkType: matchedOffer?.linkType || "unavailable",
      linkHostname: matchedOffer?.linkHostname || "",
    };
  });

  return {
    resolvedTarget,
    exactOffers,
    unverifiedOffers,
    otherVariants,
    excludedUnrelatedCount,
    flagshipCoverage,
    variantSummary: {
      exactCount: exactOffers.length,
      unverifiedCount: unverifiedOffers.length,
      otherVariantCount: otherVariants.length,
      excludedUnrelatedCount,
      targetVariant: {
        volume: resolvedTarget.volume || null,
        spf: resolvedTarget.spf || null,
        concentration: resolvedTarget.concentration || null,
        packCount: resolvedTarget.packCount || 1,
        isBundle: Boolean(resolvedTarget.isBundle),
        formulation: resolvedTarget.formulation || null,
        formulationLabel: resolvedTarget.formulationLabel || null,
      },
    },
    hasAnyOffers:
      exactOffers.length > 0 ||
      unverifiedOffers.length > 0 ||
      otherVariants.length > 0,
  };
}

function pickImmersiveCandidates(matchedEntries, limit = 8) {
  const seenKeys = new Set();
  const deduped = [];

  for (const entry of matchedEntries) {
    const item = entry.item;
    const immUrl = item?.serpapi_immersive_product_api;
    if (!immUrl) continue;
    const key = String(item.product_id || immUrl);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const pid = String(item.product_id || "").toLowerCase();
    const isExactMatch = entry.identityEval?.matchStatus === "exact";
    const isCluster =
      Boolean(item.multiple_sources) ||
      pid.startsWith("catalogid:") ||
      pid.startsWith("gpcid:");
    const isTarget = Boolean(mapToTargetRetailer(item.source, item.link || ""));
    const merchant = cleanMerchantName(item.source);
    const isKnown = merchant ? KNOWN_REPUTABLE_STORES.has(merchant) : false;

    const score =
      (isCluster ? 18 : 0) +
      (isExactMatch ? 15 : 0) +
      (isTarget ? 6 : 0) +
      (isKnown ? 3 : 0) +
      (typeof item.reviews === "number" && item.reviews > 0 ? 2 : 0);

    deduped.push({ item, score });
  }

  return deduped
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.item);
}

async function fetchImmersiveStoreEntries(candidates, apiKey) {
  if (!candidates.length) return [];

  const settled = await Promise.allSettled(
    candidates.map(async (sourceItem) => {
      const immUrl = new URL(sourceItem.serpapi_immersive_product_api);
      if (!immUrl.searchParams.get("api_key")) {
        immUrl.searchParams.set("api_key", apiKey);
      }
      const res = await fetch(immUrl.toString(), {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(7000),
      });
      if (!res.ok) return [];
      const data = await res.json();
      const pr = data?.product_results;
      const stores = Array.isArray(pr?.stores) ? pr.stores : [];
      const fallbackTitle = pr?.title || sourceItem.title || "";

      return stores.map((store) => ({
        ...store,
        source: store.name || store.source || "",
        title: store.title || fallbackTitle,
        delivery: store.shipping || store.delivery || sourceItem.delivery,
        old_price: store.base_price || store.original_price || store.old_price,
        extracted_old_price:
          store.extracted_base_price ?? store.extracted_old_price,
        rating:
          typeof store.rating === "number"
            ? store.rating
            : typeof pr?.rating === "number"
            ? pr.rating
            : sourceItem.rating,
      }));
    })
  );

  const flattened = [];
  for (const entry of settled) {
    if (entry.status === "fulfilled" && Array.isArray(entry.value)) {
      flattened.push(...entry.value);
    }
  }
  return flattened;
}

async function querySerpApi(query, gl, apiKey) {
  const url = `https://serpapi.com/search.json?engine=google_shopping&q=${encodeURIComponent(
    query
  )}&gl=${encodeURIComponent(gl)}&hl=en&direct_link=true&api_key=${encodeURIComponent(
    apiKey
  )}`;

  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(9500),
  });

  if (!response.ok) {
    throw new Error(`SerpApi responded with status ${response.status}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(data.error);
  }

  const results = Array.isArray(data.shopping_results)
    ? data.shopping_results
    : [];
  if (results.length === 0) {
    return { emptyReason: "NO_RESULTS" };
  }

  const fetchedAt = new Date().toISOString();
  const broadQuery = isBroadCategoryQuery(query);
  const matchedMock = broadQuery ? null : matchMockProduct(query, mockCatalog);
  const querySig = broadQuery ? {} : extractVariantSignature(query);
  const queryVol = querySig.volume || null;

  const matchingLeadCandidates = results.filter(
    (r) =>
      evaluateVariantComparison({
        query,
        candidateTitle: r.title || "",
        candidateUrl: r.link || r.direct_link || "",
        candidateSource: r.source || "",
        candidateMetadata: getItemCandidateMeta(r),
        referenceTitle: matchedMock?.name || query,
        expectedVolume: queryVol || matchedMock?.volume || null,
        expectedSpf: querySig.spf || null,
        expectedConcentration: querySig.concentration || null,
        expectedPackCount: querySig.packCount || 1,
        expectedFormulation: querySig.formulation || null,
        expectedFormulationLabel: querySig.formulationLabel || null,
        expectedFormulationTags: querySig.formulationTags || [],
      }).isMatch
  );
  const sameLineLeadCandidates =
    matchingLeadCandidates.length > 0
      ? matchingLeadCandidates
      : results.filter(
          (r) =>
            evaluateVariantComparison({
              query,
              candidateTitle: r.title || "",
              candidateUrl: r.link || r.direct_link || "",
              candidateSource: r.source || "",
              candidateMetadata: getItemCandidateMeta(r),
              referenceTitle: matchedMock?.name || query,
              expectedVolume: queryVol || matchedMock?.volume || null,
            }).classification !== "unrelated"
        );
  const leadPool = sameLineLeadCandidates.length > 0 ? sameLineLeadCandidates : results;
  const leadResult =
    leadPool.find((r) => r.thumbnail && r.multiple_sources) ||
    leadPool.find((r) => r.thumbnail && r.rating) ||
    leadPool.find((r) => r.thumbnail) ||
    leadPool[0];

  const referenceTitle = matchedMock?.name || query;
  const mockSig = matchedMock?.name ? extractVariantSignature(matchedMock.name) : {};
  const baseTarget = {
    query,
    referenceTitle,
    volume: broadQuery
      ? null
      : querySig.volume || matchedMock?.volume || mockSig.volume || null,
    spf: broadQuery ? null : querySig.spf || mockSig.spf || null,
    concentration: broadQuery
      ? null
      : querySig.concentration || mockSig.concentration || null,
    packCount: broadQuery ? 1 : querySig.packCount || 1,
    isBundle: broadQuery ? false : Boolean(querySig.isBundle),
    formulation: broadQuery
      ? null
      : querySig.formulation || mockSig.formulation || null,
    formulationLabel: broadQuery
      ? null
      : querySig.formulationLabel || mockSig.formulationLabel || null,
    formulationTags: broadQuery
      ? []
      : querySig.formulationTags?.length
      ? querySig.formulationTags
      : mockSig.formulationTags || [],
  };

  const preMatchedShoppingItems = [];
  for (const item of results) {
    const identityEval = evaluateVariantComparison({
      query,
      candidateTitle: item.title || "",
      candidateUrl: item.link || item.direct_link || "",
      candidateSource: item.source || "",
      candidateMetadata: getItemCandidateMeta(item),
      referenceTitle,
      expectedVolume: baseTarget.volume,
      expectedSpf: baseTarget.spf,
      expectedConcentration: baseTarget.concentration,
      expectedPackCount: baseTarget.packCount,
      expectedFormulation: baseTarget.formulation,
      expectedFormulationLabel: baseTarget.formulationLabel,
      expectedFormulationTags: baseTarget.formulationTags,
    });

    if (identityEval.classification === "unrelated") {
      continue;
    }

    preMatchedShoppingItems.push({ item, identityEval });
  }

  // Follow up to 5 top matched Google Shopping entries (prioritizing `multiple_sources`
  // product clusters) into `google_immersive_product` for true merchant PDP URLs.
  const immersiveCandidates = pickImmersiveCandidates(
    preMatchedShoppingItems,
    5
  );
  const immersiveStores = await fetchImmersiveStoreEntries(
    immersiveCandidates,
    apiKey
  );

  const partitioned = partitionVariantOffers({
    items: [...immersiveStores, ...results],
    baseTarget,
    gl,
    fetchedAt,
  });

  if (!partitioned.hasAnyOffers) {
    return {
      emptyReason:
        partitioned.excludedUnrelatedCount > 0
          ? "UNRELATED_FILTERED"
          : "NO_VALID_OFFERS",
      excludedMismatchCount: partitioned.excludedUnrelatedCount,
    };
  }

  const {
    resolvedTarget,
    exactOffers,
    unverifiedOffers,
    otherVariants,
    excludedUnrelatedCount,
    flagshipCoverage,
    variantSummary,
  } = partitioned;

  const expectedVolume = resolvedTarget.volume || null;
  const pricingPoolForCurrency =
    exactOffers.length > 0
      ? exactOffers
      : unverifiedOffers.length > 0
      ? unverifiedOffers
      : otherVariants;
  const leadCurrency =
    pricingPoolForCurrency[0]?.currency || (gl === "us" ? "USD" : "INR");

  const exactActivePrices = exactOffers
    .filter((o) => o.inStock && typeof o.price === "number" && o.price > 0)
    .map((o) => o.price);
  const exactPricedPool =
    exactActivePrices.length > 0
      ? exactActivePrices
      : exactOffers.filter((o) => o.price > 0).map((o) => o.price);
  const lowestPrice =
    exactPricedPool.length > 0 ? Math.min(...exactPricedPool) : 0;
  const highestPrice =
    exactPricedPool.length > 0 ? Math.max(...exactPricedPool) : 0;
  const bestOffer = exactOffers.find((o) => o.price === lowestPrice);

  const productId =
    matchedMock?.id ||
    encodeURIComponent(query.toLowerCase().replace(/\s+/g, "-"));
  const productName = matchedMock?.name || leadResult.title || query;

  const snapshotKey = buildSnapshotKey(productId, leadCurrency);
  const observedHistory =
    exactOffers.length > 0
      ? await recordLivePriceSnapshot({
          productKey: snapshotKey,
          productName,
          lowestPrice,
          highestPrice,
          currency: leadCurrency,
          bestRetailer: bestOffer?.retailer || null,
          offerCount: exactOffers.length,
        })
      : [];

  const hasVariantUncertainty =
    broadQuery ||
    unverifiedOffers.length > 0 ||
    exactOffers.length === 0;

  return {
    baseCurrency: leadCurrency,
    historySource: "LIVE_OBSERVED",
    productIdentity: {
      confidence: broadQuery
        ? "broad-query"
        : exactOffers.length === 0
        ? "unverified"
        : unverifiedOffers.length > 0
        ? "partial"
        : "exact",
      isBroadQuery: broadQuery,
      detectedVolume: expectedVolume,
      excludedMismatchCount: excludedUnrelatedCount,
      warning: broadQuery
        ? `Broad search ("${query}"): listings are marked Variant unverified until you select a specific bottle size and formulation.`
        : exactOffers.length === 0 && unverifiedOffers.length > 0
        ? "No retailer explicitly confirmed every variant attribute; listings are separated under Variant unverified so incompatible SKUs are never compared as identical."
        : exactOffers.length === 0 && otherVariants.length > 0
        ? "No exact SKU match found; related sizes, packs, or formulations are listed separately under Other available variants."
        : unverifiedOffers.length > 0
        ? "Listings that omit explicit bottle size, SPF, or formulation are separated under Variant unverified."
        : null,
    },
    variantSummary,
    flagshipCoverage,
    product: {
      id: productId,
      name: productName,
      shortName: matchedMock?.shortName || query,
      brand:
        matchedMock?.brand ||
        extractBrandFromItem({
          title: productName,
          source: leadResult?.source || "",
          url: leadResult?.link || "",
        }) ||
        "Beauty Index",
      gtin: leadResult?.gtin || matchedMock?.gtin || null,
      sku: leadResult?.sku || leadResult?.product_id || matchedMock?.id || null,
      category: matchedMock?.category || "Beauty Search",
      volume: expectedVolume || matchedMock?.volume || null,
      variant:
        matchedMock?.variant ||
        [
          resolvedTarget.formulationLabel,
          resolvedTarget.spf?.toUpperCase(),
          resolvedTarget.concentration,
          resolvedTarget.volume,
        ]
          .filter(Boolean)
          .join(" · ") ||
        null,
      formulation: resolvedTarget.formulation || null,
      formulationLabel: resolvedTarget.formulationLabel || null,
      spf: resolvedTarget.spf || null,
      packCount: resolvedTarget.packCount || 1,
      rating:
        typeof leadResult.rating === "number"
          ? leadResult.rating
          : matchedMock?.rating ?? null,
      reviewCount:
        typeof leadResult.reviews === "number"
          ? leadResult.reviews
          : matchedMock?.reviewCount ?? null,
      description:
        matchedMock?.description ||
        leadResult.snippet ||
        `Live Google Shopping exact-variant comparison for "${query}" across ${exactOffers.length} verified exact listings.`,
      keyNotes: matchedMock?.keyNotes || [
        "Google Shopping Live",
        expectedVolume || "Variant unverified",
      ],
      image: leadResult.thumbnail || matchedMock?.image || mockCatalog[0].image,
      dataSource: "LIVE_OBSERVED",
      lastUpdated: fetchedAt,
    },
    offers: exactOffers,
    unverifiedOffers,
    otherVariants,
    priceHistory: observedHistory,
  };
}

async function resolveComparisonFromRegisteredProduct(
  registered,
  query,
  gl,
  apiKey
) {
  const tokens = Array.isArray(registered?.immersivePageTokens)
    ? registered.immersivePageTokens
    : [];
  const searchApiTokens = Array.isArray(registered?.searchApiProductTokens)
    ? registered.searchApiProductTokens
    : [];

  const canSearchApiFailover =
    !canCallProvider(PROVIDER_IDS.SERPAPI).allowed &&
    canCallProvider(PROVIDER_IDS.SEARCHAPI).allowed;

  if (!tokens.length && !searchApiTokens.length && !canSearchApiFailover) return null;

  let storeEntries = [];
  if (tokens.length > 0 && apiKey && canCallProvider(PROVIDER_IDS.SERPAPI).allowed) {
    storeEntries = await fetchImmersiveStoresByTokens({
      pageTokens: tokens,
      apiKey,
      limit: 4,
    });
  }

  // Fallback to SearchApi `google_product_offers` ONLY when SerpApi immersive
  // resolution failed or returned sparse verified offers for the selected SKU.
  const serpDirectOffers = storeEntries.filter((entry) => entry.direct_link || entry.link);
  const triedSearchApiTokens = new Set();

  if (
    serpDirectOffers.length < 2 &&
    searchApiTokens.length > 0 &&
    canCallProvider(PROVIDER_IDS.SEARCHAPI).allowed
  ) {
    const tokenBatch = searchApiTokens.slice(0, 4);
    for (const tok of tokenBatch) triedSearchApiTokens.add(tok);
    const settledSearchApi = await Promise.allSettled(
      tokenBatch.map((tok) =>
        fetchOffersByProductToken({
          productToken: tok,
          gl,
          hl: "en",
        })
      )
    );
    for (const res of settledSearchApi) {
      if (res.status === "fulfilled" && Array.isArray(res.value) && res.value.length > 0) {
        storeEntries = [...storeEntries, ...res.value];
      }
    }
  }

  if (
    storeEntries.length === 0 &&
    !canCallProvider(PROVIDER_IDS.SERPAPI).allowed &&
    canCallProvider(PROVIDER_IDS.SEARCHAPI).allowed
  ) {
    // Recover on SearchApi-only failover when SerpApi tokens exist without valid
    // SearchApi tokens (or stale/single-seller tokens yielded 0 offers).
    try {
      const lookupQuery = registered.rawTitle || registered.name || query;
      const saDiscovery = await SearchApiProvider.searchProducts(lookupQuery, {
        gl,
        hl: "en",
        num: 20,
      });
      const expectedVol =
        registered.volume || extractVariantSignature(lookupQuery).volume || null;
      const freshTokens = [];
      for (const item of saDiscovery?.rawItems || []) {
        const tok = item?.product_token;
        if (!tok && !item?.link) continue;
        const evalRes = evaluateVariantComparison({
          query: lookupQuery,
          candidateTitle: item.title || "",
          candidateUrl: item.link || "",
          candidateSource: cleanMerchantName(item.source || item.merchant) || "",
          candidateMetadata: getItemCandidateMeta(item),
          referenceTitle: registered.name || lookupQuery,
          expectedVolume: expectedVol,
        });
        if (evalRes.classification !== "unrelated") {
          if (tok && !triedSearchApiTokens.has(tok) && !freshTokens.includes(tok)) {
            freshTokens.push(tok);
          }
          if (item.link) {
            storeEntries.push(item);
          }
        }
      }
      if (freshTokens.length > 0) {
        if (registered.id) {
          registerDiscoveredProduct(registered.id, {
            ...registered,
            searchApiProductTokens: freshTokens,
          });
        }
        const settledRecovered = await Promise.allSettled(
          freshTokens.slice(0, 4).map((tok) =>
            fetchOffersByProductToken({
              productToken: tok,
              gl,
              hl: "en",
            })
          )
        );
        for (const res of settledRecovered) {
          if (res.status === "fulfilled" && Array.isArray(res.value) && res.value.length > 0) {
            storeEntries = [...storeEntries, ...res.value];
          }
        }
      }
    } catch {
      // Non-fatal; allow remaining fallback handling
    }
  }

  if (!storeEntries.length) return null;

  const fetchedAt = new Date().toISOString();
  const targetQuery = registered.rawTitle || registered.name || query;
  const regSig = extractVariantSignature(targetQuery);
  const baseTarget = {
    query: targetQuery,
    referenceTitle: registered.name || targetQuery,
    volume: registered.volume || registered.size || regSig.volume || null,
    spf:
      (registered.spfFull || registered.spf
        ? extractVariantSignature(registered.spfFull || registered.spf).spf
        : null) ||
      regSig.spf ||
      null,
    concentration: registered.concentration || regSig.concentration || null,
    packCount: registered.packCount || regSig.packCount || 1,
    isBundle: Boolean((registered.packCount && registered.packCount > 1) || regSig.isBundle),
    formulation: registered.formulation || regSig.formulation || null,
    formulationLabel: registered.formulationLabel || regSig.formulationLabel || null,
    formulationTags: regSig.formulationTags || [],
  };

  const partitioned = partitionVariantOffers({
    items: storeEntries,
    baseTarget,
    gl,
    fetchedAt,
  });

  if (!partitioned.hasAnyOffers) return null;

  const {
    resolvedTarget,
    exactOffers,
    unverifiedOffers,
    otherVariants,
    excludedUnrelatedCount,
    flagshipCoverage,
    variantSummary,
  } = partitioned;

  const expectedVolume = resolvedTarget.volume || null;
  const currencyPool =
    exactOffers.length > 0
      ? exactOffers
      : unverifiedOffers.length > 0
      ? unverifiedOffers
      : otherVariants;
  const leadCurrency = currencyPool[0]?.currency || (gl === "us" ? "USD" : "INR");

  const activePrices = exactOffers
    .filter((o) => o.inStock && typeof o.price === "number" && o.price > 0)
    .map((o) => o.price);
  const pricedPool =
    activePrices.length > 0
      ? activePrices
      : exactOffers.filter((o) => o.price > 0).map((o) => o.price);
  const lowestPrice = pricedPool.length > 0 ? Math.min(...pricedPool) : 0;
  const highestPrice = pricedPool.length > 0 ? Math.max(...pricedPool) : 0;
  const bestOffer = exactOffers.find((o) => o.price === lowestPrice);

  const productName = registered.name || targetQuery;
  const productId = registered.id;
  const snapshotKey = buildSnapshotKey(productId, leadCurrency);
  const observedHistory =
    exactOffers.length > 0
      ? await recordLivePriceSnapshot({
          productKey: snapshotKey,
          productName,
          lowestPrice,
          highestPrice,
          currency: leadCurrency,
          bestRetailer: bestOffer?.retailer || null,
          offerCount: exactOffers.length,
        })
      : [];

  const hasVariantUncertainty =
    unverifiedOffers.length > 0 || exactOffers.length === 0;

  return {
    baseCurrency: leadCurrency,
    historySource: "LIVE_OBSERVED",
    productIdentity: {
      confidence:
        exactOffers.length === 0
          ? "unverified"
          : unverifiedOffers.length > 0
          ? "partial"
          : "exact",
      isBroadQuery: false,
      detectedVolume: expectedVolume,
      excludedMismatchCount: excludedUnrelatedCount,
      warning:
        exactOffers.length === 0 && unverifiedOffers.length > 0
          ? "Retailers did not supply enough attributes to verify exact variant parity; listings are shown under Variant unverified."
          : exactOffers.length === 0 && otherVariants.length > 0
          ? "No exact SKU match found; related variants are shown separately under Other available variants."
          : hasVariantUncertainty
          ? "Listings missing explicit bottle size, SPF, or formulation are separated under Variant unverified."
          : null,
    },
    variantSummary,
    flagshipCoverage,
    product: {
      id: productId,
      name: productName,
      shortName: productName,
      brand:
        registered.brand ||
        extractBrandFromItem({ title: productName }) ||
        "Beauty Index",
      gtin: registered.gtin || storeEntries.find((s) => s.gtin)?.gtin || null,
      sku: registered.sku || registered.serpProductId || productId,
      category: registered.category || "Beauty Search",
      volume: expectedVolume || null,
      variant:
        registered.variant ||
        [
          resolvedTarget.formulationLabel,
          resolvedTarget.spf?.toUpperCase(),
          resolvedTarget.concentration,
          resolvedTarget.volume,
        ]
          .filter(Boolean)
          .join(" · ") ||
        null,
      formulation: resolvedTarget.formulation || null,
      formulationLabel: resolvedTarget.formulationLabel || null,
      spf: resolvedTarget.spf || null,
      packCount: resolvedTarget.packCount || 1,
      rating: registered.rating ?? null,
      reviewCount: registered.reviewCount ?? null,
      description:
        registered.description ||
        `Lazy exact-variant verification across ${exactOffers.length} confirmed SKU listings.`,
      keyNotes: [
        "Exact Variant Parity",
        expectedVolume || "Variant unverified",
      ],
      image: registered.image || mockCatalog[0].image,
      dataSource: "LIVE_OBSERVED",
      lastUpdated: fetchedAt,
    },
    offers: exactOffers,
    unverifiedOffers,
    otherVariants,
    priceHistory: observedHistory,
  };
}

function parseQueryFromProductId(productId = "") {
  if (!productId || typeof productId !== "string") return "";
  const parts = productId.split("__");
  if (parts.length !== 3) return "";
  const [brand, slug, spec] = parts;
  const volPart = (spec.split("_")[0] || "").replace("nosize", "").trim();
  return [brand, slug.replace(/-/g, " "), volPart].filter(Boolean).join(" ").trim();
}

export async function GET(request) {
  const hasSerpKey = Boolean(process.env.SERPAPI_KEY?.trim());

  try {
    const { searchParams } = new URL(request.url);
    const query = (searchParams.get("q") || "").trim();
    const productIdParam = (searchParams.get("productId") || "").trim();
    const forceRefresh = searchParams.get("refresh") === "true";
    const glParam = (searchParams.get("gl") || "in").toLowerCase();
    const gl = glParam === "us" ? "us" : "in";
    const currencyParam = searchParams.get("currency")?.toUpperCase();
    const displayCurrency =
      currencyParam === "USD" || currencyParam === "INR"
        ? currencyParam
        : gl === "us"
        ? "USD"
        : "INR";

    const registeredProduct = productIdParam
      ? getRegisteredProduct(productIdParam)
      : null;
    const effectiveQuery =
      query || registeredProduct?.name || parseQueryFromProductId(productIdParam);

    if (!effectiveQuery) {
      return NextResponse.json(
        {
          isLive: false,
          liveConfigured: hasSerpKey,
          mode: hasSerpKey ? "ready" : "curated",
          searchMode: "compare",
          error: "Missing search query parameter 'q'.",
          suggestions: mockCatalog.map((item) => ({
            id: item.id,
            name: item.name,
            shortName: item.shortName,
          })),
        },
        { status: 400 }
      );
    }

    const cacheKey = productIdParam
      ? `compare::id::${productIdParam}::${gl}`
      : `compare::q::${normalizeText(effectiveQuery)}::${gl}`;
    const sharedCompareKey = buildSearchCacheKey("compare_v2", {
      id: productIdParam || "",
      q: effectiveQuery,
      gl,
    });

    let cachedEntry = !forceRefresh
      ? getCachedComparison(cacheKey, CACHE_TTL_MS)
      : null;
    if (!cachedEntry && !forceRefresh) {
      const sharedHit = getSearchCacheEntry(sharedCompareKey, { allowStale: true });
      if (sharedHit?.data) {
        cachedEntry = {
          payload: sharedHit.data,
          mode: "live",
          cachedAt: sharedHit.cachedAt,
          expiresAt: sharedHit.expiresAt,
        };
      }
    }
    const cacheValid = Boolean(cachedEntry);

    const apiKey = process.env.SERPAPI_KEY?.trim();
    const serpAllowed = Boolean(apiKey) && canCallProvider(PROVIDER_IDS.SERPAPI).allowed;
    const searchApiAllowed = canCallProvider(PROVIDER_IDS.SEARCHAPI).allowed;
    const canResolveLazySearchApi =
      Boolean(registeredProduct?.searchApiProductTokens?.length) && searchApiAllowed;
    const canAttemptLiveCompare =
      serpAllowed || canResolveLazySearchApi || searchApiAllowed;

    let mode = "curated";
    let fallbackReason = canAttemptLiveCompare
      ? null
      : hasSerpKey
      ? "Primary live comparison provider temporarily unavailable"
      : "SERPAPI_KEY not configured";
    let errorType = null;
    let cacheStatus = forceRefresh ? "BYPASS" : cacheValid ? "HIT" : "MISS";
    let resolvedPayload = null;

    if (cacheValid) {
      resolvedPayload = cachedEntry.payload;
      mode = cachedEntry.mode;
    } else if (canAttemptLiveCompare) {
      try {
        const liveData = await coalescedComparisonFetch(cacheKey, async () => {
          let lazyData = null;
          if (registeredProduct) {
            lazyData = await resolveComparisonFromRegisteredProduct(
              registeredProduct,
              effectiveQuery,
              gl,
              apiKey
            );
            // Skip full SerpApi discovery when lazy resolution already verified exact offer(s).
            if (lazyData && (lazyData.offers || []).length >= 1) {
              return lazyData;
            }
          }
          if (serpAllowed) {
            const searchResult = await querySerpApi(
              registeredProduct?.name || effectiveQuery,
              gl,
              apiKey
            );
            if (searchResult && !searchResult.emptyReason) {
              return searchResult;
            }
            return lazyData || searchResult;
          }
          if (!registeredProduct && searchApiAllowed && effectiveQuery) {
            const syntheticEntry = {
              id: productIdParam || `compare__${normalizeText(effectiveQuery).replace(/\s+/g, "-")}`,
              name: effectiveQuery,
              rawTitle: effectiveQuery,
              brand: extractBrandFromItem({ title: effectiveQuery }) || "",
              volume: extractVariantSignature(effectiveQuery).volume || null,
              searchApiProductTokens: [],
              immersivePageTokens: [],
            };
            const failoverData = await resolveComparisonFromRegisteredProduct(
              syntheticEntry,
              effectiveQuery,
              gl,
              apiKey
            );
            if (
              failoverData &&
              !failoverData.emptyReason &&
              ((failoverData.offers || []).length > 0 ||
                (failoverData.unverifiedOffers || []).length > 0 ||
                (failoverData.otherVariants || []).length > 0)
            ) {
              return failoverData;
            }
          }
          return lazyData;
        });

        const hasLiveOffers =
          liveData &&
          !liveData.emptyReason &&
          ((liveData.offers || []).length > 0 ||
            (liveData.unverifiedOffers || []).length > 0 ||
            (liveData.otherVariants || []).length > 0);

        if (hasLiveOffers) {
          mode = "live";
          resolvedPayload = liveData;
          cachedEntry = setCachedComparison(cacheKey, liveData, {
            mode: "live",
            ttlMs: CACHE_TTL_MS,
          });
          setSearchCacheEntry(sharedCompareKey, liveData, {
            kind: "offers",
            providers: canResolveLazySearchApi && !serpAllowed ? ["searchapi"] : ["serpapi"],
            isFailure: false,
          });
        } else {
          mode = "fallback";
          errorType = liveData?.emptyReason || "NO_RESULTS";
          fallbackReason =
            errorType === "UNRELATED_FILTERED"
              ? "Live listings were filtered because their size, multi-pack, or title did not match the requested product."
              : "Google Shopping returned no priced store offers matching this query.";
        }
      } catch (err) {
        mode = "fallback";
        const classified = classifySerpError(err);
        errorType = classified.errorType;
        fallbackReason = redactSecrets(classified.reason);
      }
    }

    if (!resolvedPayload) {
      const matched = matchMockProduct(effectiveQuery, mockCatalog);
      if (!matched) {
        return NextResponse.json(
          {
            isLive: false,
            liveConfigured: hasSerpKey,
            mode,
            searchMode: "compare",
            errorType: errorType || "NO_MATCH",
            fallbackReason,
            error: `No verified product match found for "${effectiveQuery}". Select a curated formulation below or refine the product name and size.`,
            query: effectiveQuery,
            providers: getConfiguredProviders(gl),
            suggestions: mockCatalog.map((item) => ({
              id: item.id,
              name: item.name,
              shortName: item.shortName,
              brand: item.brand,
              category: item.category,
            })),
          },
          { status: 404 }
        );
      }

      const nowIso = new Date().toISOString();
      resolvedPayload = {
        baseCurrency: "INR",
        historySource: "CURATED_DEMO",
        productIdentity: {
          confidence: "exact",
          isBroadQuery: false,
          detectedVolume: matched.volume,
          excludedMismatchCount: 0,
          warning: null,
        },
        flagshipCoverage: TARGET_RETAILERS.map((retailer) => {
          const offer = matched.offers.find((o) => o.retailer === retailer);
          return {
            retailer,
            available: Boolean(offer),
            inStock: offer ? offer.inStock : false,
            price: offer ? offer.price : null,
            currency: offer ? offer.currency : null,
            storeUrl:
              offer?.storeUrl || buildRetailerSearchUrl(retailer, matched.name),
            linkType: offer?.linkType || "retailer_search",
            linkHostname:
              offer?.linkHostname || RETAILER_DEFAULTS[retailer]?.hostname || "",
          };
        }),
        product: {
          id: matched.id,
          name: matched.name,
          shortName: matched.shortName,
          brand: matched.brand,
          gtin: null,
          sku: matched.id,
          category: matched.category,
          volume: matched.volume,
          variant: matched.variant || null,
          rating: matched.rating,
          reviewCount: matched.reviewCount,
          description: matched.description,
          keyNotes: matched.keyNotes,
          image: matched.image,
          dataSource: "CURATED_DEMO",
          lastUpdated: nowIso,
        },
        offers: matched.offers.map((o) => ({
          ...o,
          variantClassification: "exact",
          variantMatchStatus: "exact",
          variantStatusLabel: "Exact Variant Match",
          lastUpdated: nowIso,
        })),
        unverifiedOffers: [],
        otherVariants: [],
        variantSummary: {
          exactCount: matched.offers.length,
          unverifiedCount: 0,
          otherVariantCount: 0,
          excludedUnrelatedCount: 0,
          targetVariant: {
            volume: matched.volume || null,
            spf: extractVariantSignature(matched.name).spf || null,
            concentration: extractVariantSignature(matched.name).concentration || null,
            packCount: 1,
            isBundle: false,
            formulation: extractVariantSignature(matched.name).formulation || null,
            formulationLabel:
              extractVariantSignature(matched.name).formulationLabel || null,
          },
        },
        priceHistory: matched.priceHistory,
      };
    }

    const { enrichedOffers, summary } = computeOfferAnalytics(
      resolvedPayload.offers || [],
      displayCurrency,
      resolvedPayload.product?.volume
    );
    const { enrichedOffers: enrichedUnverified } = computeOfferAnalytics(
      resolvedPayload.unverifiedOffers || [],
      displayCurrency,
      null
    );
    const { enrichedOffers: enrichedOtherVariants } = computeOfferAnalytics(
      resolvedPayload.otherVariants || [],
      displayCurrency,
      null
    );
    const sortedOffers = sortOffers(enrichedOffers, "price", false);
    const isLiveResponse =
      mode === "live" &&
      (hasSerpKey || Boolean(process.env.SEARCHAPI_API_KEY?.trim()));
    const resolvedDataSource =
      isLiveResponse && cacheStatus === "HIT"
        ? "CACHED_LIVE"
        : isLiveResponse
        ? "LIVE_OBSERVED"
        : "CURATED_DEMO";

    const priceIntelligence = computePriceIntelligence({
      offers: resolvedPayload.offers || [],
      priceHistory: resolvedPayload.priceHistory || [],
      productVolume: resolvedPayload.product?.volume,
      sourceCurrency: resolvedPayload.baseCurrency || "INR",
      displayCurrency,
    });

    return NextResponse.json(
      {
        isLive: isLiveResponse,
        liveConfigured: hasSerpKey,
        mode,
        searchMode: "compare",
        dataSource: resolvedDataSource,
        cacheStatus,
        cachedAt: cacheValid ? cachedEntry.cachedAt : null,
        expiresAt: cacheValid ? cachedEntry.expiresAt : null,
        ttlSeconds: Math.round(CACHE_TTL_MS / 1000),
        freshness: {
          fetchedAt: resolvedPayload.product?.lastUpdated || new Date().toISOString(),
          cachedAt: cacheValid ? cachedEntry.cachedAt : null,
          expiresAt: cacheValid ? cachedEntry.expiresAt : null,
          ttlSeconds: Math.round(CACHE_TTL_MS / 1000),
        },
        providers: getConfiguredProviders(gl),
        quotaDiagnostics: getQuotaDiagnostics(),
        errorType,
        fallbackReason,
        query: effectiveQuery,
        currency: displayCurrency,
        baseCurrency: resolvedPayload.baseCurrency || "INR",
        updatedAt: resolvedPayload.product?.lastUpdated || new Date().toISOString(),
        historySource:
          resolvedPayload.historySource ||
          (isLiveResponse ? "LIVE_OBSERVED" : "CURATED_DEMO"),
        productIdentity: resolvedPayload.productIdentity || null,
        variantSummary: resolvedPayload.variantSummary || null,
        flagshipCoverage: resolvedPayload.flagshipCoverage || [],
        product: resolvedPayload.product,
        offers: sortedOffers,
        unverifiedOffers: enrichedUnverified,
        otherVariants: enrichedOtherVariants,
        summary,
        priceIntelligence,
        priceHistory: resolvedPayload.priceHistory || [],
      },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        isLive: false,
        liveConfigured: hasSerpKey,
        mode: "error",
        searchMode: "compare",
        errorType: "INTERNAL_ERROR",
        error: "An unexpected error occurred while resolving price comparison.",
        details: redactSecrets(error?.message || "Internal server error"),
      },
      { status: 500 }
    );
  }
}
