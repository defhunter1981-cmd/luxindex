import {
  buildCanonicalGroupKey,
  cleanCanonicalTitle,
  extractStructuredAttributes,
  isDiscoveryNoiseItem,
  normalizeRetailerName,
} from "@/lib/catalogIdentity";
import { validateRetailerProductUrl } from "@/lib/urlValidator";
import { convertCurrency, formatPrice, normalizeText, parsePriceString } from "@/lib/utils";

const INTERNATIONAL_IMPORT_RETAILERS = [
  "desertcart",
  "ubuy",
  "ebay",
  "care to beauty",
  "lookfantastic",
  "stylevana",
  "yesstyle",
  "iherb",
  "strawberrynet",
];

const SHADE_PATTERNS = [
  /\b(?:shade|tint|tone)\s*[:-]?\s*([a-z0-9\s-]{2,24})/i,
  /\b((?:light|medium|dark|deep|fair|warm|cool|neutral|ivory|beige|sand|tan|honey|nude|rose|berry|coral|mauve|peach|caramel|espresso)\s+(?:tint|shade|tone))\b/i,
];

function extractConcentration(text = "") {
  const match = String(text || "").match(/(\d+(?:\.\d+)?)\s*%\s*(vitamin\s*c|niacinamide|salicylic|hyaluronic|glycolic|azelaic|kojic|retinol|lactic|zinc|bha|aha)?/i);
  if (!match) return null;
  const pct = `${match[1]}%`;
  return match[2] ? `${pct} ${match[2].replace(/\s+/g, " ").trim()}` : pct;
}

function extractPackCount(text = "") {
  const normalized = normalizeText(text);
  const packMatch = normalized.match(/\b(?:pack of|set of|combo of)\s*(\d+)\b|\b(\d+)\s*(?:pack|pcs|pieces)\b/);
  if (packMatch) {
    const num = Number(packMatch[1] || packMatch[2]);
    if (Number.isFinite(num) && num >= 2 && num <= 24) return num;
  }
  return 1;
}

function extractShadeOrTint(text = "") {
  const raw = String(text || "");
  if (/\buntinted\b|\bno\s*tint\b/i.test(raw)) return null;
  for (const pattern of SHADE_PATTERNS) {
    const match = raw.match(pattern);
    if (match && match[1]) {
      const candidate = match[1].trim();
      if (candidate.length >= 2 && !/^(spf|ml|gm|pack|for|with|and)$/i.test(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

export function isInternationalImportMerchant(merchantName = "") {
  const lower = normalizeText(merchantName);
  if (!lower) return false;
  return INTERNATIONAL_IMPORT_RETAILERS.some((blocked) => lower.includes(blocked));
}

export function validateImageUrl(rawImageUrl) {
  if (!rawImageUrl || typeof rawImageUrl !== "string") return null;
  const trimmed = rawImageUrl.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  if (trimmed.includes("data:image/") || trimmed.includes("blank.gif")) return null;
  return trimmed;
}

function normalizeExplicitCurrency(rawCurrency) {
  if (rawCurrency === undefined || rawCurrency === null) return null;
  const trimmed = String(rawCurrency).trim();
  if (!trimmed) return null;
  if (trimmed === "₹" || /^rs\.?$/i.test(trimmed)) return "INR";
  if (trimmed === "$" || /^us\$$/i.test(trimmed)) return "USD";
  const upper = trimmed.toUpperCase();
  if (!/^[A-Z]{3}$/.test(upper)) return "INVALID_CURRENCY";
  return upper;
}

function detectUnsupportedForeignCurrencyText(rawPrice) {
  if (typeof rawPrice !== "string") return false;
  if (/[€£¥₩₽]/.test(rawPrice)) return true;
  const codeMatch = rawPrice.match(/\b(EUR|GBP|JPY|AUD|CAD|SGD|AED|SAR|CHF|CNY|KRW|MYR|THB)\b/i);
  return Boolean(codeMatch);
}

function normalizePriceAndCurrency(item, gl = "in") {
  const targetCurrency = gl === "us" ? "USD" : "INR";
  const explicitCurrency = normalizeExplicitCurrency(item?.currency);
  if (explicitCurrency === "INVALID_CURRENCY") {
    return {
      price: null,
      currency: targetCurrency,
      formattedPrice: "—",
    };
  }

  if (
    !explicitCurrency &&
    detectUnsupportedForeignCurrencyText(item?.price)
  ) {
    return {
      price: null,
      currency: targetCurrency,
      formattedPrice: "—",
    };
  }

  const extractedNumeric =
    typeof item?.extracted_price === "number" && Number.isFinite(item.extracted_price)
      ? item.extracted_price
      : null;

  const fallbackForParse = explicitCurrency || targetCurrency;
  const parsedPrice = parsePriceString(item?.price, fallbackForParse);
  const parsedSymbolCurrency =
    typeof item?.price === "string" && (item.price.includes("$") || /\bUSD\b/i.test(item.price))
      ? "USD"
      : typeof item?.price === "string" && (item.price.includes("₹") || /\b(?:INR|RS\.?)\b/i.test(item.price))
      ? "INR"
      : null;

  // Reject contradictory currency declarations (e.g., currency: "INR" with "$19.99")
  if (explicitCurrency && parsedSymbolCurrency && explicitCurrency !== parsedSymbolCurrency) {
    return {
      price: null,
      currency: targetCurrency,
      formattedPrice: "—",
    };
  }

  const sourceCurrency = explicitCurrency || parsedPrice.currency || targetCurrency;
  const rawNumericAmount = extractedNumeric ?? parsedPrice.amount;

  if (typeof rawNumericAmount !== "number" || !Number.isFinite(rawNumericAmount) || rawNumericAmount <= 0) {
    return {
      price: null,
      currency: targetCurrency,
      formattedPrice: "—",
    };
  }

  // Only convert supported currencies cleanly; never silently treat EUR/GBP/etc. as INR.
  let numericAmount = rawNumericAmount;
  if (sourceCurrency !== targetCurrency) {
    const canConvert =
      (sourceCurrency === "USD" && targetCurrency === "INR") ||
      (sourceCurrency === "INR" && targetCurrency === "USD");
    if (!canConvert) {
      return {
        price: null,
        currency: targetCurrency,
        formattedPrice: "—",
      };
    }
    numericAmount = convertCurrency(rawNumericAmount, sourceCurrency, targetCurrency);
  }

  const rounded =
    targetCurrency === "USD"
      ? Math.round(numericAmount * 100) / 100
      : Math.round(numericAmount);

  return {
    price: rounded,
    currency: targetCurrency,
    formattedPrice: formatPrice(rounded, targetCurrency),
    originalPrice: rawNumericAmount,
    originalCurrency: sourceCurrency,
  };
}

function parseAvailability(item) {
  const deliveryText =
    typeof item?.delivery === "string"
      ? item.delivery
      : item?.delivery_return?.delivery || item?.shipping || null;
  const extJoined = Array.isArray(item?.extensions) ? item.extensions.join(" ") : "";
  const combined = `${deliveryText || ""} ${extJoined}`.toLowerCase();

  if (/\bout of stock\b|\bsold out\b|\bunavailable\b|\bcurrently unavailable\b/.test(combined)) {
    return "Out of stock";
  }
  if (item?.in_stock === false) {
    return "Out of stock";
  }
  if (/\bin stock\b|\bfree delivery\b|\bdelivery\b|\barrives\b|\bships\b/.test(combined)) {
    return "In stock";
  }
  return item?.price ? "Available online" : "Check store";
}

function extractVariantDescriptor(attrs, title, concentration, shade, packCount) {
  const parts = [];
  if (attrs?.spf) parts.push(attrs.spf);
  if (concentration) parts.push(concentration);
  if (attrs?.finishes?.length) parts.push(attrs.finishes[0]);
  if (shade) parts.push(shade);
  if (packCount > 1) parts.push(`Pack of ${packCount}`);

  if (parts.length > 0) {
    return parts.join(" · ");
  }

  const cleaned = cleanCanonicalTitle(title, attrs?.brand || "");
  return attrs?.sizeLabel ? cleaned.replace(attrs.sizeLabel, "").trim() : null;
}

/**
 * Normalizes a raw shopping result item from SerpApi, Serper, or SearchApi
 * into LuxeIndex V2's unified product record contract.
 */
export function normalizeProductItem(rawItem, context = {}) {
  if (!rawItem || typeof rawItem !== "object") return null;

  const {
    provider = "serpapi",
    queryHint = "",
    gl = "in",
    position = 0,
    checkedAt = new Date().toISOString(),
  } = context;

  const title = String(rawItem.title || "").trim();
  if (!title || title.length < 4) return null;

  if (isDiscoveryNoiseItem(rawItem, queryHint)) {
    return null;
  }

  // Separate direct merchant product URLs from Google Shopping view URLs cleanly.
  const rawMerchantCandidate =
    rawItem.direct_link ||
    rawItem.merchant_link ||
    rawItem.link ||
    null;

  let rawMerchantSource = "";
  for (const cand of [rawItem.source, rawItem.shop, rawItem.seller, rawItem.merchant, rawItem.store]) {
    if (!cand) continue;
    if (typeof cand === "string" && cand.trim() && cand.trim().toLowerCase() !== "[object object]") {
      rawMerchantSource = cand.trim();
      break;
    }
    if (typeof cand === "object" && !Array.isArray(cand)) {
      const inner = cand.name || cand.display_name || cand.title || cand.domain || "";
      if (typeof inner === "string" && inner.trim()) {
        rawMerchantSource = inner.trim();
        break;
      }
    }
  }

  const merchant = normalizeRetailerName(
    rawMerchantSource,
    typeof rawMerchantCandidate === "string" ? rawMerchantCandidate : ""
  );

  const merchantUrlValidation = validateRetailerProductUrl(rawMerchantCandidate, merchant, {
    allowSearchUrl: false,
  });

  const merchantProductUrl = merchantUrlValidation.valid
    ? merchantUrlValidation.url
    : null;

  // Preserve Google Shopping URL strictly as `shoppingUrl` (never masquerading as merchant PDP).
  const candidateShoppingUrl =
    rawItem.product_link ||
    (rawItem.link && !merchantUrlValidation.valid ? rawItem.link : null) ||
    rawItem.offers_link ||
    null;
  const shoppingUrl =
    candidateShoppingUrl && /^https?:\/\//i.test(String(candidateShoppingUrl).trim())
      ? String(candidateShoppingUrl).trim()
      : null;

  const priceInfo = normalizePriceAndCurrency(rawItem, gl);
  if (!priceInfo.price || priceInfo.price <= 0) return null;

  const attrs = extractStructuredAttributes({
    title,
    snippet: rawItem.snippet || "",
    extensions: rawItem.extensions || [],
    url: merchantProductUrl || shoppingUrl || "",
    source: merchant,
    queryHint,
  });

  const concentration = attrs.concentration || extractConcentration(title);
  const packCount = Math.max(attrs.packCount || 1, extractPackCount(title));
  const canonicalTitle = cleanCanonicalTitle(title, attrs.brand);
  const canonicalProductId = buildCanonicalGroupKey({
    title,
    brand: attrs.brand,
    sizeLabel: attrs.sizeLabel,
    spfTier: attrs.spfTier,
    concentration,
    formulation: attrs.formulation,
    packCount,
  });
  const providerProductToken =
    rawItem.immersive_product_page_token ||
    rawItem.product_token ||
    null;

  const shade = extractShadeOrTint(title);
  const productType = attrs.productTypes?.[0] || attrs.category || "Beauty";
  const variant = extractVariantDescriptor(
    attrs,
    title,
    concentration,
    shade,
    packCount
  );

  const sizeInfo = attrs.sizeLabel
    ? {
        sizeLabel: attrs.sizeLabel,
        sizeValue: attrs.sizeValue,
        sizeUnit: attrs.sizeUnit,
        normalizedBaseMlOrG: attrs.normalizedBaseMlOrG,
        normalizedBaseUnit: attrs.normalizedBaseUnit,
      }
    : null;

  const rawDelivery =
    typeof rawItem.delivery === "string"
      ? rawItem.delivery
      : rawItem.delivery_return?.delivery || rawItem.delivery_return?.return || null;

  const rating =
    typeof rawItem.rating === "number" && Number.isFinite(rawItem.rating)
      ? rawItem.rating
      : null;
  const reviewCount =
    typeof rawItem.reviews === "number"
      ? rawItem.reviews
      : typeof rawItem.reviews_cnt === "number"
      ? rawItem.reviews_cnt
      : typeof rawItem.ratingCount === "number"
      ? rawItem.ratingCount
      : null;

  const imageUrl = validateImageUrl(
    rawItem.imageUrl || rawItem.thumbnail || rawItem.serpapi_thumbnail
  );

  const isIntlImport = isInternationalImportMerchant(merchant);
  const confidenceScore =
    (attrs.brand && attrs.brand !== "Independent Beauty" ? 0.35 : 0.1) +
    (attrs.sizeLabel ? 0.25 : 0) +
    (productType && productType !== "Beauty" ? 0.2 : 0) +
    (merchantProductUrl ? 0.2 : 0.05);

  const matchConfidence =
    confidenceScore >= 0.75 ? "high" : confidenceScore >= 0.45 ? "medium" : "low";

  const providerItemId =
    rawItem.product_id ||
    rawItem.productId ||
    `${provider}_${position}_${normalizeText(title).slice(0, 24).replace(/\s+/g, "-")}`;

  return {
    id: canonicalProductId,
    providerItemId: String(providerItemId),
    canonicalProductId,
    title: canonicalTitle || title,
    rawTitle: title,
    brand: attrs.brand,
    category: attrs.category,
    productType,
    variant: variant || null,
    size: attrs.sizeLabel || null,
    sizeInfo,
    spf: attrs.spf || null,
    spfTier: attrs.spfTier || null,
    formulation: attrs.formulation || null,
    formulationLabel: attrs.formulationLabel || null,
    formulationTags: attrs.formulationTags || [],
    concentration,
    shade,
    packCount,
    price: priceInfo.price,
    currency: priceInfo.currency,
    formattedPrice: priceInfo.formattedPrice,
    originalPrice: priceInfo.originalPrice ?? priceInfo.price,
    originalCurrency: priceInfo.originalCurrency ?? priceInfo.currency,
    merchant: merchant || "Online Store",
    imageUrl,
    shoppingUrl,
    merchantProductUrl,
    provider,
    providerProductToken,
    tokenKind: rawItem.immersive_product_page_token
      ? "serpapi_immersive"
      : rawItem.product_token
      ? "searchapi_product_token"
      : null,
    availability: parseAvailability(rawItem),
    delivery: rawDelivery,
    rating,
    reviewCount,
    matchConfidence,
    lastCheckedAt: checkedAt,
    isInternationalImport: isIntlImport,
    ingredients: attrs.ingredients || [],
    skinTypes: attrs.skinTypes || [],
    finishes: attrs.finishes || [],
    productTypes: attrs.productTypes || [],
    extensions: Array.isArray(rawItem.extensions) ? rawItem.extensions : [],
    position: Number(rawItem.position || rawItem.global_rank || position || 0),
  };
}

export function normalizeProviderResults(rawItems = [], context = {}) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) return [];
  const checkedAt = context.checkedAt || new Date().toISOString();
  const normalized = [];
  for (let i = 0; i < rawItems.length; i += 1) {
    const item = normalizeProductItem(rawItems[i], {
      ...context,
      position: rawItems[i]?.position || i + 1,
      checkedAt,
    });
    if (item) normalized.push(item);
  }
  return normalized;
}
