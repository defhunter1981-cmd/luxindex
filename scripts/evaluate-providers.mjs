/**
 * Isolated evaluation runner comparing Serper, SearchApi, HasData, and existing SerpApi
 * on beauty product search queries for LuxeIndex.
 *
 * Strictly read-only evaluation: NEVER modifies production routes/UI and NEVER logs API keys.
 */

import fs from "node:fs";
import path from "node:path";
import { validateRetailerProductUrl } from "../lib/urlValidator.js";
import { parsePriceString, normalizeText } from "../lib/utils.js";

const QUERIES = [
  "sunscreen India",
  "Minimalist SPF 50 sunscreen",
  "vitamin C serum India",
  "Neutrogena sunscreen",
];

const RECOGNIZED_BRANDS = [
  "minimalist",
  "neutrogena",
  "la roche-posay",
  "la roche posay",
  "beauty of joseon",
  "the derma co",
  "dot & key",
  "dot and key",
  "dr. sheth",
  "dr sheth",
  "re'equil",
  "reequil",
  "plum",
  "deconstruct",
  "foxtale",
  "aqualogica",
  "hyphen",
  "fixderma",
  "wishcare",
  "cetaphil",
  "cerave",
  "garnier",
  "l'oreal",
  "loreal",
  "the ordinary",
  "klairs",
  "lakme",
  "olay",
  "mamaearth",
  "lotus",
  "biotique",
  "nivea",
  "bioderma",
  "eucerin",
  "isdin",
  "uv doux",
  "conscious chemist",
  "pilgrim",
  "skin1004",
  "cosrx",
  "drunk elephant",
  "clinique",
  "kiehl's",
];

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  const env = { ...process.env };
  if (!fs.existsSync(envPath)) return env;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!env[key]) {
      env[key] = val;
    }
  }
  return env;
}

function redactSensitiveText(value, secrets = []) {
  if (typeof value !== "string") return value;
  let out = value.replace(/([?&]api_key=)[^&]+/gi, "$1[REDACTED]");
  for (const s of secrets) {
    if (s && s.length >= 6 && out.includes(s)) {
      out = out.split(s).join("[REDACTED]");
    }
  }
  return out;
}

function extractQuotaHeaders(headers) {
  const interesting = {};
  for (const [k, v] of headers.entries()) {
    const lower = k.toLowerCase();
    if (
      lower.includes("rate") ||
      lower.includes("limit") ||
      lower.includes("remain") ||
      lower.includes("quota") ||
      lower.includes("credit") ||
      lower.includes("retry")
    ) {
      interesting[k] = v;
    }
  }
  return interesting;
}

function detectBrand(title = "") {
  const lower = String(title).toLowerCase();
  for (const brand of RECOGNIZED_BRANDS) {
    if (lower.includes(brand)) return brand;
  }
  return null;
}

function evaluateRelevance(query, title = "") {
  const qNorm = normalizeText(query);
  const tNorm = normalizeText(title);
  if (!tNorm) return false;

  const stop = new Set(["india", "for", "with", "and", "the", "best", "spf"]);
  const qTokens = qNorm
    .split(" ")
    .filter((t) => t.length >= 3 && !stop.has(t));

  // If brand-specific query, require brand presence or strong core formulation overlap
  if (qNorm.includes("minimalist")) {
    return tNorm.includes("minimalist") && tNorm.includes("sunscreen");
  }
  if (qNorm.includes("neutrogena")) {
    return tNorm.includes("neutrogena") && (tNorm.includes("sun") || tNorm.includes("spf"));
  }
  if (qNorm.includes("vitamin c")) {
    return (
      (tNorm.includes("vitamin c") || tNorm.includes("vit c") || tNorm.includes("ascorbic")) &&
      (tNorm.includes("serum") || tNorm.includes("concentrate") || tNorm.includes("drops"))
    );
  }
  if (qNorm.includes("sunscreen")) {
    return tNorm.includes("sunscreen") || tNorm.includes("sunblock") || tNorm.includes("spf");
  }

  return qTokens.some((tok) => tNorm.includes(tok));
}

function normalizeGenericShoppingItem(item, providerName) {
  // Handle heterogeneous schemas cleanly without fabricating fields
  const title = item.title || item.name || item.product_title || "";
  const rawPrice =
    item.extracted_price ??
    item.price ??
    item.price_str ??
    item.extractedPrice ??
    null;
  const parsedPrice =
    typeof rawPrice === "number"
      ? { amount: rawPrice, currency: item.currency || (String(item.price || "").includes("$") ? "USD" : "INR") }
      : parsePriceString(item.price || rawPrice, "INR");

  const merchant =
    item.source ||
    item.seller ||
    item.merchant ||
    item.store ||
    item.domain ||
    null;

  const candidateDirectUrl =
    item.direct_link ||
    item.link ||
    item.productUrl ||
    item.merchant_link ||
    item.offer_link ||
    null;

  const googleShoppingPageUrl =
    item.product_link || item.productLink || item.offers_link || null;

  const image =
    item.thumbnail ||
    item.imageUrl ||
    item.image ||
    item.thumbnail_url ||
    null;

  const availabilityText =
    item.availability ||
    item.stock ||
    item.in_stock ||
    item.delivery ||
    item.shipping ||
    null;

  return {
    provider: providerName,
    rawKeys: Object.keys(item),
    title,
    brand: item.brand || detectBrand(title),
    rawPrice: item.price ?? rawPrice ?? null,
    parsedAmountInr:
      parsedPrice.currency === "INR" && typeof parsedPrice.amount === "number"
        ? parsedPrice.amount
        : null,
    currencyDetected: parsedPrice.currency || item.currency || null,
    merchant,
    candidateDirectUrl,
    googleShoppingPageUrl,
    image,
    rating: item.rating ?? null,
    reviews: item.reviews ?? item.ratingCount ?? item.reviews_count ?? null,
    availabilityOrDelivery: availabilityText,
    hasImmersiveToken: Boolean(
      item.immersive_product_page_token ||
        item.serpapi_immersive_product_api ||
        item.page_token ||
        item.pageToken
    ),
    productId: item.product_id || item.productId || item.position || null,
  };
}

function summarizeItems(providerName, query, rawItems, extras = {}) {
  const normalized = rawItems.map((it) => normalizeGenericShoppingItem(it, providerName));
  const seenExactTitle = new Set();
  const seenMerchantTitle = new Set();
  let duplicateTitles = 0;
  let duplicateMerchantTitle = 0;
  let relevantCount = 0;
  let withBrandCount = 0;
  let withInrPriceCount = 0;
  let withMerchantCount = 0;
  let withImageCount = 0;
  let googleThumbProxyCount = 0;
  let nonProxyHttpsImgCount = 0;
  let directMerchantUrlValidCount = 0;
  let googleRedirectUrlCount = 0;
  let homepageOrSearchUrlCount = 0;
  let missingDirectUrlCount = 0;
  let withAvailabilityOrDelivery = 0;

  for (const row of normalized) {
    const tKey = normalizeText(row.title);
    if (tKey) {
      if (seenExactTitle.has(tKey)) duplicateTitles++;
      seenExactTitle.add(tKey);
    }
    const mtKey = normalizeText(`${row.merchant || ""} ${row.title}`);
    if (mtKey) {
      if (seenMerchantTitle.has(mtKey)) duplicateMerchantTitle++;
      seenMerchantTitle.add(mtKey);
    }

    if (evaluateRelevance(query, row.title)) relevantCount++;
    if (row.brand) withBrandCount++;
    if (typeof row.parsedAmountInr === "number" && row.parsedAmountInr > 0) {
      withInrPriceCount++;
    }
    if (row.merchant && String(row.merchant).trim().length > 0) {
      withMerchantCount++;
    }
    if (row.image && /^https?:\/\//i.test(row.image)) {
      withImageCount++;
      if (/encrypted-tbn\d*\.gstatic\.com/i.test(row.image)) {
        googleThumbProxyCount++;
      } else {
        nonProxyHttpsImgCount++;
      }
    }
    if (row.availabilityOrDelivery != null && String(row.availabilityOrDelivery).trim() !== "") {
      withAvailabilityOrDelivery++;
    }

    const url = row.candidateDirectUrl;
    if (!url || typeof url !== "string") {
      missingDirectUrlCount++;
    } else if (/google\.[a-z.]+\/(?:search|shopping|goto|url|aclk)|ibp=oshop/i.test(url)) {
      googleRedirectUrlCount++;
    } else {
      const check = validateRetailerProductUrl(url, row.merchant || "", {
        allowSearchUrl: false,
      });
      if (check.valid && check.linkType === "exact_product") {
        directMerchantUrlValidCount++;
      } else {
        homepageOrSearchUrlCount++;
      }
    }
  }

  return {
    ...extras,
    totalItems: normalized.length,
    uniqueTitles: seenExactTitle.size,
    duplicateTitles,
    duplicateMerchantTitle,
    relevantCount,
    relevancePct: normalized.length ? Math.round((relevantCount / normalized.length) * 100) : 0,
    withBrandCount,
    withInrPriceCount,
    withMerchantCount,
    withImageCount,
    googleThumbProxyCount,
    nonProxyHttpsImgCount,
    directMerchantUrlValidCount,
    googleRedirectUrlCount,
    homepageOrSearchUrlCount,
    missingDirectUrlCount,
    withAvailabilityOrDelivery,
    withImmersiveTokenCount: normalized.filter((r) => r.hasImmersiveToken).length,
    sampleItems: normalized.slice(0, 4).map((s) => ({
      title: s.title,
      brand: s.brand,
      rawPrice: s.rawPrice,
      parsedAmountInr: s.parsedAmountInr,
      merchant: s.merchant,
      candidateDirectUrl: redactSensitiveText(s.candidateDirectUrl),
      googleShoppingPageUrl: redactSensitiveText(s.googleShoppingPageUrl),
      image: s.image ? `${s.image.slice(0, 90)}${s.image.length > 90 ? "..." : ""}` : null,
      availabilityOrDelivery: s.availabilityOrDelivery,
      rating: s.rating,
      reviews: s.reviews,
      hasImmersiveToken: s.hasImmersiveToken,
    })),
  };
}

async function querySerpApiProvider(query, apiKey, secrets) {
  const t0 = performance.now();
  const url = `https://serpapi.com/search.json?engine=google_shopping&q=${encodeURIComponent(
    query
  )}&gl=in&hl=en&direct_link=true&api_key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  const latencyMs = Math.round(performance.now() - t0);
  const data = await res.json();
  const shopping = Array.isArray(data.shopping_results) ? data.shopping_results : [];

  return {
    provider: "SerpApi",
    endpoint: "GET /search.json?engine=google_shopping&gl=in&hl=en&direct_link=true",
    httpStatus: res.status,
    latencyMs,
    topLevelKeys: Object.keys(data),
    resultType: shopping.length > 0 ? "Google Shopping Merchant Listings" : "No Shopping Listings",
    quotaHeaders: extractQuotaHeaders(res.headers),
    providerMeta: {
      status: data.search_metadata?.status || null,
      totalTimeTaken: data.search_metadata?.total_time_taken || null,
      categorizedBlocks: Array.isArray(data.categorized_shopping_results)
        ? data.categorized_shopping_results.length
        : 0,
      filtersCount: Array.isArray(data.filters) ? data.filters.length : 0,
      error: redactSensitiveText(data.error || null, secrets),
    },
    metrics: summarizeItems("SerpApi", query, shopping),
  };
}

async function querySerperProvider(query, apiKey, secrets) {
  const t0 = performance.now();
  const res = await fetch("https://google.serper.dev/shopping", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q: query, gl: "in", hl: "en", num: 40 }),
    signal: AbortSignal.timeout(12000),
  });
  const latencyMs = Math.round(performance.now() - t0);
  const text = await res.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = { rawText: text.slice(0, 300) };
  }

  const shopping = Array.isArray(data.shopping) ? data.shopping : [];
  const organic = Array.isArray(data.organic) ? data.organic : [];

  return {
    provider: "Serper",
    endpoint: "POST https://google.serper.dev/shopping (gl=in, hl=en, num=40)",
    httpStatus: res.status,
    latencyMs,
    topLevelKeys: Object.keys(data),
    resultType:
      shopping.length > 0
        ? "Google Shopping Cards (data.shopping)"
        : organic.length > 0
        ? "Ordinary Web Search (data.organic)"
        : "Empty / Error",
    quotaHeaders: extractQuotaHeaders(res.headers),
    providerMeta: {
      creditsUsed: data.credits ?? null,
      searchParameters: data.searchParameters || null,
      error: redactSensitiveText(data.message || data.error || null, secrets),
    },
    metrics: summarizeItems("Serper", query, shopping),
  };
}

async function querySearchApiProvider(query, apiKey, secrets) {
  const t0 = performance.now();
  const url = `https://www.searchapi.io/api/v1/search?engine=google_shopping&q=${encodeURIComponent(
    query
  )}&gl=in&hl=en&link=resolved`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(15000),
  });
  const latencyMs = Math.round(performance.now() - t0);
  const text = await res.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = { rawText: text.slice(0, 300) };
  }

  const shopping = Array.isArray(data.shopping_results)
    ? data.shopping_results
    : Array.isArray(data.products)
    ? data.products
    : [];
  const organic = Array.isArray(data.organic_results) ? data.organic_results : [];

  return {
    provider: "SearchApi",
    endpoint: "GET /api/v1/search?engine=google_shopping&gl=in&hl=en&link=resolved",
    httpStatus: res.status,
    latencyMs,
    topLevelKeys: Object.keys(data),
    resultType:
      shopping.length > 0
        ? "Google Shopping Merchant Listings (data.shopping_results)"
        : organic.length > 0
        ? "Ordinary Web Search (data.organic_results)"
        : "Empty / Error",
    quotaHeaders: extractQuotaHeaders(res.headers),
    providerMeta: {
      status: data.search_metadata?.status || null,
      totalTimeTaken: data.search_metadata?.total_time_taken || null,
      filtersCount: Array.isArray(data.filters) ? data.filters.length : 0,
      hasPagination: Boolean(data.pagination),
      error: redactSensitiveText(data.error || data.message || null, secrets),
    },
    metrics: summarizeItems("SearchApi", query, shopping),
  };
}

async function queryHasDataProvider(query, apiKey, secrets) {
  const t0 = performance.now();
  const url = `https://api.hasdata.com/scrape/google/shopping?q=${encodeURIComponent(
    query
  )}&gl=in&hl=en`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(15000),
  });
  const latencyMs = Math.round(performance.now() - t0);
  const text = await res.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = { rawText: text.slice(0, 300) };
  }

  const shopping = Array.isArray(data.shoppingResults)
    ? data.shoppingResults
    : Array.isArray(data.shopping_results)
    ? data.shopping_results
    : Array.isArray(data.shopping)
    ? data.shopping
    : Array.isArray(data.results)
    ? data.results
    : [];
  const organic = Array.isArray(data.organicResults)
    ? data.organicResults
    : Array.isArray(data.organic_results)
    ? data.organic_results
    : [];

  return {
    provider: "HasData",
    endpoint: "GET /scrape/google/shopping?gl=in&hl=en",
    httpStatus: res.status,
    latencyMs,
    topLevelKeys: Object.keys(data),
    resultType:
      shopping.length > 0
        ? `Google Shopping Merchant Listings (${
            Array.isArray(data.shoppingResults)
              ? "data.shoppingResults"
              : Array.isArray(data.shopping_results)
              ? "data.shopping_results"
              : "data.shopping/results"
          })`
        : organic.length > 0
        ? "Ordinary Web Search"
        : "Empty / Error",
    quotaHeaders: extractQuotaHeaders(res.headers),
    providerMeta: {
      status: data.requestMetadata?.status || data.status || null,
      filtersCount: Array.isArray(data.filters) ? data.filters.length : 0,
      error: redactSensitiveText(
        data.error || data.message || (typeof data.rawText === "string" ? data.rawText : null),
        secrets
      ),
    },
    metrics: summarizeItems("HasData", query, shopping),
  };
}

async function main() {
  const env = loadEnvLocal();
  const serpApiKey = (env.SERPAPI_KEY || "").trim();
  const serperKey = (env.SERPER_API_KEY || "").trim();
  const searchApiKey = (env.SEARCHAPI_API_KEY || "").trim();
  const hasDataKey = (env.HASDATA_API_KEY || "").trim();

  const secrets = [serpApiKey, serperKey, searchApiKey, hasDataKey].filter(Boolean);

  console.log("=== ENV KEY PRESENCE (VALUES REDACTED) ===");
  console.log({
    SERPAPI_KEY: Boolean(serpApiKey),
    SERPER_API_KEY: Boolean(serperKey),
    SEARCHAPI_API_KEY: Boolean(searchApiKey),
    HASDATA_API_KEY: Boolean(hasDataKey),
  });

  const report = {
    generatedAt: new Date().toISOString(),
    queries: QUERIES,
    results: {},
  };

  for (const query of QUERIES) {
    console.log(`\nRunning query: "${query}" ...`);
    const tasks = [
      serpApiKey
        ? querySerpApiProvider(query, serpApiKey, secrets).catch((e) => ({
            provider: "SerpApi",
            error: redactSensitiveText(e.message, secrets),
          }))
        : Promise.resolve({ provider: "SerpApi", skipped: "Key not present" }),
      serperKey
        ? querySerperProvider(query, serperKey, secrets).catch((e) => ({
            provider: "Serper",
            error: redactSensitiveText(e.message, secrets),
          }))
        : Promise.resolve({ provider: "Serper", skipped: "Key not present" }),
      searchApiKey
        ? querySearchApiProvider(query, searchApiKey, secrets).catch((e) => ({
            provider: "SearchApi",
            error: redactSensitiveText(e.message, secrets),
          }))
        : Promise.resolve({ provider: "SearchApi", skipped: "Key not present" }),
      hasDataKey
        ? queryHasDataProvider(query, hasDataKey, secrets).catch((e) => ({
            provider: "HasData",
            error: redactSensitiveText(e.message, secrets),
          }))
        : Promise.resolve({ provider: "HasData", skipped: "Key not present" }),
    ];

    const outcomes = await Promise.all(tasks);
    report.results[query] = outcomes;

    for (const o of outcomes) {
      if (o.error || o.skipped) {
        console.log(`  [${o.provider}] error/skipped:`, o.error || o.skipped);
      } else {
        const m = o.metrics;
        console.log(
          `  [${o.provider}] HTTP ${o.httpStatus} | ${o.latencyMs}ms | type="${o.resultType}" | items=${m.totalItems} | rel=${m.relevantCount} (${m.relevancePct}%) | INR=${m.withInrPriceCount} | merchant=${m.withMerchantCount} | directUrl=${m.directMerchantUrlValidCount} | googleRedir=${m.googleRedirectUrlCount} | dupTitles=${m.duplicateTitles} | img=${m.withImageCount} (proxy:${m.googleThumbProxyCount}, direct:${m.nonProxyHttpsImgCount})`
        );
      }
    }
  }

  const outFile = path.resolve(
    process.cwd(),
    "scripts",
    "provider-eval-evidence.json"
  );
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");
  console.log(`\nSaved full redacted evidence to ${outFile}`);
}

main().catch((err) => {
  console.error("Evaluation failed:", err?.message || err);
  process.exit(1);
});

