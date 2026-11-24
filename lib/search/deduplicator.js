import { computePricePer100Unit } from "@/lib/catalogIdentity";
import { registerDiscoveredProduct } from "@/lib/discoveryCache";
import { normalizeText } from "@/lib/utils";
import { scoreProductMatch } from "./productMatcher";

const KNOWN_INDIAN_RETAILER_NAMES = new Set([
  "Nykaa",
  "Tira",
  "Amazon",
  "Flipkart",
  "Sephora",
  "Myntra",
  "Purplle",
  "Minimalist",
  "Dot & Key",
  "HealthKart",
  "1mg",
  "Pharmeasy",
  "Apollo Pharmacy",
  "Netmeds",
  "BigBasket",
  "Blinkit",
  "Zepto",
  "Swiggy Instamart",
  "Smytten",
  "Maccaron",
  "Kindlife",
  "FOXY",
  "AJIO",
  "JioMart",
  "Reliance Retail",
  "Cult Beauty",
  "Space NK",
]);

/**
 * Step 1: Remove intra-provider duplicates (e.g., SearchApi returning multiple
 * overlapping listings for the same SKU & merchant on one page).
 */
export function deduplicateWithinProvider(normalizedItems = []) {
  const seen = new Map();

  for (const item of normalizedItems) {
    if (!item) continue;
    const merchantKey = normalizeText(item.merchant || "");
    const priceKey = typeof item.price === "number" ? Math.round(item.price) : "0";
    const key = `${item.provider}|${item.canonicalProductId}|${merchantKey}|${priceKey}`;

    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, item);
      continue;
    }

    // Keep the richer listing when collapsing duplicates within one provider.
    const existingScore =
      (existing.merchantProductUrl ? 4 : 0) +
      (existing.providerProductToken ? 3 : 0) +
      (existing.imageUrl ? 2 : 0) +
      (existing.delivery ? 1 : 0);
    const candidateScore =
      (item.merchantProductUrl ? 4 : 0) +
      (item.providerProductToken ? 3 : 0) +
      (item.imageUrl ? 2 : 0) +
      (item.delivery ? 1 : 0);

    if (candidateScore > existingScore) {
      seen.set(key, item);
    }
  }

  return Array.from(seen.values());
}

function buildOfferSnapshot(item) {
  return {
    retailer: item.merchant,
    merchant: item.merchant,
    price: item.price,
    currency: item.currency,
    formattedPrice: item.formattedPrice,
    url: item.merchantProductUrl || null,
    merchantProductUrl: item.merchantProductUrl || null,
    shoppingUrl: item.shoppingUrl || null,
    linkType: item.merchantProductUrl ? "direct" : item.shoppingUrl ? "shopping_fallback" : "unavailable",
    inStock: item.availability !== "Out of stock",
    availability: item.availability,
    delivery: item.delivery || null,
    provider: item.provider,
    isInternationalImport: Boolean(item.isInternationalImport),
  };
}

function createProductGroup(seedItem, displayCurrency = "INR") {
  const offer = buildOfferSnapshot(seedItem);
  const unitPrice = computePricePer100Unit(
    seedItem.price,
    seedItem.sizeInfo,
    displayCurrency
  );

  return {
    id: seedItem.id,
    canonicalKey: seedItem.canonicalProductId,
    canonicalProductId: seedItem.canonicalProductId,
    name: seedItem.title,
    title: seedItem.title,
    rawTitle: seedItem.rawTitle,
    brand: seedItem.brand,
    category: seedItem.category,
    productType: seedItem.productType,
    variant: seedItem.variant,
    size: seedItem.size,
    sizeInfo: seedItem.sizeInfo,
    normalizedBaseMlOrG: seedItem.sizeInfo?.normalizedBaseMlOrG || null,
    normalizedBaseUnit: seedItem.sizeInfo?.normalizedBaseUnit || null,
    spf: seedItem.spf,
    spfFull: seedItem.spf,
    concentration: seedItem.concentration || null,
    shade: seedItem.shade || null,
    packCount: seedItem.packCount || 1,
    formulation: seedItem.formulation || null,
    formulationLabel: seedItem.formulationLabel || null,
    formulationTags: Array.isArray(seedItem.formulationTags) ? [...seedItem.formulationTags] : [],
    image: seedItem.imageUrl,
    imageUrl: seedItem.imageUrl,
    lowestPrice: seedItem.price,
    highestPrice: seedItem.price,
    averagePrice: seedItem.price,
    price: seedItem.price,
    priceDifference: 0,
    currency: seedItem.currency || displayCurrency,
    pricePer100Unit: unitPrice.value,
    unitLabel: unitPrice.label,
    bestRetailer: seedItem.merchant,
    merchant: seedItem.merchant,
    retailers: [seedItem.merchant],
    inStock: offer.inStock,
    availability: seedItem.availability,
    delivery: seedItem.delivery || null,
    rating: seedItem.rating,
    reviewCount: seedItem.reviewCount,
    shoppingUrl: seedItem.shoppingUrl,
    merchantProductUrl: seedItem.merchantProductUrl,
    provider: seedItem.provider,
    providers: [seedItem.provider],
    matchConfidence: seedItem.matchConfidence || "medium",
    lastCheckedAt: seedItem.lastCheckedAt,
    lastUpdated: seedItem.lastCheckedAt,
    isInternationalImport: Boolean(seedItem.isInternationalImport),
    hasDomesticIndianOffer: !seedItem.isInternationalImport,
    isIndianRetailerPreferred:
      !seedItem.isInternationalImport && KNOWN_INDIAN_RETAILER_NAMES.has(seedItem.merchant),
    dataSource: "live",
    ingredients: [...(seedItem.ingredients || [])],
    skinTypes: [...(seedItem.skinTypes || [])],
    finishes: [...(seedItem.finishes || [])],
    productTypes: [...(seedItem.productTypes || [])],
    offersPreview: [offer],
    _seedItem: seedItem,
    _immersiveTokens:
      seedItem.tokenKind === "serpapi_immersive" && seedItem.providerProductToken
        ? [seedItem.providerProductToken]
        : [],
    _searchApiProductTokens:
      seedItem.tokenKind === "searchapi_product_token" && seedItem.providerProductToken
        ? [seedItem.providerProductToken]
        : [],
    _directUrlsCount: seedItem.merchantProductUrl ? 1 : 0,
    _serpProductId:
      seedItem.provider === "serpapi" ? seedItem.providerItemId : null,
  };
}

function mergeItemIntoGroup(group, item, displayCurrency = "INR") {
  if (!group.providers.includes(item.provider)) {
    group.providers.push(item.provider);
  }

  if (
    item.tokenKind === "serpapi_immersive" &&
    item.providerProductToken &&
    !group._immersiveTokens.includes(item.providerProductToken)
  ) {
    group._immersiveTokens.push(item.providerProductToken);
  }
  if (
    item.tokenKind === "searchapi_product_token" &&
    item.providerProductToken &&
    !group._searchApiProductTokens.includes(item.providerProductToken)
  ) {
    group._searchApiProductTokens.push(item.providerProductToken);
  }
  if (!group._serpProductId && item.provider === "serpapi" && item.providerItemId) {
    group._serpProductId = item.providerItemId;
  }

  const offer = buildOfferSnapshot(item);
  const existingIdx = group.offersPreview.findIndex(
    (o) => normalizeText(o.retailer) === normalizeText(offer.retailer)
  );
  if (existingIdx === -1) {
    group.offersPreview.push(offer);
    if (!group.retailers.includes(offer.retailer)) {
      group.retailers.push(offer.retailer);
    }
  } else {
    const existingOffer = group.offersPreview[existingIdx];
    const shouldReplace =
      (!existingOffer.merchantProductUrl && Boolean(offer.merchantProductUrl)) ||
      (Boolean(existingOffer.merchantProductUrl) === Boolean(offer.merchantProductUrl) &&
        offer.price < existingOffer.price);
    if (shouldReplace) {
      group.offersPreview[existingIdx] = offer;
    }
  }

  if (item.merchantProductUrl) {
    group._directUrlsCount += 1;
    if (!group.merchantProductUrl) {
      group.merchantProductUrl = item.merchantProductUrl;
    }
  }
  if (!group.shoppingUrl && item.shoppingUrl) {
    group.shoppingUrl = item.shoppingUrl;
  }
  if (!group.image && item.imageUrl) {
    group.image = item.imageUrl;
    group.imageUrl = item.imageUrl;
  }
  if (group.rating == null && typeof item.rating === "number") {
    group.rating = item.rating;
  }
  if (group.reviewCount == null && typeof item.reviewCount === "number") {
    group.reviewCount = item.reviewCount;
  }
  if (!group.delivery && item.delivery) {
    group.delivery = item.delivery;
  }
  if (!item.isInternationalImport) {
    group.hasDomesticIndianOffer = true;
    group.isInternationalImport = false;
  }

  for (const ing of item.ingredients || []) {
    if (!group.ingredients.includes(ing)) group.ingredients.push(ing);
  }
  for (const st of item.skinTypes || []) {
    if (!group.skinTypes.includes(st)) group.skinTypes.push(st);
  }
  for (const fin of item.finishes || []) {
    if (!group.finishes.includes(fin)) group.finishes.push(fin);
  }
  for (const pt of item.productTypes || []) {
    if (!group.productTypes.includes(pt)) group.productTypes.push(pt);
  }

  // Prefer domestic Indian offers when computing primary lowest/best offer
  // so international gray-market resellers do not distort Indian comparison baselines.
  const domesticOffers = group.offersPreview.filter((o) => !o.isInternationalImport);
  const pricingPool = domesticOffers.length > 0 ? domesticOffers : group.offersPreview;
  const prices = pricingPool.map((o) => o.price).filter((p) => typeof p === "number" && p > 0);

  if (prices.length > 0) {
    group.lowestPrice = Math.min(...prices);
    group.highestPrice = Math.max(...prices);
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    group.averagePrice =
      displayCurrency === "USD" ? Math.round(avg * 100) / 100 : Math.round(avg);
    group.priceDifference =
      displayCurrency === "USD"
        ? Math.round((group.highestPrice - group.lowestPrice) * 100) / 100
        : Math.round(group.highestPrice - group.lowestPrice);
    group.price = group.lowestPrice;

    const bestOffer = pricingPool.reduce((min, o) => (o.price < min.price ? o : min));
    group.bestRetailer = bestOffer.retailer;
    group.merchant = bestOffer.retailer;
    if (bestOffer.merchantProductUrl) {
      group.merchantProductUrl = bestOffer.merchantProductUrl;
    }
  }

  group.inStock = group.offersPreview.some((o) => o.inStock);
  group.matchConfidence = "high";

  const unitPrice = computePricePer100Unit(
    group.lowestPrice,
    {
      normalizedBaseMlOrG: group.normalizedBaseMlOrG,
      normalizedBaseUnit: group.normalizedBaseUnit,
    },
    displayCurrency
  );
  group.pricePer100Unit = unitPrice.value;
  group.unitLabel = unitPrice.label;
}

/**
 * Deduplicates intra-provider noise, merges only high-confidence multi-provider matches,
 * keeps distinct variants/sizes separated, registers lazy tokens strictly server-side,
 * and returns clean public product cards for `/api/discover`.
 */
export function deduplicateAndAggregateProducts(
  normalizedItems = [],
  { displayCurrency = "INR", registerInServerCache = true } = {}
) {
  const cleanItems = deduplicateWithinProvider(normalizedItems);
  const groups = [];
  const exactBucketMap = new Map();

  for (const item of cleanItems) {
    const exactBucketKey = item.canonicalProductId;
    const candidateIndices = exactBucketMap.get(exactBucketKey) || [];

    let matchedGroup = null;
    for (const idx of candidateIndices) {
      const candidate = groups[idx];
      const match = scoreProductMatch(candidate._seedItem, item);
      if (match.canMerge) {
        matchedGroup = candidate;
        break;
      }
    }

    // Also inspect brand-bucket neighbors with identical size + brand for slight phrasing differences
    if (!matchedGroup && item.brand && item.brand !== "Independent Beauty") {
      for (const candidate of groups) {
        if (candidate.brand !== item.brand) continue;
        const match = scoreProductMatch(candidate._seedItem, item);
        if (match.canMerge) {
          matchedGroup = candidate;
          break;
        }
      }
    }

    if (matchedGroup) {
      mergeItemIntoGroup(matchedGroup, item, displayCurrency);
    } else {
      const groupIndex = groups.length;
      const newGroup = createProductGroup(item, displayCurrency);
      groups.push(newGroup);
      if (!exactBucketMap.has(exactBucketKey)) {
        exactBucketMap.set(exactBucketKey, []);
      }
      exactBucketMap.get(exactBucketKey).push(groupIndex);
    }
  }

  // Sort domestic Indian offers above international-only import listings,
  // preserving multi-provider & multi-offer prominence.
  groups.sort((a, b) => {
    if (a.hasDomesticIndianOffer !== b.hasDomesticIndianOffer) {
      return a.hasDomesticIndianOffer ? -1 : 1;
    }
    const scoreA =
      (a.providers.length > 1 ? 20 : 0) +
      a.offersPreview.length * 4 +
      (a.imageUrl ? 2 : 0) +
      (a.rating || 0);
    const scoreB =
      (b.providers.length > 1 ? 20 : 0) +
      b.offersPreview.length * 4 +
      (b.imageUrl ? 2 : 0) +
      (b.rating || 0);
    return scoreB - scoreA;
  });

  const publicProducts = [];
  for (const group of groups) {
    // Disambiguate colliding public IDs safely when variants kept separate shared base canonical keys
    const duplicateIdCount = publicProducts.filter((p) => p.id === group.id).length;
    const finalId =
      duplicateIdCount > 0 ? `${group.id}--v${duplicateIdCount + 1}` : group.id;

    if (registerInServerCache) {
      registerDiscoveredProduct(finalId, {
        id: finalId,
        canonicalKey: group.canonicalKey,
        name: group.name,
        rawTitle: group.rawTitle,
        brand: group.brand,
        category: group.category,
        volume: group.size,
        variant: group.variant,
        spf: group.spfFull,
        image: group.imageUrl,
        rating: group.rating,
        reviewCount: group.reviewCount,
        immersivePageTokens: group._immersiveTokens,
        searchApiProductTokens: group._searchApiProductTokens,
        serpProductId: group._serpProductId,
        offersPreview: group.offersPreview,
        providers: group.providers,
        dataSource: "live",
      });
    }

    const {
      _seedItem,
      _immersiveTokens,
      _searchApiProductTokens,
      _directUrlsCount,
      _serpProductId,
      ...publicFields
    } = group;

    publicProducts.push({
      ...publicFields,
      id: finalId,
      offerCount: publicFields.offersPreview.length,
      hasDetailToken:
        _immersiveTokens.length > 0 || _searchApiProductTokens.length > 0,
      hasDirectUrlPreview: _directUrlsCount > 0,
    });
  }

  return publicProducts;
}

