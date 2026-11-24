/**
 * Comprehensive verification suite for LuxeIndex multi-provider Google Shopping integration.
 * - Part 1: Unit & resilience tests (matcher, normalizer, deduplicator, cache, quota/circuit breaker, mocked failures)
 * - Part 2: Live HTTP tests against running Next.js server (all 4 benchmark queries, cache HIT, /api/product/[id], /api/compare)
 *
 * Strictly redacts/never prints any API keys or secrets.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") {
      return nextResolve("next/server.js", context);
    }
    let basePath = null;
    if (specifier.startsWith("@/")) {
      basePath = path.join(ROOT_DIR, specifier.slice(2));
    } else if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      !path.extname(specifier) &&
      context.parentURL?.startsWith("file://")
    ) {
      basePath = path.resolve(
        path.dirname(fileURLToPath(context.parentURL)),
        specifier
      );
    }

    if (basePath) {
      const candidates = [
        basePath,
        `${basePath}.js`,
        `${basePath}.mjs`,
        path.join(basePath, "index.js"),
      ];
      for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return {
            shortCircuit: true,
            url: pathToFileURL(candidate).href,
          };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

function loadEnvLocal() {
  const envPath = path.join(ROOT_DIR, ".env.local");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

function assertNoSecretsLeaked(obj, label) {
  const serialized = JSON.stringify(obj);
  const secrets = [
    process.env.SERPAPI_KEY,
    process.env.SERPER_API_KEY,
    process.env.SEARCHAPI_API_KEY,
    process.env.HASDATA_API_KEY,
    process.env.BRIGHTDATA_API_KEY,
  ].filter((v) => typeof v === "string" && v.trim().length >= 8);

  for (const secret of secrets) {
    assert.equal(
      serialized.includes(secret),
      false,
      `SECURITY FAILURE: secret key leaked in ${label}`
    );
  }
  assert.equal(
    serialized.includes("immersivePageTokens"),
    false,
    `INTERNAL TOKEN LEAK: immersivePageTokens exposed in ${label}`
  );
  assert.equal(
    serialized.includes("searchApiProductTokens"),
    false,
    `INTERNAL TOKEN LEAK: searchApiProductTokens exposed in ${label}`
  );
}

async function runUnitAndResilienceTests() {
  const { normalizeProductItem } = await import("../lib/search/productNormalizer.js");
  const { scoreProductMatch } = await import("../lib/search/productMatcher.js");
  const { deduplicateAndAggregateProducts, deduplicateWithinProvider } = await import(
    "../lib/search/deduplicator.js"
  );
  const {
    canCallProvider,
    classifyProviderError,
    extractUsageMetadata,
    getQuotaDiagnostics,
    PROVIDER_IDS,
    recordProviderFailure,
    redactSecrets,
    resetQuotaState,
  } = await import("../lib/search/quotaManager.js");
  const {
    buildSearchCacheKey,
    coalescedSearchFetch,
    getSearchCacheEntry,
    setSearchCacheEntry,
  } = await import("../lib/search/searchCache.js");
  const { SerperProvider } = await import("../lib/providers/serperProvider.js");
  const { fetchOffersByProductToken } = await import("../lib/providers/searchApiProvider.js");
  const { getConfiguredProviders } = await import("../lib/providers/providerRegistry.js");

  console.log("=== PART 1: UNIT & RESILIENCE TESTS ===");

  // 1. Secret redaction
  const leakedSample = "https://serpapi.com/search.json?api_key=supersecret123456&q=spf";
  assert.equal(redactSecrets(leakedSample).includes("supersecret123456"), false);

  // 2. Normalizer separates shoppingUrl vs merchantProductUrl strictly
  const serperRaw = normalizeProductItem(
    {
      title: "Minimalist SPF 50 PA++++ Sunscreen Fluid 50g",
      source: "Nykaa",
      link: "https://www.google.com/search?ibp=oshop&q=minimalist",
      price: "₹399",
      imageUrl: "https://images.example.com/minimalist-50g.jpg",
      rating: 4.5,
      ratingCount: 1200,
      productId: "sp_123",
    },
    { provider: "serper", gl: "in" }
  );
  assert.ok(serperRaw);
  assert.equal(serperRaw.price, 399);
  assert.equal(serperRaw.currency, "INR");
  assert.equal(serperRaw.merchant, "Nykaa");
  assert.equal(serperRaw.merchantProductUrl, null, "Must reject ibp=oshop as merchantProductUrl");
  assert.ok(serperRaw.shoppingUrl.includes("ibp=oshop"));

  const serpDirectRaw = normalizeProductItem(
    {
      title: "Minimalist Multi-Vitamin SPF 50 Sunscreen 50g",
      source: "Tira",
      direct_link: "https://www.tirabeauty.com/product/minimalist-spf-50-sunscreen-50g",
      product_link: "https://www.google.com/shopping/product/999",
      price: "₹379",
      extracted_price: 379,
      thumbnail: "https://images.example.com/minimalist-50g-tira.jpg",
      immersive_product_page_token: "tok_secret_internal",
    },
    { provider: "serpapi", gl: "in" }
  );
  assert.ok(serpDirectRaw);
  assert.equal(
    serpDirectRaw.merchantProductUrl,
    "https://www.tirabeauty.com/product/minimalist-spf-50-sunscreen-50g"
  );

  // 3. Variant separation (never merge 30ml vs 50ml, SPF 30 vs SPF 50, serum vs moisturizer)
  const spf30 = normalizeProductItem(
    {
      title: "Minimalist Sunscreen SPF 30 50g",
      source: "Nykaa",
      price: "₹349",
      direct_link: "https://www.nykaa.com/minimalist-spf30/p/1",
    },
    { provider: "serpapi", gl: "in" }
  );
  const spf50_30g = normalizeProductItem(
    {
      title: "Minimalist Sunscreen SPF 50 30g",
      source: "Amazon",
      price: "₹249",
      direct_link: "https://www.amazon.in/dp/B0MIN30",
    },
    { provider: "serpapi", gl: "in" }
  );
  const spf50_50g = normalizeProductItem(
    {
      title: "Minimalist Sunscreen SPF 50 50g",
      source: "Tira",
      price: "₹389",
      direct_link: "https://www.tirabeauty.com/product/min50",
    },
    { provider: "serpapi", gl: "in" }
  );

  assert.equal(scoreProductMatch(spf30, spf50_50g).canMerge, false, "SPF 30 != SPF 50");
  assert.equal(scoreProductMatch(spf50_30g, spf50_50g).canMerge, false, "30g != 50g");

  const serumItem = normalizeProductItem(
    {
      title: "Minimalist 10% Vitamin C Face Serum 30ml",
      source: "Nykaa",
      price: "₹699",
    },
    { provider: "serper", gl: "in" }
  );
  const serum16Item = normalizeProductItem(
    {
      title: "Minimalist 16% Vitamin C Face Serum 30ml",
      source: "Amazon",
      price: "₹699",
    },
    { provider: "serper", gl: "in" }
  );
  assert.equal(scoreProductMatch(serumItem, serum16Item).canMerge, false, "10% != 16%");

  // 4. Intra-provider duplicate collapsing (SearchApi Dot & Key dupe case)
  const dupeA = normalizeProductItem(
    {
      title: "Dot & Key Vitamin C + E Super Bright Sunscreen SPF 50 50g",
      source: "Dot & Key",
      price: "₹445",
      product_token: "sa_tok_1",
      position: 1,
    },
    { provider: "searchapi", gl: "in" }
  );
  const dupeB = normalizeProductItem(
    {
      title: "Dot & Key Vitamin C + E Super Bright Sunscreen SPF 50 50g",
      source: "Dot & Key",
      price: "₹445",
      position: 8,
    },
    { provider: "searchapi", gl: "in" }
  );
  const intraDeduped = deduplicateWithinProvider([dupeA, dupeB]);
  assert.equal(intraDeduped.length, 1, "Intra-provider duplicate must collapse to 1");
  assert.equal(intraDeduped[0].providerProductToken, "sa_tok_1", "Keeps richer duplicate");

  // 5. Domestic Indian retailer priority vs desertcart international import
  const intlReseller = normalizeProductItem(
    {
      title: "La Roche-Posay Anthelios Invisible Fluid SPF 50 50ml",
      source: "Desertcart India",
      price: "₹4,999",
      position: 1,
    },
    { provider: "serper", gl: "in" }
  );
  const indianReseller = normalizeProductItem(
    {
      title: "Dot & Key Vitamin C Sunscreen SPF 50 50g",
      source: "Nykaa",
      price: "₹399",
      position: 5,
    },
    { provider: "serpapi", gl: "in" }
  );
  const grouped = deduplicateAndAggregateProducts([intlReseller, indianReseller], {
    displayCurrency: "INR",
    registerInServerCache: false,
  });
  assert.equal(grouped[0].isInternationalImport, false, "Domestic Indian offer ranks first");
  assert.equal(grouped[1].isInternationalImport, true, "Desertcart flagged as import");

  // 6. Cache rules: never cache failures, coalesced concurrency, hit reuse
  const testCacheKey = buildSearchCacheKey("unit_test_v2", { q: "test_cache_item", gl: "in" });
  const rejected = setSearchCacheEntry(testCacheKey, { products: [] }, { isFailure: true });
  assert.equal(rejected, null, "Must never cache failure payloads");

  let concurrentRuns = 0;
  const [c1, c2] = await Promise.all([
    coalescedSearchFetch("unit_coalesce_key", async () => {
      concurrentRuns += 1;
      await new Promise((r) => setTimeout(r, 25));
      return { ok: true };
    }),
    coalescedSearchFetch("unit_coalesce_key", async () => {
      concurrentRuns += 1;
      return { ok: true };
    }),
  ]);
  assert.equal(concurrentRuns, 1, "Concurrent in-flight requests must coalesce");
  assert.deepEqual(c1, c2);

  // 7. Registry & HasData inactive check
  const registry = getConfiguredProviders("in");
  const hasdataEntry = registry.find((p) => p.providerKey === "hasdata");
  assert.ok(hasdataEntry);
  assert.equal(hasdataEntry.enabled, false, "HasData must remain disabled while under review");
  assert.equal(hasdataEntry.status, "under_review");

  // 8. Quota, headers, error taxonomy, circuit breaker & mocked Serper/SearchApi calls
  resetQuotaState();
  const usageMeta = extractUsageMetadata(PROVIDER_IDS.SERPER, {
    headers: new Headers({
      "x-ratelimit-limit": "2500",
      "x-ratelimit-remaining": "2491",
    }),
    payload: { credits: 2 },
    latencyMs: 312,
  });
  assert.equal(usageMeta.rateLimitLimit, 2500);
  assert.equal(usageMeta.rateLimitRemaining, 2491);
  assert.equal(usageMeta.creditsUsed, 2);

  assert.equal(classifyProviderError({ status: 401 }).errorType, "AUTH_ERROR");
  assert.equal(classifyProviderError({ status: 429 }).errorType, "RATE_LIMITED");
  assert.equal(classifyProviderError({ status: 504 }).errorType, "TIMEOUT");

  // Mock Apify returning HTTP 200 with {error:{type:"user-or-token-not-found"}}.
  // The platform wraps auth failures in a 200 response body rather than 401.
  // This verifies the extended patterns in classifyProviderError correctly classify
  // this as AUTH_ERROR rather than PROVIDER_UNAVAILABLE, so the budget ledger
  // records authRejectedBeforeRun=true → zero cost.
  assert.equal(
    classifyProviderError({
      status: 200,
      payload: { error: { type: "user-or-token-not-found", message: "User was not found or authentication token is not valid" } },
      message: "User was not found or authentication token is not valid",
    }).errorType,
    "AUTH_ERROR"
  );

  const origFetch = globalThis.fetch;
  try {
    // Mock timeout failure on Serper (3 failures open circuit, then gate blocks call)
    process.env.SERPER_API_KEY = process.env.SERPER_API_KEY || "mock_key_for_unit_test";
    globalThis.fetch = async () => {
      const err = new Error("Request aborted due to timeout");
      err.name = "AbortError";
      throw err;
    };
    await SerperProvider.searchProducts("sunscreen");
    await SerperProvider.searchProducts("sunscreen");
    const thirdFail = await SerperProvider.searchProducts("sunscreen");
    assert.equal(thirdFail.errorType, "TIMEOUT");
    const gateAfter3Timeouts = canCallProvider(PROVIDER_IDS.SERPER);
    assert.equal(gateAfter3Timeouts.allowed, false);
    assert.equal(gateAfter3Timeouts.reason, "circuit_open");

    // Mock SearchApi google_product_offers Mode B fallback
    resetQuotaState(PROVIDER_IDS.SEARCHAPI);
    process.env.SEARCHAPI_API_KEY =
      process.env.SEARCHAPI_API_KEY || "mock_searchapi_for_unit_test";
    globalThis.fetch = async (url) => {
      assert.ok(String(url).includes("engine=google_product_offers"));
      return new Response(
        JSON.stringify({
          product: { title: "Minimalist SPF 50 Sunscreen 50g", rating: 4.5, reviews: 800 },
          offers: [
            {
              merchant: "Nykaa",
              title: "Minimalist SPF 50 Sunscreen 50g",
              link: "https://www.nykaa.com/minimalist-spf-50/p/12345",
              price: "₹379",
              extracted_price: 379,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };
    const fallbackOffers = await fetchOffersByProductToken({
      productToken: "mock_token_abc",
      gl: "in",
    });
    assert.equal(fallbackOffers.length, 1);
    assert.equal(fallbackOffers[0].link, "https://www.nykaa.com/minimalist-spf-50/p/12345");
    assert.equal(fallbackOffers[0].source, "Nykaa");

    // Verify 429 rate-limit opens SearchApi circuit immediately
    recordProviderFailure(PROVIDER_IDS.SEARCHAPI, {
      errorType: "RATE_LIMITED",
      message: "429 too many requests",
    });
    assert.equal(canCallProvider(PROVIDER_IDS.SEARCHAPI).allowed, false);
  } finally {
    globalThis.fetch = origFetch;
    resetQuotaState();
  }

  // 9. BUG 1 TESTS — SearchApi merchant object & malformed source normalization
  const { extractSearchApiMerchantInfo } = await import(
    "../lib/providers/searchApiProvider.js"
  );
  const strMerchant = extractSearchApiMerchantInfo({
    merchant: "Purplle",
    link: "https://www.purplle.com/product/minimalist-spf-50/p/1",
  });
  assert.equal(strMerchant.merchantName, "Purplle");
  assert.equal(strMerchant.merchantUrl, "https://www.purplle.com/product/minimalist-spf-50/p/1");

  const objMerchant = extractSearchApiMerchantInfo({
    merchant: { name: "Purplle.com - Beauty Online", favicon: "https://encrypted-tbn0.gstatic.com/faviconV2?url=https://www.purplle.com" },
    link: "https://www.purplle.com/track?dpl=1&redirect=https%3A%2F%2Fwww.purplle.com%2Fproduct%2Fitem",
  });
  assert.equal(objMerchant.merchantName, "Purplle.com - Beauty Online");
  assert.equal(objMerchant.merchantName.includes("[object Object]"), false);
  assert.ok(objMerchant.merchantUrl.includes("purplle.com/track"));

  const sellerObj = extractSearchApiMerchantInfo({
    seller: { name: "The Deconstruct" },
    link: "https://thedeconstruct.in/products/gel-sunscreen?srsltid=abc",
  });
  assert.equal(sellerObj.merchantName, "The Deconstruct");

  const missingMerchant = extractSearchApiMerchantInfo({
    merchant: null,
    link: "https://www.nykaa.com/minimalist-spf-50/p/123",
  });
  assert.equal(missingMerchant.merchantName, "Nykaa");
  assert.equal(missingMerchant.merchantUrl, "https://www.nykaa.com/minimalist-spf-50/p/123");

  const malformedMerchant = extractSearchApiMerchantInfo({
    merchant: { unexpected: 123 },
    seller: "[object Object]",
    link: "https://www.amazon.in/dp/B09FPS9D5T",
  });
  assert.equal(malformedMerchant.merchantName, "Amazon");
  assert.equal(malformedMerchant.merchantName.includes("[object Object]"), false);

  const totallyEmptyMerchant = extractSearchApiMerchantInfo({
    merchant: {},
    seller: {},
  });
  assert.equal(totallyEmptyMerchant.merchantName, "Online Store");
  assert.equal(totallyEmptyMerchant.merchantUrl, null);

  const nestedStoreMerchant = extractSearchApiMerchantInfo({
    merchant: { store: { name: "Flipkart Beauty" } },
    link: "https://www.flipkart.com/minimalist-spf-50/p/itm123",
  });
  assert.equal(nestedStoreMerchant.merchantName, "Flipkart");

  const numericMerchant = extractSearchApiMerchantInfo({
    merchant: 98765,
    seller: undefined,
    link: "",
  });
  assert.equal(numericMerchant.merchantName, "Online Store");
  assert.equal(numericMerchant.merchantUrl, null);

  // 10. BUG 2 TESTS — Server-side SearchApi token persistence across simulated restart
  const {
    __resetDiscoveryRamOnlyForTest,
    getRegisteredProduct,
    registerDiscoveredProduct,
  } = await import("../lib/discoveryCache.js");
  const persistTestId = "minimalist__test-restart-persistence__50ml";
  registerDiscoveredProduct(persistTestId, {
    id: persistTestId,
    name: "Minimalist Light Fluid SPF 50 Face Sunscreen 50ml",
    brand: "Minimalist",
    volume: "50ml",
    searchApiProductTokens: ["sa_persist_tok_987"],
    immersivePageTokens: ["imm_persist_tok_654"],
    dataSource: "live",
  });
  __resetDiscoveryRamOnlyForTest(); // Clears RAM maps completely
  const rehydratedAfterRestart = getRegisteredProduct(persistTestId);
  assert.ok(rehydratedAfterRestart, "Product must re-hydrate from server token store after restart");
  assert.deepEqual(rehydratedAfterRestart.searchApiProductTokens, ["sa_persist_tok_987"]);
  assert.deepEqual(rehydratedAfterRestart.immersivePageTokens, ["imm_persist_tok_654"]);
  // Re-registering without tokens (simulating disk cache HIT) must NOT clobber existing tokens
  registerDiscoveredProduct(persistTestId, {
    id: persistTestId,
    name: "Minimalist Light Fluid SPF 50 Face Sunscreen 50ml",
    dataSource: "cached",
  });
  assert.deepEqual(
    getRegisteredProduct(persistTestId).searchApiProductTokens,
    ["sa_persist_tok_987"]
  );

  // Word-order canonical alias hydration across restarted server
  registerDiscoveredProduct("minimalist__light-fluid-spf-50-sunscreen__50ml_spf 50_noconc", {
    id: "minimalist__light-fluid-spf-50-sunscreen__50ml_spf 50_noconc",
    name: "Minimalist Light Fluid SPF 50 Face Sunscreen",
    brand: "Minimalist",
    volume: "50ml",
    searchApiProductTokens: ["sa_light_fluid_alias_tok"],
    dataSource: "live",
  });
  __resetDiscoveryRamOnlyForTest();
  const aliasResolved = getRegisteredProduct("minimalist__spf-50-light-fluid-sunscreen__50ml_spf 50_noconc");
  assert.ok(aliasResolved, "Alias lookup must hydrate canonical word-order variant across restart");
  assert.ok(aliasResolved.searchApiProductTokens.includes("sa_light_fluid_alias_tok"));

  // 11. BUG 3 TESTS — Exact merchant URL validation & wrong-product slug guard
  const { validateRetailerProductUrl } = await import("../lib/urlValidator.js");
  const expectedMin50 = { brand: "Minimalist", size: "50ml" };

  assert.equal(
    validateRetailerProductUrl(
      "https://www.amazon.in/Minimalist-Sunscreen-Multi-Vitamins/dp/B09FPS9D5T?psc=1&smid=A3OQ",
      "Amazon Luxury",
      { expectedProduct: expectedMin50 }
    ).linkType,
    "exact_product"
  );
  assert.equal(
    validateRetailerProductUrl(
      "https://www.purplle.com/track?dpl=1&redirect=https%3A%2F%2Fwww.purplle.com%2Fproduct%2Fminimalist-spf-50-sunscreen-50ml&srsltid=AYCX",
      "Purplle",
      { expectedProduct: expectedMin50 }
    ).linkType,
    "exact_product"
  );
  assert.equal(
    validateRetailerProductUrl(
      "https://www.nykaa.com/minimalist-light-fluid-spf-50-face-sunscreen/p/20540004?ptype=product&skuId=2397",
      "Nykaa",
      { expectedProduct: expectedMin50 }
    ).linkType,
    "exact_product"
  );
  assert.equal(
    validateRetailerProductUrl(
      "https://www.google.com/search?ibp=oshop&q=minimalist",
      "Nykaa"
    ).valid,
    false,
    "Must reject Google Shopping ibp=oshop redirect"
  );
  assert.equal(
    validateRetailerProductUrl("https://www.nykaa.com/", "Nykaa").valid,
    false,
    "Must reject bare retailer homepage"
  );
  assert.equal(
    validateRetailerProductUrl("", "Nykaa").valid,
    false,
    "Must reject missing URL"
  );
  assert.equal(
    validateRetailerProductUrl("javascript:alert(1)", "Nykaa").valid,
    false,
    "Must reject unsafe/malformed URL"
  );
  assert.equal(
    validateRetailerProductUrl(
      "https://www.nykaa.com/cetaphil-gentle-skin-cleanser-100ml/p/999",
      "Nykaa",
      { expectedProduct: expectedMin50 }
    ).valid,
    false,
    "Must reject verified URL whose path belongs to a different product/brand/size"
  );

  // 12. BUG 4 TESTS — Relevance scoring, misspellings, mixed queries & nonsense rejection
  const {
    evaluateProductQueryRelevance,
    filterRelevantDiscoveryProducts,
    isObviouslyNonsenseQuery,
  } = await import("../lib/search/relevance.js");

  const sampleMinProd = {
    title: "Minimalist Light Fluid SPF 50 Sunscreen 50ml",
    brand: "Minimalist",
    category: "Sunscreen",
    spf: "SPF 50",
    variant: "SPF 50 · Light Fluid",
  };
  const sampleNeutProd = {
    title: "Neutrogena Ultra Sheer Dry-Touch Sunblock SPF 50+",
    brand: "Neutrogena",
    category: "Sunscreen",
    spf: "SPF 50+",
  };
  const sampleSerumProd = {
    title: "Minimalist 10% Vitamin C Face Serum 30ml",
    brand: "Minimalist",
    category: "Serums",
    ingredients: ["Vitamin C"],
  };
  const sampleMoistProd = {
    title: "CeraVe Moisturising Cream for Dry Skin",
    brand: "CeraVe",
    category: "Moisturizers",
  };
  const unrelatedLipstick = {
    title: "Being Iban ZM Zayn & Myza Rich Matte Lipstick",
    brand: "Being Iban",
    category: "Makeup",
  };

  assert.equal(evaluateProductQueryRelevance(sampleMinProd, "sunscreen").relevant, true);
  assert.equal(evaluateProductQueryRelevance(sampleMinProd, "sunscren").relevant, true, "Misspelling tolerance");
  assert.equal(evaluateProductQueryRelevance(sampleMoistProd, "moisturizer").relevant, true);
  assert.equal(evaluateProductQueryRelevance(sampleMoistProd, "moisturisr").relevant, true, "Misspelling tolerance");
  assert.equal(evaluateProductQueryRelevance(sampleSerumProd, "vitamin C serum").relevant, true);
  assert.equal(
    evaluateProductQueryRelevance(sampleMinProd, "Minimalist SPF 50 sunscreen", {
      matchedBrands: ["Minimalist"],
    }).relevant,
    true
  );
  assert.equal(
    evaluateProductQueryRelevance(sampleNeutProd, "neutorgena sunscreen").relevant,
    true,
    "Transposition typo in brand name must match"
  );
  assert.equal(
    evaluateProductQueryRelevance(sampleSerumProd, "Minimalist vitamin C serum", {
      matchedBrands: ["Minimalist"],
    }).relevant,
    true
  );
  assert.equal(isObviouslyNonsenseQuery("zzzznonexistentbeautyxyz999"), true);
  assert.equal(
    filterRelevantDiscoveryProducts([unrelatedLipstick, sampleMinProd], "zzzznonexistentbeautyxyz999").length,
    0,
    "Nonsense query must reject unrelated fallback beauty items"
  );

  // 13. VARIANT ACCURACY TESTS — Size/unit, multipack, SPF, formulation, and "Variant unverified"
  const {
    extractVariantSignature,
    evaluateVariantComparison,
    volumesCompatible,
    areFormulationsCompatible,
    sortOffers,
  } = await import("../lib/utils.js");
  const { buildCanonicalGroupKey } = await import("../lib/catalogIdentity.js");

  // 13a. Unit & size normalization (gm/gms -> g, ml !== g, 2 x 50ml -> packCount=2 & volume=50ml)
  const sig30gm = extractVariantSignature("Minimalist SPF 50 Sunscreen 30gm");
  assert.equal(sig30gm.volume, "30g");
  assert.equal(sig30gm.spf, "spf 50");
  assert.equal(sig30gm.packCount, 1);

  const sig50ml = extractVariantSignature("Minimalist Light Fluid SPF 50 Face Sunscreen 50ml");
  assert.equal(sig50ml.volume, "50ml");
  assert.equal(sig50ml.formulation, "light-fluid");
  assert.equal(sig50ml.formulationLabel, "Light Fluid");
  assert.equal(sig50ml.packCount, 1);

  const sig100ml = extractVariantSignature("Minimalist SPF 50 Sunscreen 100ml");
  assert.equal(sig100ml.volume, "100ml");

  const sigTwin = extractVariantSignature("Minimalist Light Fluid SPF 50 Sunscreen 2 x 50ml");
  assert.equal(sigTwin.volume, "50ml");
  assert.equal(sigTwin.packCount, 2, "2 x 50ml must extract packCount=2 instead of 50");
  assert.equal(sigTwin.isBundle, true);

  assert.equal(volumesCompatible("30g", "30g"), true);
  assert.equal(volumesCompatible("30g", "30ml"), false, "30g vs 30ml must not be treated as identical");
  assert.equal(volumesCompatible("50ml", "100ml"), false);
  assert.equal(volumesCompatible("50ml", null), false);

  // 13b. Formulation separation (Light Fluid vs Multi-Vitamin vs Cream vs Gel)
  assert.equal(areFormulationsCompatible("light-fluid", "light-fluid"), true);
  assert.equal(areFormulationsCompatible("light-fluid", "cream", ["cream"], ["light-fluid"]), false);
  assert.equal(areFormulationsCompatible("light-fluid", "multi-vitamin", ["multi-vitamin"], ["light-fluid"]), false);

  // 13c. Minimalist Light Fluid SPF 50 50ml matrix classification
  const baseLF50 = {
    query: "Minimalist Light Fluid SPF 50 50ml",
    referenceTitle: "Minimalist Light Fluid SPF 50 Face Sunscreen 50ml",
    expectedVolume: "50ml",
    expectedSpf: "spf 50",
    expectedFormulation: "light-fluid",
    expectedFormulationLabel: "Light Fluid",
  };

  assert.equal(
    evaluateVariantComparison({
      ...baseLF50,
      candidateTitle: "Minimalist Light Fluid SPF 50 Face Sunscreen, 50ml",
    }).classification,
    "exact"
  );

  const missingSizeRes = evaluateVariantComparison({
    ...baseLF50,
    candidateTitle: "Minimalist Light Fluid SPF 50 Face Sunscreen",
  });
  assert.equal(missingSizeRes.classification, "unverified", "Missing size must mark Variant unverified");
  assert.equal(missingSizeRes.variantStatusLabel, "Variant unverified");
  assert.equal(missingSizeRes.detectedVolume, null, "Must never invent missing size");

  const missingFormRes = evaluateVariantComparison({
    ...baseLF50,
    candidateTitle: "Minimalist SPF 50 Sunscreen 50ml",
  });
  assert.equal(missingFormRes.classification, "unverified", "Missing formulation must mark Variant unverified");

  for (const [title, desc] of [
    ["Minimalist Light Fluid SPF 50 Sunscreen 30ml", "30ml vs 50ml"],
    ["Minimalist Light Fluid SPF 50 Sunscreen 100ml", "100ml vs 50ml"],
    ["Minimalist Multi-Vitamin SPF 50 Sunscreen 50g", "Multi-Vitamin 50g vs Light Fluid 50ml"],
    ["Minimalist SPF 50 Sunscreen Cream 30gm", "Cream 30g vs Light Fluid 50ml"],
    ["Minimalist Light Fluid SPF 30 Sunscreen 50ml", "SPF 30 vs SPF 50"],
    ["Minimalist Light Fluid SPF 50+ Sunscreen 50ml", "SPF 50+ vs SPF 50"],
    ["Minimalist Light Fluid SPF 50 Sunscreen 50ml (Pack of 2)", "Pack of 2 vs Single"],
    ["Minimalist Light Fluid SPF 50 Sunscreen 2 x 50ml", "2 x 50ml vs Single"],
  ]) {
    const res = evaluateVariantComparison({ ...baseLF50, candidateTitle: title });
    assert.equal(res.classification, "variant", `Expected Other available variant for ${desc}, got ${res.classification} (${res.reason})`);
    assert.equal(res.variantStatusLabel, "Other available variant");
    assert.equal(res.isExactVariant, false);
  }

  assert.equal(
    evaluateVariantComparison({
      ...baseLF50,
      candidateTitle: "Minimalist 10% Niacinamide Face Serum 30ml",
    }).classification,
    "unrelated",
    "Different product line (Niacinamide Serum) must remain unrelated"
  );

  // 13d. Canonical grouping key keeps 30gm / 50ml / 100ml / Pack of 2 / Cream vs Light Fluid separate while preserving ID stability
  assert.equal(
    buildCanonicalGroupKey({
      title: "Minimalist SPF 50 Light Fluid Sunscreen",
      brand: "Minimalist",
      sizeLabel: "50ml",
      spfTier: "SPF 50",
    }),
    "minimalist__spf-50-light-fluid-sunscreen__50ml_spf 50_noconc"
  );
  assert.notEqual(
    buildCanonicalGroupKey({
      title: "Minimalist SPF 50 Sunscreen",
      brand: "Minimalist",
      sizeLabel: "30g",
      spfTier: "SPF 50",
      formulation: "cream",
      packCount: 1,
    }),
    buildCanonicalGroupKey({
      title: "Minimalist SPF 50 Sunscreen",
      brand: "Minimalist",
      sizeLabel: "50g",
      spfTier: "SPF 50",
      formulation: "cream",
      packCount: 1,
    })
  );
  assert.notEqual(
    buildCanonicalGroupKey({
      title: "Minimalist Light Fluid SPF 50 Sunscreen",
      brand: "Minimalist",
      sizeLabel: "50ml",
      spfTier: "SPF 50",
      formulation: "light-fluid",
      packCount: 1,
    }),
    buildCanonicalGroupKey({
      title: "Minimalist Light Fluid SPF 50 Sunscreen",
      brand: "Minimalist",
      sizeLabel: "50ml",
      spfTier: "SPF 50",
      formulation: "light-fluid",
      packCount: 2,
    })
  );

  // 13e. sortOffers exactVariantsOnly requires explicit variantMatchStatus === "exact"
  assert.equal(
    sortOffers(
      [
        { retailer: "A", variantMatchStatus: "exact", displayPrice: 450, inStock: true },
        { retailer: "B", variantMatchStatus: "unverified-size", displayPrice: 300, inStock: true },
        { retailer: "C", displayPrice: 250, inStock: true },
      ],
      "price",
      { exactVariantsOnly: true }
    ).length,
    1
  );

  // 13f. extractBrandFromItem prioritizes title brand over search query parameters in URL
  const { extractBrandFromItem } = await import("../lib/catalogIdentity.js");
  assert.notEqual(
    extractBrandFromItem({
      title: "Fixderma Shadow SPF 50+ Cream Sunscreen",
      source: "Zepto",
      url: "https://www.zeptonow.com/search?query=Minimalist+SPF+50+sunscreen",
    }),
    "Minimalist"
  );

  // 14. Bright Data SERP provider, fail-closed gating, monthly safety reserve, and router integration
  const {
    BrightDataProvider,
    buildBrightDataShoppingUrl,
    extractBrightDataLinks,
  } = await import("../lib/providers/brightDataProvider.js");
  const { getMonthlyCreditStatus } = await import("../lib/search/quotaManager.js");
  const { routeMultiProviderDiscovery } = await import("../lib/search/queryRouter.js");

  // 14a. Google Shopping udm=28 URL builder & /url?q= unwrapping
  const bdUrl = new URL(
    buildBrightDataShoppingUrl({ query: "Minimalist SPF 50 sunscreen", gl: "in", hl: "en" })
  );
  assert.equal(bdUrl.searchParams.get("udm"), "28");
  assert.equal(bdUrl.searchParams.get("gl"), "in");
  assert.equal(bdUrl.searchParams.get("hl"), "en");
  assert.equal(bdUrl.searchParams.get("brd_json"), "1");

  const unwrappedBd = extractBrightDataLinks({
    link: "https://www.google.com/url?q=https%3A%2F%2Fwww.nykaa.com%2Fminimalist-spf-50%2Fp%2F123&sa=U",
  });
  assert.equal(unwrappedBd.directLink, "https://www.nykaa.com/minimalist-spf-50/p/123");
  assert.equal(unwrappedBd.shoppingLink, null);

  const googleShoppingOnlyBd = extractBrightDataLinks({
    link: "https://www.google.com/shopping/product/999888?gl=in",
  });
  assert.equal(googleShoppingOnlyBd.directLink, null);
  assert.equal(
    googleShoppingOnlyBd.shoppingLink,
    "https://www.google.com/shopping/product/999888?gl=in"
  );

  // 14b–14e run with isolated env & temp ledger
  const savedEnv = {
    BRIGHTDATA_ENABLED: process.env.BRIGHTDATA_ENABLED,
    BRIGHTDATA_API_KEY: process.env.BRIGHTDATA_API_KEY,
    BRIGHTDATA_SERP_ZONE: process.env.BRIGHTDATA_SERP_ZONE,
    BRIGHTDATA_LEDGER_PATH: process.env.BRIGHTDATA_LEDGER_PATH,
    SERPAPI_ENABLED: process.env.SERPAPI_ENABLED,
    SERPER_ENABLED: process.env.SERPER_ENABLED,
    SEARCHAPI_ENABLED: process.env.SEARCHAPI_ENABLED,
    APIFY_ENABLED: process.env.APIFY_ENABLED,
    APIFY_API_TOKEN: process.env.APIFY_API_TOKEN,
  };
  const tempLedgerPath = path.join(os.tmpdir(), `luxeindex-bd-test-${Date.now()}.json`);
  const originalFetch = global.fetch;

  try {
    process.env.BRIGHTDATA_LEDGER_PATH = tempLedgerPath;
    resetQuotaState(PROVIDER_IDS.BRIGHTDATA, { clearMonthlyLedger: true });

    // 14b. Fail-closed defaults
    delete process.env.BRIGHTDATA_ENABLED;
    process.env.BRIGHTDATA_API_KEY = "bd_test_secret_value_99999";
    process.env.BRIGHTDATA_SERP_ZONE = "serp_api_test";
    assert.equal(canCallProvider(PROVIDER_IDS.BRIGHTDATA).allowed, false);
    assert.equal(canCallProvider(PROVIDER_IDS.BRIGHTDATA).reason, "disabled_by_env");

    process.env.BRIGHTDATA_ENABLED = "false";
    assert.equal(canCallProvider(PROVIDER_IDS.BRIGHTDATA).allowed, false);
    assert.equal(canCallProvider(PROVIDER_IDS.BRIGHTDATA).reason, "disabled_by_env");

    process.env.BRIGHTDATA_ENABLED = "true";
    delete process.env.BRIGHTDATA_SERP_ZONE;
    assert.equal(canCallProvider(PROVIDER_IDS.BRIGHTDATA).allowed, false);
    assert.equal(canCallProvider(PROVIDER_IDS.BRIGHTDATA).reason, "missing_serp_zone");

    // Redaction of BRIGHTDATA_API_KEY
    assert.equal(
      redactSecrets(`Bearer ${process.env.BRIGHTDATA_API_KEY} failed`).includes(
        process.env.BRIGHTDATA_API_KEY
      ),
      false
    );

    // 14c. Mocked Bright Data parsed_light success + EMPTY_RESULTS + 402 + 500 + safety reserve
    process.env.BRIGHTDATA_SERP_ZONE = "serp_api_test";
    resetQuotaState(PROVIDER_IDS.BRIGHTDATA, { clearMonthlyLedger: true });
    assert.equal(canCallProvider(PROVIDER_IDS.BRIGHTDATA).allowed, true);

    let fetchCount = 0;
    global.fetch = async (url, init = {}) => {
      fetchCount += 1;
      assert.equal(url, "https://api.brightdata.com/request");
      const reqBody = JSON.parse(init.body);
      assert.equal(reqBody.zone, "serp_api_test");
      assert.equal(reqBody.data_format, "parsed_light");
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            shopping: [
              {
                global_rank: 1,
                title: "Minimalist Light Fluid SPF 50 Sunscreen 50ml",
                price: "₹474",
                old_price: "₹499",
                link: "https://www.google.com/url?q=https%3A%2F%2Fwww.nykaa.com%2Fminimalist-light-fluid%2Fp%2F101&sa=U",
                shop: "Nykaa",
                thumbnail: "https://images-static.nykaa.com/minimalist-light-fluid.jpg",
                rating: 4.5,
                reviews_cnt: 420,
              },
              {
                global_rank: 2,
                title: "Minimalist Light Fluid SPF 50 Sunscreen 50ml",
                price: "₹499",
                link: "https://www.google.com/shopping/product/123456?gl=in",
                source: "Flipkart",
                image: "https://rukminim2.flixcart.com/image/minimalist.jpg",
                rating: 4.4,
                reviews_cnt: 80,
              },
            ],
          }),
      };
    };

    const bdOk = await BrightDataProvider.searchProducts("Minimalist Light Fluid SPF 50 50ml", {
      gl: "in",
      hl: "en",
    });
    assert.equal(fetchCount, 1);
    assert.equal(bdOk.ok, true);
    assert.equal(bdOk.items.length, 2);
    assert.equal(bdOk.items[0].merchant, "Nykaa");
    assert.equal(bdOk.items[0].reviewCount, 420);
    assert.equal(bdOk.items[0].formulation, "light-fluid");
    assert.equal(bdOk.items[0].size, "50ml");
    assert.equal(
      bdOk.items[0].merchantProductUrl,
      "https://www.nykaa.com/minimalist-light-fluid/p/101"
    );
    assert.equal(bdOk.items[1].merchantProductUrl, null);
    assert.ok(bdOk.items[1].shoppingUrl.includes("google.com/shopping/product/123456"));
    assert.equal(getMonthlyCreditStatus(PROVIDER_IDS.BRIGHTDATA).creditsConsumed, 1);

    // 200 empty results consumes 1 credit and returns EMPTY_RESULTS
    global.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ shopping: [] }),
    });
    const bdEmpty = await BrightDataProvider.searchProducts("sunscreen", { gl: "in", hl: "en" });
    assert.equal(bdEmpty.ok, true);
    assert.equal(bdEmpty.errorType, "EMPTY_RESULTS");
    assert.equal(getMonthlyCreditStatus(PROVIDER_IDS.BRIGHTDATA).creditsConsumed, 2);

    // 500 error retries once and consumes 0 credits
    let errFetchCount = 0;
    global.fetch = async () => {
      errFetchCount += 1;
      return {
        ok: false,
        status: 500,
        text: async () => `Upstream error contacting ${process.env.BRIGHTDATA_API_KEY}`,
      };
    };
    const bd500 = await BrightDataProvider.searchProducts("sunscreen", { gl: "in", hl: "en" });
    assert.equal(bd500.ok, false);
    assert.equal(errFetchCount, 2);
    assert.equal(
      bd500.errorMessage.includes(process.env.BRIGHTDATA_API_KEY),
      false,
      "Error message must redact BRIGHTDATA_API_KEY"
    );
    assert.equal(getMonthlyCreditStatus(PROVIDER_IDS.BRIGHTDATA).creditsConsumed, 2);

    // 402 Quota / Payment Required opens circuit immediately without retry
    resetQuotaState(PROVIDER_IDS.BRIGHTDATA, { clearMonthlyLedger: true });
    let fetch402Count = 0;
    global.fetch = async () => {
      fetch402Count += 1;
      return { ok: false, status: 402, text: async () => "Credit limit exceeded" };
    };
    const bd402 = await BrightDataProvider.searchProducts("sunscreen", { gl: "in", hl: "en" });
    assert.equal(bd402.ok, false);
    assert.equal(bd402.errorType, "RATE_LIMITED");
    assert.equal(fetch402Count, 1);
    assert.equal(canCallProvider(PROVIDER_IDS.BRIGHTDATA).allowed, false);

    // Safety reserve stop at 4,500 credits (5,000 cap - 500 reserve)
    resetQuotaState(PROVIDER_IDS.BRIGHTDATA, { clearMonthlyLedger: true });
    assert.equal(getMonthlyCreditStatus(PROVIDER_IDS.BRIGHTDATA).usableBudgetCredits, 4500);
    assert.equal(getMonthlyCreditStatus(PROVIDER_IDS.BRIGHTDATA).safetyReserveCredits, 500);
    // Run 1 real mocked call to initialize ledger on disk cleanly, then advance to 4,499
    global.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ shopping: [] }),
    });
    await BrightDataProvider.searchProducts("sunscreen", { gl: "in", hl: "en" });
    const rawLedger = JSON.parse(fs.readFileSync(tempLedgerPath, "utf8"));
    rawLedger.creditsConsumed = 4499;
    rawLedger.successfulRequests = 4499;
    fs.writeFileSync(tempLedgerPath, JSON.stringify(rawLedger, null, 2), "utf8");
    // Reset in-memory quota state without clearing ledger to verify persisted ledger check
    resetQuotaState(PROVIDER_IDS.BRIGHTDATA, { clearMonthlyLedger: false });
    assert.equal(canCallProvider(PROVIDER_IDS.BRIGHTDATA).allowed, true);

    await BrightDataProvider.searchProducts("sunscreen", { gl: "in", hl: "en" });
    const reserveStatus = canCallProvider(PROVIDER_IDS.BRIGHTDATA);
    assert.equal(reserveStatus.allowed, false);
    assert.equal(reserveStatus.reason, "monthly_safety_reserve_reached");
    assert.equal(getMonthlyCreditStatus(PROVIDER_IDS.BRIGHTDATA).creditsConsumed, 4500);

    // 14d. Formulation mismatch guard & verified-URL preservation across providers
    const lightFluid50 = normalizeProductItem(
      {
        title: "Minimalist Light Fluid SPF 50 Sunscreen 50ml",
        shop: "Nykaa",
        link: "https://www.nykaa.com/minimalist-light-fluid-spf-50/p/101",
        price: "₹474",
      },
      { provider: PROVIDER_IDS.BRIGHTDATA, gl: "in" }
    );
    const creamSunscreen50g = normalizeProductItem(
      {
        title: "Minimalist Multi Vitamin SPF 50 Sunscreen Cream 50g",
        source: "Amazon.in",
        link: "https://www.amazon.in/dp/B09ABCDEFG",
        price: "₹399",
      },
      { provider: PROVIDER_IDS.SERPAPI, gl: "in" }
    );
    const formMismatch = scoreProductMatch(lightFluid50, creamSunscreen50g);
    assert.equal(formMismatch.canMerge, false);

    // Direct URL offer cannot be overwritten by a lower-priced Google-only offer from Bright Data
    const sameSkuNoDirectUrl = normalizeProductItem(
      {
        title: "Minimalist Light Fluid SPF 50 Sunscreen 50ml",
        shop: "Nykaa",
        link: "https://www.google.com/shopping/product/101",
        price: "₹450",
      },
      { provider: PROVIDER_IDS.BRIGHTDATA, gl: "in" }
    );
    const mergedGroups = deduplicateAndAggregateProducts([lightFluid50, sameSkuNoDirectUrl], {
      registerInServerCache: false,
    });
    assert.equal(mergedGroups.length, 1);
    assert.equal(
      mergedGroups[0].offersPreview[0].merchantProductUrl,
      "https://www.nykaa.com/minimalist-light-fluid-spf-50/p/101"
    );

    // 14e. Router failover to Bright Data executes at most 1 call when SerpApi/Serper/SearchApi are off
    resetQuotaState(PROVIDER_IDS.BRIGHTDATA, { clearMonthlyLedger: true });
    process.env.SERPAPI_ENABLED = "false";
    process.env.SERPER_ENABLED = "false";
    process.env.SEARCHAPI_ENABLED = "false";
    process.env.APIFY_ENABLED = "false"; // Explicitly disable Apify for this test
    process.env.BRIGHTDATA_ENABLED = "true";

    let routerBdCalls = 0;
    global.fetch = async () => {
      routerBdCalls += 1;
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            shopping: [
              {
                global_rank: 1,
                title: "Neutrogena Ultra Sheer Dry Touch Sunblock SPF 50+ 88ml",
                price: "₹650",
                link: "https://www.nykaa.com/neutrogena-ultra-sheer/p/222",
                shop: "Nykaa",
                thumbnail: "https://images-static.nykaa.com/neutrogena.jpg",
              },
            ],
          }),
      };
    };

    const failoverRes = await routeMultiProviderDiscovery({
      query: "sunscreen",
      gl: "in",
      hl: "en",
      start: 0,
    });
    assert.equal(routerBdCalls, 1);
    assert.deepEqual(failoverRes.providersQueried, [PROVIDER_IDS.BRIGHTDATA]);
    assert.deepEqual(failoverRes.successfulProviders, [PROVIDER_IDS.BRIGHTDATA]);
    assert.ok(failoverRes.products.length >= 1);
    assert.equal(
      getConfiguredProviders("in").some(
        (p) =>
          p.providerKey === PROVIDER_IDS.BRIGHTDATA &&
          p.id === "brightdata_serp_google_shopping"
      ),
      true
    );
  } finally {
    global.fetch = originalFetch;
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetQuotaState(PROVIDER_IDS.SERPAPI);
    resetQuotaState(PROVIDER_IDS.SERPER);
    resetQuotaState(PROVIDER_IDS.SEARCHAPI);
    resetQuotaState(PROVIDER_IDS.BRIGHTDATA, { clearMonthlyLedger: true });
    if (fs.existsSync(tempLedgerPath)) {
      fs.unlinkSync(tempLedgerPath);
    }
  }

  // 15. Credit optimization & Bright Data reliability regression tests (mocked only; zero live API calls)
  const { GET: discoverRouteGet } = await import("../app/api/discover/route.js");
  const { GET: compareRouteGet } = await import("../app/api/compare/route.js");
  const { invalidateSearchCache } = await import("../lib/search/searchCache.js");
  const { ERROR_TYPES } = await import("../lib/search/quotaManager.js");

  const savedEnv15 = {
    BRIGHTDATA_ENABLED: process.env.BRIGHTDATA_ENABLED,
    BRIGHTDATA_API_KEY: process.env.BRIGHTDATA_API_KEY,
    BRIGHTDATA_SERP_ZONE: process.env.BRIGHTDATA_SERP_ZONE,
    BRIGHTDATA_LEDGER_PATH: process.env.BRIGHTDATA_LEDGER_PATH,
    BRIGHTDATA_SHOPPING_MODE: process.env.BRIGHTDATA_SHOPPING_MODE,
    SERPAPI_ENABLED: process.env.SERPAPI_ENABLED,
    SERPAPI_KEY: process.env.SERPAPI_KEY,
    SERPER_ENABLED: process.env.SERPER_ENABLED,
    SERPER_API_KEY: process.env.SERPER_API_KEY,
    SEARCHAPI_ENABLED: process.env.SEARCHAPI_ENABLED,
    SEARCHAPI_API_KEY: process.env.SEARCHAPI_API_KEY,
    HASDATA_ENABLED: process.env.HASDATA_ENABLED,
  };
  const tempLedgerPath15 = path.join(os.tmpdir(), `luxeindex-bd15-test-${Date.now()}.json`);
  const uniqueCacheQuery = `minimalist spf 50 testcache ${Date.now()}`;
  const origFetch15 = global.fetch;

  try {
    process.env.BRIGHTDATA_LEDGER_PATH = tempLedgerPath15;
    process.env.BRIGHTDATA_API_KEY = "bd_test_secret_15";
    process.env.BRIGHTDATA_SERP_ZONE = "serp_api_test";
    process.env.BRIGHTDATA_ENABLED = "true";
    resetQuotaState(PROVIDER_IDS.BRIGHTDATA, { clearMonthlyLedger: true });

    // 15a. Bright Data HTTP 200 with x-brd CAPTCHA/502 headers -> CAPTCHA_BLOCKED (0 retries, 0 credits, circuit trips after 2)
    let captchaFetchCount = 0;
    global.fetch = async () => {
      captchaFetchCount += 1;
      return {
        ok: true,
        status: 200,
        headers: new Headers({
          "x-brd-status-code": "502",
          "x-brd-error": "redirect location was rejected",
          "x-brd-error-code": "captcha",
        }),
        text: async () => "",
      };
    };

    const bdCaptcha1 = await BrightDataProvider.searchProducts("sunscreen", {
      gl: "in",
      hl: "en",
      maxRetries: 2,
    });
    assert.equal(captchaFetchCount, 1, "CAPTCHA_BLOCKED must execute 0 retries even when maxRetries=2");
    assert.equal(bdCaptcha1.ok, false);
    assert.equal(bdCaptcha1.errorType, ERROR_TYPES.CAPTCHA_BLOCKED);
    assert.equal(bdCaptcha1.usageMetadata.creditsUsed, 0);
    assert.equal(getMonthlyCreditStatus(PROVIDER_IDS.BRIGHTDATA).creditsConsumed, 0);
    assert.equal(getQuotaDiagnostics()[PROVIDER_IDS.BRIGHTDATA].consecutiveCaptchaFailures, 1);
    assert.equal(canCallProvider(PROVIDER_IDS.BRIGHTDATA).allowed, true);

    const bdCaptcha2 = await BrightDataProvider.searchProducts("sunscreen", {
      gl: "in",
      hl: "en",
      maxRetries: 2,
    });
    assert.equal(captchaFetchCount, 2, "Second CAPTCHA_BLOCKED call must also execute 0 retries");
    assert.equal(bdCaptcha2.ok, false);
    assert.equal(bdCaptcha2.errorType, ERROR_TYPES.CAPTCHA_BLOCKED);
    assert.equal(getMonthlyCreditStatus(PROVIDER_IDS.BRIGHTDATA).creditsConsumed, 0);
    assert.equal(getQuotaDiagnostics()[PROVIDER_IDS.BRIGHTDATA].consecutiveCaptchaFailures, 2);
    const afterTwoCaptchas = canCallProvider(PROVIDER_IDS.BRIGHTDATA);
    assert.equal(afterTwoCaptchas.allowed, false, "2 consecutive CAPTCHA failures must trip circuit breaker");
    assert.equal(afterTwoCaptchas.reason, "circuit_open");

    // 15b. tbm=shop mode URL builder & mocked payload parsing alongside udm=28
    const tbmUrl = new URL(
      buildBrightDataShoppingUrl({ query: "sunscreen", gl: "in", hl: "en", mode: "tbm_shop" })
    );
    assert.equal(tbmUrl.searchParams.get("tbm"), "shop");
    assert.equal(tbmUrl.searchParams.get("udm"), null);
    assert.equal(tbmUrl.searchParams.get("brd_json"), "1");

    resetQuotaState(PROVIDER_IDS.BRIGHTDATA, { clearMonthlyLedger: true });
    let capturedTbmReqUrl = null;
    global.fetch = async (url, init = {}) => {
      const body = JSON.parse(init.body);
      capturedTbmReqUrl = body.url;
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        text: async () =>
          JSON.stringify({
            shopping_results: [
              {
                position: 1,
                title: "Neutrogena Ultra Sheer Dry Touch Sunblock SPF 50+ 88ml",
                price: "₹649",
                source: { name: "Nykaa" },
                link: "https://www.google.com/url?q=https%3A%2F%2Fwww.nykaa.com%2Fneutrogena-ultra-sheer%2Fp%2F55&sa=U",
                thumbnail: "https://images-static.nykaa.com/neutrogena-88ml.jpg",
                rating: 4.4,
                reviews: 310,
              },
            ],
          }),
      };
    };
    const bdTbmRes = await BrightDataProvider.searchProducts("Neutrogena sunscreen", {
      gl: "in",
      hl: "en",
      mode: "tbm_shop",
    });
    assert.ok(capturedTbmReqUrl && capturedTbmReqUrl.includes("tbm=shop"));
    assert.equal(bdTbmRes.ok, true);
    assert.equal(bdTbmRes.items.length, 1);
    assert.equal(bdTbmRes.items[0].merchant, "Nykaa");
    assert.equal(bdTbmRes.items[0].size, "88ml");

    // 15c. Bright Data stays disabled by default when BRIGHTDATA_ENABLED is unset or false
    delete process.env.BRIGHTDATA_ENABLED;
    assert.equal(canCallProvider(PROVIDER_IDS.BRIGHTDATA).allowed, false);
    assert.equal(canCallProvider(PROVIDER_IDS.BRIGHTDATA).reason, "disabled_by_env");

    // 15d. Outage-only Bright Data routing + sequential brand routing (SerpApi >= 4 brand hits skips Serper/SearchApi/BrightData)
    process.env.SERPAPI_ENABLED = "true";
    process.env.SERPAPI_KEY = "serpapi_test_secret_15";
    process.env.SERPER_ENABLED = "true";
    process.env.SERPER_API_KEY = "serper_test_secret_15";
    process.env.SEARCHAPI_ENABLED = "true";
    process.env.SEARCHAPI_API_KEY = "searchapi_test_secret_15";
    process.env.BRIGHTDATA_ENABLED = "true";
    process.env.HASDATA_ENABLED = "false";
    resetQuotaState(PROVIDER_IDS.SERPAPI);
    resetQuotaState(PROVIDER_IDS.SERPER);
    resetQuotaState(PROVIDER_IDS.SEARCHAPI);
    resetQuotaState(PROVIDER_IDS.BRIGHTDATA, { clearMonthlyLedger: true });

    const makeMockJsonResponse = (payload) => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    });

    const calledUrlsBrandHealthy = [];
    global.fetch = async (url) => {
      calledUrlsBrandHealthy.push(String(url));
      return makeMockJsonResponse({
        shopping_results: [
          {
            title: "Minimalist Light Fluid SPF 50 Sunscreen 50ml",
            source: "Nykaa",
            price: "₹474",
            extracted_price: 474,
            link: "https://www.nykaa.com/minimalist-light-fluid/p/1",
            thumbnail: "https://images-static.nykaa.com/m1.jpg",
            product_id: "gp_1",
          },
          {
            title: "Minimalist Multi Vitamin SPF 50 Sunscreen 50g",
            source: "Amazon.in",
            price: "₹399",
            extracted_price: 399,
            link: "https://www.amazon.in/dp/B0MINIMALIST2",
            thumbnail: "https://m.media-amazon.com/images/m2.jpg",
            product_id: "gp_2",
          },
          {
            title: "Minimalist Invisible SPF 50 Sunscreen Gel 50g",
            source: "Flipkart",
            price: "₹569",
            extracted_price: 569,
            link: "https://www.flipkart.com/minimalist-invisible/p/3",
            thumbnail: "https://rukminim2.flixcart.com/m3.jpg",
            product_id: "gp_3",
          },
          {
            title: "Minimalist Fluid Sunscreen SPF 50 30ml",
            source: "Tira Beauty",
            price: "₹299",
            extracted_price: 299,
            link: "https://www.tirabeauty.com/product/m4",
            thumbnail: "https://cdn.tirabeauty.com/m4.jpg",
            product_id: "gp_4",
          },
          {
            title: "Minimalist Fluid Sunscreen SPF 50 100ml",
            source: "Purplle",
            price: "₹849",
            extracted_price: 849,
            link: "https://www.purplle.com/product/m5",
            thumbnail: "https://media6.ppl-media.com/m5.jpg",
            product_id: "gp_5",
          },
          {
            title: "Minimalist Niacinamide Sunscreen SPF 50 50g",
            source: "Myntra",
            price: "₹429",
            extracted_price: 429,
            link: "https://www.myntra.com/minimalist-sunscreen/6",
            thumbnail: "https://assets.myntassets.com/m6.jpg",
            product_id: "gp_6",
          },
        ],
      });
    };
    const brandRouteRes = await routeMultiProviderDiscovery({
      query: "Minimalist SPF 50 sunscreen",
      gl: "in",
      hl: "en",
      start: 0,
    });
    assert.deepEqual(
      brandRouteRes.providersQueried,
      ["serpapi"],
      "Healthy SerpApi brand coverage (>=4 brand matches, >=6 domestic) must skip Serper, SearchApi, and Bright Data"
    );
    assert.equal(
      calledUrlsBrandHealthy.some((u) => u.includes("brightdata.com")),
      false,
      "Bright Data must never be called when SerpApi succeeded"
    );

    // Sparse SerpApi (< 4 brand matches) escalates sequentially to Serper, still skipping Bright Data
    const calledUrlsSparse = [];
    global.fetch = async (url) => {
      const sUrl = String(url);
      calledUrlsSparse.push(sUrl);
      if (sUrl.includes("serpapi.com")) {
        return makeMockJsonResponse({
          shopping_results: [
            {
              title: "Minimalist Light Fluid SPF 50 Sunscreen 50ml",
              source: "Nykaa",
              price: "₹474",
              extracted_price: 474,
              link: "https://www.nykaa.com/minimalist-light-fluid/p/1",
              thumbnail: "https://images-static.nykaa.com/m1.jpg",
              product_id: "gp_sparse_1",
            },
          ],
        });
      }
      if (sUrl.includes("serper.dev")) {
        return makeMockJsonResponse({
          shopping: [
            {
              title: "Minimalist Multi Vitamin SPF 50 Sunscreen 50g",
              source: "Amazon.in",
              price: "₹399",
              link: "https://www.amazon.in/dp/B0MINIMALIST2",
              imageUrl: "https://m.media-amazon.com/images/m2.jpg",
              productId: "sp_2",
            },
            {
              title: "Minimalist Invisible SPF 50 Sunscreen Gel 50g",
              source: "Flipkart",
              price: "₹569",
              link: "https://www.flipkart.com/minimalist-invisible/p/3",
              imageUrl: "https://rukminim2.flixcart.com/m3.jpg",
              productId: "sp_3",
            },
            {
              title: "Minimalist Fluid Sunscreen SPF 50 30ml",
              source: "Tira Beauty",
              price: "₹299",
              link: "https://www.tirabeauty.com/product/m4",
              imageUrl: "https://cdn.tirabeauty.com/m4.jpg",
              productId: "sp_4",
            },
            {
              title: "Minimalist Fluid Sunscreen SPF 50 100ml",
              source: "Purplle",
              price: "₹849",
              link: "https://www.purplle.com/product/m5",
              imageUrl: "https://media6.ppl-media.com/m5.jpg",
              productId: "sp_5",
            },
            {
              title: "Minimalist Niacinamide Sunscreen SPF 50 50g",
              source: "Myntra",
              price: "₹429",
              link: "https://www.myntra.com/minimalist-sunscreen/6",
              imageUrl: "https://assets.myntassets.com/m6.jpg",
              productId: "sp_6",
            },
          ],
        });
      }
      throw new Error(`Unexpected provider URL in sparse brand test: ${sUrl}`);
    };
    const sparseBrandRes = await routeMultiProviderDiscovery({
      query: "Minimalist SPF 50 sunscreen",
      gl: "in",
      hl: "en",
      start: 0,
    });
    assert.deepEqual(sparseBrandRes.providersQueried, ["serpapi", "serper"]);
    assert.equal(calledUrlsSparse.some((u) => u.includes("brightdata.com")), false);

    // 15e. Discovery cache shares INR/USD under marketBaseCurrency without mutating cached base prices
    process.env.SERPER_ENABLED = "false";
    process.env.SEARCHAPI_ENABLED = "false";
    process.env.BRIGHTDATA_ENABLED = "false";
    let discoverProviderCalls = 0;
    global.fetch = async (url) => {
      if (String(url).includes("serpapi.com")) {
        discoverProviderCalls += 1;
        return makeMockJsonResponse({
          shopping_results: [
            {
              title: "Minimalist Light Fluid SPF 50 Sunscreen 50ml",
              source: "Nykaa",
              price: "₹499",
              extracted_price: 499,
              link: "https://www.nykaa.com/minimalist-light-fluid/p/1",
              thumbnail: "https://images-static.nykaa.com/m1.jpg",
              product_id: "gp_cache_1",
            },
          ],
        });
      }
      throw new Error(`Unexpected fetch during discovery currency cache test: ${url}`);
    };

    const resInr1 = await discoverRouteGet(
      new Request(
        `http://localhost/api/discover?q=${encodeURIComponent(uniqueCacheQuery)}&gl=in&currency=INR`
      )
    );
    const jsonInr1 = await resInr1.json();
    assert.equal(resInr1.status, 200);
    assert.equal(jsonInr1.cacheStatus, "MISS");
    assert.equal(discoverProviderCalls, 1);
    assert.equal(jsonInr1.market.currency, "INR");
    assert.equal(jsonInr1.products[0].lowestPrice, 499);

    const resUsd = await discoverRouteGet(
      new Request(
        `http://localhost/api/discover?q=${encodeURIComponent(uniqueCacheQuery)}&gl=in&currency=USD`
      )
    );
    const jsonUsd = await resUsd.json();
    assert.equal(resUsd.status, 200);
    assert.equal(jsonUsd.cacheStatus, "HIT");
    assert.equal(discoverProviderCalls, 1, "USD toggle on cached INR query must make 0 provider calls");
    assert.equal(jsonUsd.market.currency, "USD");
    assert.equal(jsonUsd.products[0].currency, "USD");
    assert.ok(jsonUsd.products[0].lowestPrice > 0 && jsonUsd.products[0].lowestPrice < 20);
    assert.ok(jsonUsd.facets.priceRange.max > 0 && jsonUsd.facets.priceRange.max < 20);

    const resInr2 = await discoverRouteGet(
      new Request(
        `http://localhost/api/discover?q=${encodeURIComponent(uniqueCacheQuery)}&gl=in&currency=INR`
      )
    );
    const jsonInr2 = await resInr2.json();
    assert.equal(jsonInr2.cacheStatus, "HIT");
    assert.equal(discoverProviderCalls, 1);
    assert.equal(jsonInr2.products[0].currency, "INR");
    assert.equal(
      jsonInr2.products[0].lowestPrice,
      499,
      "Cached INR base prices must not be mutated after serving USD conversion"
    );

    // 15f. Compare optimization: 1 exact verified offer skips full google_shopping fallback; 0 exact offers does NOT promote unverifiedOffers
    __resetDiscoveryRamOnlyForTest();
    process.env.SERPAPI_ENABLED = "true";
    process.env.SERPAPI_KEY = "serpapi_test_secret_15";
    resetQuotaState(PROVIDER_IDS.SERPAPI);

    const ts15 = Date.now();
    const regExactId = `minimalist__light-fluid-spf-50-test15a-${ts15}__50ml`;
    registerDiscoveredProduct(regExactId, {
      id: regExactId,
      name: "Minimalist Light Fluid SPF 50 Sunscreen 50ml",
      brand: "Minimalist",
      volume: "50ml",
      spf: "SPF 50",
      formulation: "light-fluid",
      gl: "in",
      currency: "INR",
      immersivePageTokens: ["imm_tok_exact_15"],
      dataSource: "live",
    });

    const compareExactUrls = [];
    global.fetch = async (url) => {
      const sUrl = String(url);
      compareExactUrls.push(sUrl);
      if (sUrl.includes("google_immersive_product")) {
        return makeMockJsonResponse({
          product_results: {
            title: "Minimalist Light Fluid SPF 50 Sunscreen 50ml",
            stores: [
              {
                name: "Nykaa",
                title: "Minimalist Light Fluid SPF 50 Sunscreen 50ml",
                price: "₹474",
                extracted_price: 474,
                link: "https://www.nykaa.com/minimalist-light-fluid-spf-50/p/101",
              },
              {
                name: "Flipkart",
                title: "Minimalist Sunscreen SPF 50",
                price: "₹450",
                extracted_price: 450,
                link: "https://www.flipkart.com/minimalist-sunscreen/p/202",
              },
            ],
          },
        });
      }
      throw new Error(`Full google_shopping fallback should not run when offers.length >= 1: ${sUrl}`);
    };

    const compareRes1 = await compareRouteGet(
      new Request(
        `http://localhost/api/compare?productId=${encodeURIComponent(
          regExactId
        )}&q=${encodeURIComponent("Minimalist Light Fluid SPF 50 Sunscreen 50ml")}&gl=in`
      )
    );
    const compareJson1 = await compareRes1.json();
    assert.equal(compareRes1.status, 200);
    assert.equal(compareJson1.offers.length, 1);
    assert.equal(compareJson1.unverifiedOffers.length, 1);
    assert.equal(
      compareExactUrls.some((u) => u.includes("google_shopping")),
      false,
      "Compare must skip full SerpApi google_shopping fallback when >= 1 exact verified offer is already found"
    );

    const regUnverifiedOnlyId = `minimalist__light-fluid-spf-50-test15b-${ts15}__50ml`;
    registerDiscoveredProduct(regUnverifiedOnlyId, {
      id: regUnverifiedOnlyId,
      name: "Minimalist Light Fluid SPF 50 Sunscreen 50ml",
      brand: "Minimalist",
      volume: "50ml",
      spf: "SPF 50",
      formulation: "light-fluid",
      gl: "in",
      currency: "INR",
      immersivePageTokens: ["imm_tok_unverified_15"],
      dataSource: "live",
    });

    let shoppingFallbackCalls = 0;
    global.fetch = async (url) => {
      const sUrl = String(url);
      if (sUrl.includes("google_immersive_product")) {
        return makeMockJsonResponse({
          product_results: {
            title: "Minimalist Light Fluid SPF 50 Sunscreen 50ml",
            stores: [
              {
                name: "Flipkart",
                title: "Minimalist Sunscreen SPF 50",
                price: "₹450",
                extracted_price: 450,
                link: "https://www.flipkart.com/minimalist-sunscreen/p/202",
              },
            ],
          },
        });
      }
      if (sUrl.includes("google_shopping")) {
        shoppingFallbackCalls += 1;
        return makeMockJsonResponse({ shopping_results: [] });
      }
      return makeMockJsonResponse({});
    };

    const compareRes2 = await compareRouteGet(
      new Request(
        `http://localhost/api/compare?productId=${encodeURIComponent(
          regUnverifiedOnlyId
        )}&q=${encodeURIComponent("Minimalist Light Fluid SPF 50 Sunscreen 50ml")}&gl=in`
      )
    );
    const compareJson2 = await compareRes2.json();
    assert.equal(compareRes2.status, 200);
    assert.equal(
      compareJson2.offers.length,
      0,
      "Unverified offers must never be promoted into exact verified offers"
    );
    assert.ok(compareJson2.unverifiedOffers.length >= 1);
    assert.ok(
      shoppingFallbackCalls >= 1,
      "When offers.length === 0 (unverified-only), SerpApi search fallback must still trigger"
    );
  } finally {
    global.fetch = origFetch15;
    __resetDiscoveryRamOnlyForTest();
    invalidateSearchCache({
      prefix: buildSearchCacheKey("discover_v2", {
        q: uniqueCacheQuery,
        gl: "in",
        hl: "en",
        start: 0,
      }),
    });
    for (const [k, v] of Object.entries(savedEnv15)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetQuotaState(PROVIDER_IDS.SERPAPI);
    resetQuotaState(PROVIDER_IDS.SERPER);
    resetQuotaState(PROVIDER_IDS.SEARCHAPI);
    resetQuotaState(PROVIDER_IDS.BRIGHTDATA, { clearMonthlyLedger: true });
    if (fs.existsSync(tempLedgerPath15)) {
      fs.unlinkSync(tempLedgerPath15);
    }
  }

  // 16. Apify Google Shopping (cheapapi~google-shopping-scraper) mocked unit, budget, concurrency & router tests
  const {
    ApifyProvider,
    buildApifyActorInput,
  } = await import("../lib/providers/apifyProvider.js");
  const {
    getApifyMonthlyBudgetStatus,
  } = await import("../lib/search/quotaManager.js");

  const savedEnv16 = {
    APIFY_ENABLED: process.env.APIFY_ENABLED,
    APIFY_API_TOKEN: process.env.APIFY_API_TOKEN,
    APIFY_MAX_PRODUCTS_PER_SEARCH: process.env.APIFY_MAX_PRODUCTS_PER_SEARCH,
    APIFY_MAX_PAGES: process.env.APIFY_MAX_PAGES,
    APIFY_TIMEOUT_MS: process.env.APIFY_TIMEOUT_MS,
    APIFY_MAX_CONCURRENT_RUNS: process.env.APIFY_MAX_CONCURRENT_RUNS,
    APIFY_MONTHLY_BUDGET_USD: process.env.APIFY_MONTHLY_BUDGET_USD,
    APIFY_LEDGER_PATH: process.env.APIFY_LEDGER_PATH,
    SERPAPI_ENABLED: process.env.SERPAPI_ENABLED,
    SERPAPI_KEY: process.env.SERPAPI_KEY,
    SERPER_ENABLED: process.env.SERPER_ENABLED,
    SERPER_API_KEY: process.env.SERPER_API_KEY,
    SEARCHAPI_ENABLED: process.env.SEARCHAPI_ENABLED,
    SEARCHAPI_API_KEY: process.env.SEARCHAPI_API_KEY,
    BRIGHTDATA_ENABLED: process.env.BRIGHTDATA_ENABLED,
  };
  const tempApifyLedger16 = path.join(os.tmpdir(), `luxeindex-apify16-test-${Date.now()}.json`);
  const apifyCacheQuery16 = `minimalist spf 50 apifycache ${Date.now()}`;
  const origFetch16 = global.fetch;
  let apifySubtestsPassed = 0;

  try {
    const makeMockJsonResponse = (payload) => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    });

    process.env.APIFY_LEDGER_PATH = tempApifyLedger16;
    resetQuotaState(PROVIDER_IDS.APIFY, { clearMonthlyLedger: true });

    // Test 1: Provider disabled by default
    delete process.env.APIFY_ENABLED;
    process.env.APIFY_API_TOKEN = "apify_test_secret_token_987654";
    assert.equal(canCallProvider(PROVIDER_IDS.APIFY).allowed, false);
    assert.equal(canCallProvider(PROVIDER_IDS.APIFY).reason, "disabled_by_env");
    process.env.APIFY_ENABLED = "false";
    assert.equal(canCallProvider(PROVIDER_IDS.APIFY).allowed, false);
    assert.equal(canCallProvider(PROVIDER_IDS.APIFY).reason, "disabled_by_env");
    apifySubtestsPassed += 1;

    // Test 2: Missing token prevents activation even when APIFY_ENABLED=true
    process.env.APIFY_ENABLED = "true";
    delete process.env.APIFY_API_TOKEN;
    assert.equal(canCallProvider(PROVIDER_IDS.APIFY).allowed, false);
    assert.equal(canCallProvider(PROVIDER_IDS.APIFY).reason, "missing_api_key");
    process.env.APIFY_API_TOKEN = "   ";
    assert.equal(canCallProvider(PROVIDER_IDS.APIFY).allowed, false);
    assert.equal(canCallProvider(PROVIDER_IDS.APIFY).reason, "missing_api_key");
    apifySubtestsPassed += 1;

    // Test 3: Bearer auth without token leakage in URL, errors, or diagnostics
    process.env.APIFY_API_TOKEN = "apify_test_secret_token_987654";
    process.env.APIFY_MONTHLY_BUDGET_USD = "0.20";
    process.env.APIFY_MAX_PRODUCTS_PER_SEARCH = "5";
    process.env.APIFY_MAX_PAGES = "1";
    process.env.APIFY_TIMEOUT_MS = "120000";
    process.env.APIFY_MAX_CONCURRENT_RUNS = "1";
    resetQuotaState(PROVIDER_IDS.APIFY, { clearMonthlyLedger: true });

    assert.equal(
      redactSecrets(`Bearer ${process.env.APIFY_API_TOKEN} token=${process.env.APIFY_API_TOKEN}`).includes(
        process.env.APIFY_API_TOKEN
      ),
      false
    );
    let capturedAuthHeader = null;
    let capturedApifyReqUrl = null;
    let capturedApifyReqBody = null;
    global.fetch = async (url, init = {}) => {
      capturedApifyReqUrl = String(url);
      capturedAuthHeader = init?.headers?.Authorization || init?.headers?.authorization || null;
      capturedApifyReqBody = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        text: async () =>
          JSON.stringify([
            {
              rowType: "product",
              title: "Minimalist Light Fluid SPF 50 Sunscreen 50ml",
              price: "₹474",
              oldPrice: "₹499",
              currency: "INR",
              seller: "Nykaa",
              rating: 4.5,
              reviewsCount: 410,
              delivery: "Free delivery",
              productId: "ap_1",
              gid: "gid_1",
              googleShoppingUrl: "https://www.google.com/shopping/product/111?gl=in",
              url: "https://www.google.com/url?q=https%3A%2F%2Fwww.nykaa.com%2Fminimalist-light-fluid%2Fp%2F1&sa=U",
              image: "https://images-static.nykaa.com/light-fluid.jpg",
              isSponsored: false,
              resultType: "organic",
              searchTerm: "Minimalist SPF 50 sunscreen",
              country: "IN",
              scrapedAt: "2026-11-12T10:00:00.000Z",
            },
          ]),
      };
    };
    const authRes = await ApifyProvider.searchProducts("Minimalist SPF 50 sunscreen", {
      gl: "in",
      hl: "en",
    });
    assert.equal(authRes.ok, true);
    assert.equal(capturedAuthHeader, `Bearer ${process.env.APIFY_API_TOKEN}`);
    assert.equal(capturedApifyReqUrl.includes(process.env.APIFY_API_TOKEN), false);
    assert.ok(capturedApifyReqUrl.includes("timeout=120"));
    assert.ok(capturedApifyReqUrl.includes("maxTotalChargeUsd="));
    assert.equal(JSON.stringify(ApifyProvider.getProviderStatus()).includes(process.env.APIFY_API_TOKEN), false);
    apifySubtestsPassed += 1;

    // Test 4 & 5: Correct India country/language & conservative search input + env product limits
    assert.equal(capturedApifyReqBody.mode, "search");
    assert.deepEqual(capturedApifyReqBody.searchTerms, ["Minimalist SPF 50 sunscreen"]);
    assert.equal(capturedApifyReqBody.country, "IN");
    assert.equal(capturedApifyReqBody.language, "en");
    assert.equal(capturedApifyReqBody.maxProductsPerSearch, 5);
    assert.equal(capturedApifyReqBody.maxPages, 1);
    assert.equal(capturedApifyReqBody.sortBy, "relevance");
    assert.equal(capturedApifyReqBody.offersForTopProducts, 0);
    assert.equal(capturedApifyReqBody.includeSponsored, false);
    assert.equal(capturedApifyReqBody.includeCarousels, false);
    assert.equal(capturedApifyReqBody.monitorPrices, false);
    // Verify env overrides respect cap and never auto-increase pages
    const customInput = buildApifyActorInput({
      query: "sunscreen",
      gl: "in",
      hl: "en",
      maxProductsPerSearch: "3",
      maxPages: "5",
    });
    assert.equal(customInput.maxProductsPerSearch, 3);
    assert.equal(customInput.maxPages, 1);
    apifySubtestsPassed += 2;

    // Tests 6, 7, 8, 9, 10: Row filtering, URLs, price/currency rejection, images
    const mixedNormalized = ApifyProvider.normalizeResults(
      [
        // Ignored rowTypes
        { rowType: "offer", title: "Minimalist Light Fluid SPF 50 Sunscreen 50ml", price: "₹450", currency: "INR", seller: "Nykaa", url: "https://www.nykaa.com/p/1" },
        { rowType: "productDetails", title: "Minimalist Light Fluid SPF 50 Sunscreen 50ml", price: "₹474", currency: "INR", seller: "Minimalist" },
        // Valid product with null url + Google Shopping URL only -> merchantProductUrl MUST be null
        {
          rowType: "product",
          title: "Minimalist Light Fluid SPF 50 Sunscreen 50ml",
          price: 499,
          currency: "INR",
          seller: "Amazon.in",
          url: null,
          googleShoppingUrl: "https://www.google.com/shopping/product/222?gl=in",
          image: "https://m.media-amazon.com/images/valid.jpg",
        },
        // Valid product whose url is a Google Shopping / redirect link -> MUST NOT become merchantProductUrl
        {
          rowType: "product",
          title: "Minimalist Multi Vitamin SPF 50 Sunscreen 50g",
          price: "₹399",
          currency: "INR",
          seller: "Flipkart",
          url: "https://www.google.com/search?ibp=oshop&q=minimalist",
          googleShoppingUrl: "https://www.google.com/shopping/product/333?gl=in",
          image: "data:image/png;base64,iVBORw0KGgo=", // invalid data URI -> rejected as null
        },
        // Invalid image schemes rejected cleanly
        {
          rowType: "product",
          title: "Minimalist Invisible SPF 40 Sunscreen 50g",
          price: "₹569",
          currency: "INR",
          seller: "Tira Beauty",
          url: null,
          googleShoppingUrl: "https://www.google.com/shopping/product/444?gl=in",
          image: "javascript:alert(1)",
        },
        // USD currency converts cleanly via convertCurrency (not treated as INR 10)
        {
          rowType: "product",
          title: "Neutrogena Ultra Sheer Dry Touch SPF 50 Sunscreen 88ml",
          price: 10,
          currency: "USD",
          seller: "Sephora",
          url: null,
          googleShoppingUrl: "https://www.google.com/shopping/product/555?gl=in",
          image: "https://cdn.example.com/neutrogena.jpg",
        },
        // Invalid prices & invalid/unsupported currencies rejected safely
        { rowType: "product", title: "Minimalist Bad Negative Price 50ml", price: -200, currency: "INR", seller: "Nykaa" },
        { rowType: "product", title: "Minimalist Zero Price 50ml", price: 0, currency: "INR", seller: "Nykaa" },
        { rowType: "product", title: "Minimalist Non Numeric 50ml", price: "Unavailable", currency: "INR", seller: "Nykaa" },
        { rowType: "product", title: "Minimalist Unsupported EUR 50ml", price: 15, currency: "EUR", seller: "Nykaa" },
        { rowType: "product", title: "Minimalist Bad Currency Code 50ml", price: 499, currency: "BAD_CURR", seller: "Nykaa" },
        { rowType: "product", title: "Minimalist Contradictory Symbol 50ml", price: "$12.00", currency: "INR", seller: "Nykaa" },
      ],
      { query: "sunscreen", gl: "in" }
    );
    assert.equal(mixedNormalized.length, 4, "Only the 4 valid product rows should survive (ignoring offer/productDetails/bad prices/bad currencies)");
    assert.equal(mixedNormalized[0].merchantProductUrl, null);
    assert.equal(mixedNormalized[0].shoppingUrl, "https://www.google.com/shopping/product/222?gl=in");
    assert.equal(mixedNormalized[0].imageUrl, "https://m.media-amazon.com/images/valid.jpg");
    assert.equal(mixedNormalized[1].merchantProductUrl, null, "Google Shopping URL must never be mistaken for retailer URL");
    assert.equal(mixedNormalized[1].shoppingUrl, "https://www.google.com/shopping/product/333?gl=in");
    assert.equal(mixedNormalized[1].imageUrl, null, "data:image must be rejected");
    assert.equal(mixedNormalized[2].imageUrl, null, "javascript: image URI must be rejected");
    assert.equal(mixedNormalized[3].currency, "INR");
    assert.equal(mixedNormalized[3].price, 845, "$10 USD must convert to INR 845, never interpreted as ₹10");
    assert.equal(mixedNormalized[3].originalCurrency, "USD");
    assert.equal(mixedNormalized[3].originalPrice, 10);
    apifySubtestsPassed += 5;

    // Tests 11 & 12: Exact variant separation & duplicate product removal across Apify rows
    const variantAndDupItems = ApifyProvider.normalizeResults(
      [
        {
          rowType: "product",
          title: "Minimalist Light Fluid SPF 50 Sunscreen 50ml",
          price: "₹474",
          currency: "INR",
          seller: "Nykaa",
          googleShoppingUrl: "https://www.google.com/shopping/product/v1",
          image: "https://images-static.nykaa.com/lf50.jpg",
        },
        // Exact duplicate within Apify -> collapsed
        {
          rowType: "product",
          title: "Minimalist Light Fluid SPF 50 Sunscreen 50ml",
          price: "₹474",
          currency: "INR",
          seller: "Nykaa",
          googleShoppingUrl: "https://www.google.com/shopping/product/v1",
          image: "https://images-static.nykaa.com/lf50.jpg",
        },
        // Different formulation & size (30g) -> must remain separate
        {
          rowType: "product",
          title: "Minimalist Multi Vitamin SPF 50 Sunscreen Cream 30g",
          price: "₹299",
          currency: "INR",
          seller: "Flipkart",
          googleShoppingUrl: "https://www.google.com/shopping/product/v2",
          image: "https://rukminim2.flixcart.com/mv30.jpg",
        },
        // Different SPF rating (SPF 30 50ml) -> must remain separate
        {
          rowType: "product",
          title: "Minimalist Light Fluid SPF 30 Sunscreen 50ml",
          price: "₹399",
          currency: "INR",
          seller: "Myntra",
          googleShoppingUrl: "https://www.google.com/shopping/product/v3",
          image: "https://assets.myntassets.com/lf30.jpg",
        },
      ],
      { query: "Minimalist sunscreen", gl: "in" }
    );
    const dedupedVariants = deduplicateAndAggregateProducts(variantAndDupItems, {
      registerInServerCache: false,
    });
    assert.equal(dedupedVariants.length, 3, "Duplicate collapsed to 3 distinct variants (50ml SPF50 vs 30g SPF50 vs 50ml SPF30)");
    assert.equal(scoreProductMatch(variantAndDupItems[0], variantAndDupItems[2]).canMerge, false);
    assert.equal(scoreProductMatch(variantAndDupItems[0], variantAndDupItems[3]).canMerge, false);
    apifySubtestsPassed += 2;

    // Test 13 & Router rules: Cache hits prevent Actor calls; INR/USD toggle reuses cache; SerpApi coverage skips Apify
    resetQuotaState(PROVIDER_IDS.APIFY, { clearMonthlyLedger: true });
    process.env.SERPAPI_ENABLED = "false";
    process.env.SERPER_ENABLED = "false";
    process.env.SEARCHAPI_ENABLED = "false";
    process.env.BRIGHTDATA_ENABLED = "false";
    process.env.APIFY_ENABLED = "true";

    let apifyCacheTestCalls = 0;
    global.fetch = async (url) => {
      if (String(url).includes("apify.com")) {
        apifyCacheTestCalls += 1;
        return makeMockJsonResponse([
          {
            rowType: "product",
            title: "Minimalist Light Fluid SPF 50 Sunscreen 50ml",
            price: "₹499",
            currency: "INR",
            seller: "Nykaa",
            url: null,
            googleShoppingUrl: "https://www.google.com/shopping/product/c1",
            image: "https://images-static.nykaa.com/c1.jpg",
          },
        ]);
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    };
    const apifyDisc1 = await discoverRouteGet(
      new Request(
        `http://localhost/api/discover?q=${encodeURIComponent(apifyCacheQuery16)}&gl=in&currency=INR`
      )
    );
    const apifyDisc1Json = await apifyDisc1.json();
    assert.equal(apifyDisc1Json.cacheStatus, "MISS");
    assert.deepEqual(apifyDisc1Json.providersQueried, ["apify"]);
    assert.equal(apifyCacheTestCalls, 1);

    const apifyDiscRepeat = await discoverRouteGet(
      new Request(
        `http://localhost/api/discover?q=${encodeURIComponent(apifyCacheQuery16)}&gl=in&currency=INR`
      )
    );
    assert.equal((await apifyDiscRepeat.json()).cacheStatus, "HIT");
    const apifyDiscUsd = await discoverRouteGet(
      new Request(
        `http://localhost/api/discover?q=${encodeURIComponent(apifyCacheQuery16)}&gl=in&currency=USD`
      )
    );
    const apifyDiscUsdJson = await apifyDiscUsd.json();
    assert.equal(apifyDiscUsdJson.cacheStatus, "HIT");
    assert.equal(apifyDiscUsdJson.market.currency, "USD");
    assert.equal(apifyCacheTestCalls, 1, "Repeat INR and USD cache hits must trigger 0 extra Apify calls");
    apifySubtestsPassed += 1;

    // Test 14: Identical concurrent queries are coalesced (1 Actor call)
    resetQuotaState(PROVIDER_IDS.APIFY, { clearMonthlyLedger: true });
    let coalesceFetchCalls = 0;
    global.fetch = async () => {
      coalesceFetchCalls += 1;
      await new Promise((r) => setTimeout(r, 35));
      return makeMockJsonResponse([
        {
          rowType: "product",
          title: "Minimalist Light Fluid SPF 50 Sunscreen 50ml",
          price: "₹474",
          currency: "INR",
          seller: "Nykaa",
          googleShoppingUrl: "https://www.google.com/shopping/product/coal1",
        },
      ]);
    };
    const [coalA, coalB] = await Promise.all([
      ApifyProvider.searchProducts("Minimalist SPF 50 sunscreen", { gl: "in", hl: "en" }),
      ApifyProvider.searchProducts("minimalist spf 50 sunscreen", { gl: "in", hl: "en" }),
    ]);
    assert.equal(coalesceFetchCalls, 1, "Identical normalized concurrent queries must coalesce to 1 Actor call");
    assert.equal(coalA.ok, true);
    assert.equal(coalB.ok, true);
    apifySubtestsPassed += 1;

    // Test 15: Maximum 1 concurrent Actor run across distinct queries
    resetQuotaState(PROVIDER_IDS.APIFY, { clearMonthlyLedger: true });
    let distinctConcurrentCalls = 0;
    global.fetch = async () => {
      distinctConcurrentCalls += 1;
      await new Promise((r) => setTimeout(r, 40));
      return makeMockJsonResponse([
        {
          rowType: "product",
          title: "Minimalist SPF 50 Sunscreen 50g",
          price: "₹359",
          currency: "INR",
          seller: "Nykaa",
          googleShoppingUrl: "https://www.google.com/shopping/product/conc1",
        },
      ]);
    };
    const [conc1, conc2] = await Promise.all([
      ApifyProvider.searchProducts("Minimalist SPF 50 sunscreen", { gl: "in", hl: "en" }),
      ApifyProvider.searchProducts("Neutrogena sunscreen", { gl: "in", hl: "en" }),
    ]);
    assert.equal(distinctConcurrentCalls, 1, "Concurrent limit=1 must only allow 1 Actor run in flight");
    assert.equal(conc1.ok, true);
    assert.equal(conc2.ok, false);
    assert.equal(conc2.skipped, true);
    assert.equal(conc2.gateReason, "max_concurrent_runs_reached");
    apifySubtestsPassed += 1;

    // Test 16: Monthly budget blocks additional calls & reserves $0.05 safety margin
    process.env.APIFY_MONTHLY_BUDGET_USD = "0.20";
    resetQuotaState(PROVIDER_IDS.APIFY, { clearMonthlyLedger: true });
    assert.equal(getApifyMonthlyBudgetStatus().monthlyBudgetUsd, 0.2);
    assert.equal(getApifyMonthlyBudgetStatus().safetyReserveUsd, 0.05);

    process.env.APIFY_MONTHLY_BUDGET_USD = "0.015";
    resetQuotaState(PROVIDER_IDS.APIFY, { clearMonthlyLedger: true });
    let budgetFetchCount = 0;
    global.fetch = async () => {
      budgetFetchCount += 1;
      return makeMockJsonResponse([
        { rowType: "product", title: "Minimalist SPF 50 50ml", price: "₹474", currency: "INR", seller: "Nykaa" },
        { rowType: "product", title: "Minimalist SPF 50 100g", price: "₹664", currency: "INR", seller: "Amazon.in" },
        { rowType: "product", title: "Minimalist SPF 50 50g", price: "₹359", currency: "INR", seller: "Flipkart" },
        { rowType: "product", title: "Minimalist SPF 50 Gel 50g", price: "₹449", currency: "INR", seller: "Myntra" },
        { rowType: "product", title: "Minimalist SPF 50 Stick 20g", price: "₹699", currency: "INR", seller: "Purplle" },
      ]);
    };
    const budgetRun1 = await ApifyProvider.searchProducts("Minimalist SPF 50 sunscreen", { gl: "in" });
    assert.equal(budgetRun1.ok, true);
    assert.equal(budgetFetchCount, 1);
    assert.equal(getApifyMonthlyBudgetStatus().estimatedMonthlySpendUsd, 0.015);
    assert.equal(getApifyMonthlyBudgetStatus().budgetExhausted, true);

    const budgetRun2 = await ApifyProvider.searchProducts("Neutrogena sunscreen", { gl: "in" });
    assert.equal(budgetFetchCount, 1, "Exhausted budget must block dispatching additional Actor runs");
    assert.equal(budgetRun2.ok, false);
    assert.equal(budgetRun2.skipped, true);
    assert.equal(budgetRun2.gateReason, "monthly_budget_exhausted");
    assert.ok(getQuotaDiagnostics()[PROVIDER_IDS.APIFY].budgetBlockedRequests >= 1);
    apifySubtestsPassed += 1;

    // Tests 17 & 18: 401/403, 429, 408, 5xx handled safely with ZERO automatic retries
    process.env.APIFY_MONTHLY_BUDGET_USD = "0.20";
    for (const [status, expectedErrType] of [
      [401, ERROR_TYPES.AUTH_ERROR],
      [429, ERROR_TYPES.RATE_LIMITED],
      [408, ERROR_TYPES.TIMEOUT],
      [500, ERROR_TYPES.PROVIDER_UNAVAILABLE],
    ]) {
      resetQuotaState(PROVIDER_IDS.APIFY, { clearMonthlyLedger: true });
      let statusFetchCount = 0;
      global.fetch = async () => {
        statusFetchCount += 1;
        return {
          ok: false,
          status,
          headers: new Headers({ "content-type": "application/json" }),
          text: async () =>
            JSON.stringify({
              error: {
                message: `Apify status ${status} with ${process.env.APIFY_API_TOKEN}`,
              },
            }),
        };
      };
      const errRes = await ApifyProvider.searchProducts("sunscreen", { gl: "in", hl: "en" });
      assert.equal(statusFetchCount, 1, `HTTP ${status} must perform 0 automatic retries`);
      assert.equal(errRes.ok, false);
      assert.equal(errRes.errorType, expectedErrType);
      assert.equal(errRes.errorMessage.includes(process.env.APIFY_API_TOKEN), false);
    }

    // Partial-run recovery on 206 when usable `rowType === "product"` rows exist
    resetQuotaState(PROVIDER_IDS.APIFY, { clearMonthlyLedger: true });
    global.fetch = async () => ({
      ok: false,
      status: 206,
      headers: new Headers({ "content-type": "application/json" }),
      text: async () =>
        JSON.stringify([
          {
            rowType: "product",
            title: "Minimalist Light Fluid SPF 50 Sunscreen 50ml",
            price: "₹474",
            currency: "INR",
            seller: "Nykaa",
            image: "https://images-static.nykaa.com/p206.jpg",
          },
        ]),
    });
    const partialRes = await ApifyProvider.searchProducts("Minimalist sunscreen", { gl: "in" });
    assert.equal(partialRes.ok, true);
    assert.equal(partialRes.partialRun, true);
    assert.equal(partialRes.items.length, 1);
    apifySubtestsPassed += 2;

    // Test 19: Corrupted usage tracking fails closed
    resetQuotaState(PROVIDER_IDS.APIFY, { clearMonthlyLedger: true });
    fs.writeFileSync(tempApifyLedger16, "{broken-apify-ledger-json", "utf8");
    const corruptedGate = canCallProvider(PROVIDER_IDS.APIFY);
    assert.equal(corruptedGate.allowed, false);
    assert.equal(corruptedGate.reason, "budget_ledger_corrupted");

    let corruptedFetchCount = 0;
    global.fetch = async () => {
      corruptedFetchCount += 1;
      return makeMockJsonResponse([]);
    };
    const corruptedCall = await ApifyProvider.searchProducts("sunscreen", { gl: "in" });
    assert.equal(corruptedFetchCount, 0, "Corrupted ledger must fail closed without dispatching fetch");
    assert.equal(corruptedCall.ok, false);
    assert.equal(corruptedCall.skipped, true);
    assert.equal(corruptedCall.gateReason, "budget_ledger_corrupted");
    apifySubtestsPassed += 1;

    // Test 20: Existing router preserves SerpApi -> Serper -> SearchApi and skips Apify when existing results suffice
    resetQuotaState(PROVIDER_IDS.APIFY, { clearMonthlyLedger: true });
    process.env.SERPAPI_ENABLED = "true";
    process.env.SERPAPI_KEY = "serpapi_test_secret_16";
    process.env.APIFY_ENABLED = "true";
    resetQuotaState(PROVIDER_IDS.SERPAPI);

    const calledInHealthyRouter = [];
    global.fetch = async (url) => {
      const sUrl = String(url);
      calledInHealthyRouter.push(sUrl);
      if (sUrl.includes("serpapi.com")) {
        return makeMockJsonResponse({
          shopping_results: [
            { title: "Minimalist Light Fluid SPF 50 Sunscreen 50ml", source: "Nykaa", price: "₹474", extracted_price: 474, link: "https://www.nykaa.com/m1", thumbnail: "https://images-static.nykaa.com/m1.jpg", product_id: "gp1" },
            { title: "Minimalist Multi Vitamin SPF 50 Sunscreen 50g", source: "Amazon.in", price: "₹399", extracted_price: 399, link: "https://www.amazon.in/dp/M2", thumbnail: "https://m.media-amazon.com/m2.jpg", product_id: "gp2" },
            { title: "Minimalist Invisible SPF 50 Gel 50g", source: "Flipkart", price: "₹569", extracted_price: 569, link: "https://www.flipkart.com/m3", thumbnail: "https://rukminim2.flixcart.com/m3.jpg", product_id: "gp3" },
            { title: "Minimalist Fluid SPF 50 Sunscreen 30ml", source: "Tira Beauty", price: "₹299", extracted_price: 299, link: "https://www.tirabeauty.com/m4", thumbnail: "https://cdn.tirabeauty.com/m4.jpg", product_id: "gp4" },
            { title: "Minimalist Fluid SPF 50 Sunscreen 100ml", source: "Purplle", price: "₹849", extracted_price: 849, link: "https://www.purplle.com/m5", thumbnail: "https://media6.ppl-media.com/m5.jpg", product_id: "gp5" },
            { title: "Minimalist Niacinamide SPF 50 Sunscreen 50g", source: "Myntra", price: "₹429", extracted_price: 429, link: "https://www.myntra.com/m6", thumbnail: "https://assets.myntassets.com/m6.jpg", product_id: "gp6" },
          ],
        });
      }
      throw new Error(`Apify/secondary should not run when SerpApi suffices: ${sUrl}`);
    };
    const healthyRouterRes = await routeMultiProviderDiscovery({
      query: "Minimalist SPF 50 sunscreen",
      gl: "in",
      hl: "en",
      start: 0,
    });
    assert.deepEqual(healthyRouterRes.providersQueried, ["serpapi"]);
    assert.equal(calledInHealthyRouter.some((u) => u.includes("apify.com")), false);
    assert.equal(
      getConfiguredProviders("in").some(
        (p) => p.providerKey === PROVIDER_IDS.APIFY && p.id === "apify_google_shopping"
      ),
      true
    );
    // Irrelevant nonsense query never calls Apify
    const nonsenseRes = await routeMultiProviderDiscovery({
      query: "zzzznonexistentbeautyxyz999",
      gl: "in",
      hl: "en",
      start: 0,
    });
    assert.deepEqual(nonsenseRes.providersQueried, []);
    apifySubtestsPassed += 1;

    // Tests 21-23: Apify Actor run failures are never downgraded to EMPTY_RESULTS.
    // Regression for FAILED run Nz3z95wuw1sXOxoGd (0 items, ~2s, ~$0.000131).
    assert.equal(
      classifyProviderError({ message: "Apify returned empty dataset." }).errorType,
      ERROR_TYPES.EMPTY_RESULTS,
      "A genuinely empty dataset must remain a valid negative answer"
    );
    assert.equal(
      classifyProviderError({
        message: "Actor run failed: dataset empty after 2s",
      }).errorType,
      ERROR_TYPES.ACTOR_RUN_FAILED,
      "Empty-dataset wording on a failed run must classify as ACTOR_RUN_FAILED"
    );
    assert.equal(
      classifyProviderError({
        error: { type: "actor-run-failed", message: "no rows" },
      }).errorType,
      ERROR_TYPES.ACTOR_RUN_FAILED
    );
    assert.equal(
      classifyProviderError({
        error: { status: "FAILED", message: "no rows" },
      }).errorType,
      ERROR_TYPES.ACTOR_RUN_FAILED
    );
    apifySubtestsPassed += 1;

    // Structured Actor failure payload whose text also says "empty dataset"
    resetQuotaState(PROVIDER_IDS.APIFY, { clearMonthlyLedger: true });
    process.env.APIFY_MONTHLY_BUDGET_USD = "0.20";
    global.fetch = async () => ({
      ok: true,
      status: 200,
      headers: new Headers({
        "content-type": "application/json",
        "x-apify-actor-run-id": "Nz3z95wuw1sXOxoGd",
      }),
      text: async () =>
        JSON.stringify({
          error: {
            type: "actor-run-failed",
            message: `Actor run failed: dataset empty after 2s (token ${process.env.APIFY_API_TOKEN})`,
            runId: "Nz3z95wuw1sXOxoGd",
            status: "FAILED",
            exitCode: 1,
          },
        }),
    });
    const actorFailedRes = await ApifyProvider.searchProducts("sunscreen", {
      gl: "in",
      hl: "en",
    });
    assert.equal(actorFailedRes.ok, false);
    assert.equal(actorFailedRes.errorType, ERROR_TYPES.ACTOR_RUN_FAILED);
    assert.equal(actorFailedRes.runMetadata.runId, "Nz3z95wuw1sXOxoGd");
    assert.equal(actorFailedRes.runMetadata.status, "FAILED");
    assert.equal(actorFailedRes.runMetadata.exitCode, 1);
    assert.equal(actorFailedRes.usageMetadata.runMetadata.runId, "Nz3z95wuw1sXOxoGd");
    assert.equal(actorFailedRes.errorMessage.includes("Nz3z95wuw1sXOxoGd"), true);
    assert.equal(actorFailedRes.errorMessage.includes("FAILED"), true);
    assert.equal(actorFailedRes.errorMessage.includes(process.env.APIFY_API_TOKEN), false);
    assert.equal(
      getQuotaDiagnostics()[PROVIDER_IDS.APIFY].lastErrorType,
      ERROR_TYPES.ACTOR_RUN_FAILED
    );
    apifySubtestsPassed += 1;

    // FAILED run metadata alongside an empty items array (empty-branch guard)
    resetQuotaState(PROVIDER_IDS.APIFY, { clearMonthlyLedger: true });
    global.fetch = async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      text: async () =>
        JSON.stringify({
          run: { id: "runEmptyFailed01", status: "FAILED", exitCode: 137 },
          items: [],
        }),
    });
    const emptyFailedRes = await ApifyProvider.searchProducts("sunscreen", {
      gl: "in",
      hl: "en",
    });
    assert.equal(emptyFailedRes.ok, false, "FAILED run with empty items must not be ok:true");
    assert.equal(emptyFailedRes.errorType, ERROR_TYPES.ACTOR_RUN_FAILED);
    assert.equal(emptyFailedRes.runMetadata.status, "FAILED");
    assert.equal(emptyFailedRes.runMetadata.exitCode, 137);
    assert.equal(
      getQuotaDiagnostics()[PROVIDER_IDS.APIFY].lastErrorType,
      ERROR_TYPES.ACTOR_RUN_FAILED
    );

    // A SUCCEEDED run with an empty dataset must remain a valid negative answer.
    resetQuotaState(PROVIDER_IDS.APIFY, { clearMonthlyLedger: true });
    global.fetch = async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      text: async () =>
        JSON.stringify({
          run: { id: "runEmptyOk01", status: "SUCCEEDED" },
          items: [],
        }),
    });
    const emptyOkRes = await ApifyProvider.searchProducts("sunscreen", {
      gl: "in",
      hl: "en",
    });
    assert.equal(emptyOkRes.ok, true);
    assert.equal(emptyOkRes.errorType, ERROR_TYPES.EMPTY_RESULTS);
    assert.equal(emptyOkRes.runMetadata.status, "SUCCEEDED");
    assert.equal(
      getQuotaDiagnostics()[PROVIDER_IDS.APIFY].consecutiveFailures,
      0,
      "EMPTY_RESULTS must not open a failure streak"
    );
    apifySubtestsPassed += 1;

    assert.equal(apifySubtestsPassed, 23, "All 23 Apify test scenarios accounted for cleanly");
  } finally {
    global.fetch = origFetch16;
    invalidateSearchCache({
      prefix: buildSearchCacheKey("discover_v2", {
        q: apifyCacheQuery16,
        gl: "in",
        hl: "en",
        start: 0,
      }),
    });
    for (const [k, v] of Object.entries(savedEnv16)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetQuotaState(PROVIDER_IDS.SERPAPI);
    resetQuotaState(PROVIDER_IDS.SERPER);
    resetQuotaState(PROVIDER_IDS.SEARCHAPI);
    resetQuotaState(PROVIDER_IDS.BRIGHTDATA, { clearMonthlyLedger: true });
    resetQuotaState(PROVIDER_IDS.APIFY, { clearMonthlyLedger: true });
    if (fs.existsSync(tempApifyLedger16)) {
      fs.unlinkSync(tempApifyLedger16);
    }
  }

  console.log(`PASS: All Part 1 unit, resilience, Bright Data, credit-optimization, and Apify (${apifySubtestsPassed}/23) mocked tests passed.`);
  assert.ok(getQuotaDiagnostics());
}

async function runLiveHttpTests(baseUrl = "http://localhost:3000") {
  console.log(`\n=== PART 2: LIVE SERVER HTTP TESTS (${baseUrl}) ===`);

  const queries = [
    "sunscreen",
    "moisturizer",
    "Minimalist SPF 50 sunscreen",
    "vitamin C serum",
    "Neutrogena sunscreen",
  ];

  let minimalistCompareTarget = null;
  let sampleProduct = null;

  for (const q of queries) {
    const t0 = Date.now();
    const res = await fetch(
      `${baseUrl}/api/discover?q=${encodeURIComponent(q)}&gl=in&refresh=true`
    );
    const ms = Date.now() - t0;
    assert.equal(res.status, 200, `Expected 200 for discover query "${q}"`);
    const body = await res.json();
    assertNoSecretsLeaked(body, `discover:${q}`);

    assert.equal(body.isLive, true, `Expected live response for "${q}"`);
    assert.ok(Array.isArray(body.products) && body.products.length > 0, `Expected non-empty products for "${q}"`);
    assert.ok(Array.isArray(body.providersQueried) && body.providersQueried.length >= 1);

    const hasdataInRegistry = (body.providers || []).find(
      (p) => p.providerKey === "hasdata"
    );
    assert.equal(hasdataInRegistry?.enabled, false, "HasData must remain disabled");
    assert.equal(
      body.providersQueried.includes("hasdata"),
      false,
      "HasData must never be queried live"
    );

    const firstProd = body.products[0];
    assert.ok(firstProd.id && firstProd.title && firstProd.brand);
    assert.equal(
      firstProd.id.startsWith("nobrand__item__"),
      false,
      `Canonical ID must preserve brand & product tokens, got "${firstProd.id}"`
    );
    assert.equal(firstProd.currency, "INR");

    if (q === "Minimalist SPF 50 sunscreen") {
      const minimalistMatches = body.products.filter((p) =>
        p.brand?.toLowerCase().includes("minimalist")
      );
      assert.ok(
        minimalistMatches.length >= 1,
        "Multi-provider router must surface real Minimalist products via Serper + SerpApi"
      );
      minimalistCompareTarget =
        minimalistMatches.find((p) => p.name === "Minimalist SPF 50 Sunscreen" && p.hasDetailToken) ||
        minimalistMatches.find((p) => p.hasDetailToken) ||
        minimalistMatches[0];
      if (!sampleProduct) sampleProduct = minimalistCompareTarget;
    }

    if (!sampleProduct && q === "sunscreen") {
      sampleProduct = body.products.find((p) => p.hasDetailToken) || firstProd;
    }

    console.log(
      `PASS discover "${q}": ${ms}ms | mode=${body.mode} | providersQueried=${JSON.stringify(
        body.providersQueried
      )} | count=${body.products.length} | top="${firstProd.brand} — ${firstProd.name}" (₹${firstProd.lowestPrice})`
    );
  }

  // Test nonsense query returns honest empty state cleanly
  const emptyRes = await fetch(
    `${baseUrl}/api/discover?q=${encodeURIComponent("zzzznonexistentbeautyxyz999")}&gl=in&refresh=true`
  );
  assert.equal(emptyRes.status, 200);
  const emptyBody = await emptyRes.json();
  assertNoSecretsLeaked(emptyBody, "discover:nonsense");
  assert.equal(emptyBody.products.length, 0, "Nonsense query must return empty product list");
  console.log(`PASS discover nonsense query "zzzznonexistentbeautyxyz999": count=${emptyBody.products.length} | errorType=${emptyBody.errorType}`);

  // Test cache HIT on immediate repeat without refresh=true
  const tCache0 = Date.now();
  const cachedRes = await fetch(
    `${baseUrl}/api/discover?q=${encodeURIComponent("sunscreen")}&gl=in`
  );
  const cacheMs = Date.now() - tCache0;
  const cachedBody = await cachedRes.json();
  assertNoSecretsLeaked(cachedBody, "discover:cacheHit");
  assert.equal(cachedBody.cacheStatus, "HIT", "Second call without refresh=true must hit shared cache");
  assert.equal(cachedBody.dataSource, "CACHED_LIVE");
  console.log(`PASS discover cache HIT: ${cacheMs}ms | cacheStatus=${cachedBody.cacheStatus}`);

  // Test GET /api/product/[id]
  const targetForCompare = minimalistCompareTarget || sampleProduct;
  assert.ok(targetForCompare?.id, "Must have a discovered product ID");
  const prodRes = await fetch(
    `${baseUrl}/api/product/${encodeURIComponent(targetForCompare.id)}`
  );
  assert.equal(prodRes.status, 200);
  const prodBody = await prodRes.json();
  assertNoSecretsLeaked(prodBody, `product:${targetForCompare.id}`);
  assert.equal(prodBody.ok, true);
  assert.equal(prodBody.product.id, targetForCompare.id);
  console.log(
    `PASS /api/product/${targetForCompare.id}: status=200 | offersPreview=${prodBody.product.offersPreview.length}`
  );

  // Test GET /api/compare on Minimalist SPF 50 Sunscreen (audit direct link yield!)
  const tCmp0 = Date.now();
  const cmpRes = await fetch(
    `${baseUrl}/api/compare?productId=${encodeURIComponent(targetForCompare.id)}&q=${encodeURIComponent(
      targetForCompare.name
    )}&gl=in&refresh=true`
  );
  const cmpMs = Date.now() - tCmp0;
  assert.equal(cmpRes.status, 200);
  const cmpBody = await cmpRes.json();
  assertNoSecretsLeaked(cmpBody, `compare:${targetForCompare.id}`);
  assert.equal(cmpBody.isLive, true);
  const totalVariantBucketOffers =
    (cmpBody.offers?.length || 0) +
    (cmpBody.unverifiedOffers?.length || 0) +
    (cmpBody.otherVariants?.length || 0);
  assert.ok(totalVariantBucketOffers > 0, "Expected offers across exact/unverified/variant buckets");
  assert.ok(Array.isArray(cmpBody.unverifiedOffers));
  assert.ok(Array.isArray(cmpBody.otherVariants));
  for (const offer of cmpBody.offers) {
    assert.equal(offer.variantMatchStatus, "exact", `Primary offers must contain exact variant matches only, got ${offer.variantMatchStatus}`);
    assert.equal(offer.retailer?.includes("[object Object]"), false);
    if (offer.storeUrl && offer.linkType === "exact_product") {
      assert.equal(
        offer.storeUrl.includes("ibp=oshop"),
        false,
        "Exact merchant link must never be Google Shopping redirect"
      );
    }
  }
  const directLinks = [...cmpBody.offers, ...cmpBody.unverifiedOffers, ...cmpBody.otherVariants].filter(
    (o) => o.linkType === "exact_product"
  );
  console.log(
    `PASS /api/compare (${targetForCompare.name}): ${cmpMs}ms | exact=${cmpBody.offers.length} | unverified=${cmpBody.unverifiedOffers.length} | otherVariants=${cmpBody.otherVariants.length} | directLinks=${directLinks.length}`
  );

  // Test live variant isolation across required Minimalist SKUs
  for (const variantQuery of [
    "Minimalist Light Fluid SPF 50 50ml",
    "Minimalist SPF 50 30gm",
    "Minimalist SPF 50 100ml",
  ]) {
    const vRes = await fetch(
      `${baseUrl}/api/compare?q=${encodeURIComponent(variantQuery)}&gl=in&refresh=true`
    );
    assert.equal(vRes.status, 200, `Expected 200 for compare "${variantQuery}"`);
    const vBody = await vRes.json();
    assertNoSecretsLeaked(vBody, `compare:${variantQuery}`);
    assert.ok(Array.isArray(vBody.offers));
    assert.ok(Array.isArray(vBody.unverifiedOffers));
    assert.ok(Array.isArray(vBody.otherVariants));
    for (const o of vBody.offers) {
      assert.equal(o.variantMatchStatus, "exact");
    }
    for (const o of vBody.unverifiedOffers) {
      assert.equal(o.variantStatusLabel, "Variant unverified");
    }
    for (const o of vBody.otherVariants) {
      assert.equal(o.variantStatusLabel, "Other available variant");
    }
    console.log(
      `PASS variant compare "${variantQuery}": mode=${vBody.mode} | targetVol=${vBody.product?.volume} | exact=${vBody.offers.length} | unverified=${vBody.unverifiedOffers.length} | otherVariants=${vBody.otherVariants.length}`
    );
  }

  // Test /api/product/[id] 404 for unknown ID
  const notFoundRes = await fetch(`${baseUrl}/api/product/nonexistent-sku-999999`);
  assert.equal(notFoundRes.status, 404);
  console.log("PASS /api/product/nonexistent-sku-999999: returned 404 cleanly");
}

async function runLiveSearchApiFailoverTests(failoverUrl) {
  console.log(`\n=== PART 3: LIVE SEARCHAPI-ONLY FAILOVER & RESTART PERSISTENCE (${failoverUrl}) ===`);

  // 1. Live SearchApi-only discovery
  const discRes = await fetch(
    `${failoverUrl}/api/discover?q=${encodeURIComponent("Minimalist SPF 50 sunscreen")}&gl=in&refresh=true`
  );
  assert.equal(discRes.status, 200);
  const discBody = await discRes.json();
  assertNoSecretsLeaked(discBody, "searchapi:discover");
  assert.equal(discBody.isLive, true);
  assert.ok(discBody.providersQueried.includes("searchapi"));
  assert.equal(discBody.quotaDiagnostics?.serpapi?.gateReason, "disabled_by_env");
  assert.equal(discBody.quotaDiagnostics?.serper?.gateReason, "disabled_by_env");
  assert.ok(discBody.products.length > 0);

  const tokenTarget =
    discBody.products.find(
      (p) => p.brand?.toLowerCase().includes("minimalist") && p.hasDetailToken
    ) ||
    discBody.products.find((p) => p.hasDetailToken) ||
    discBody.products[0];
  console.log(
    `PASS SearchApi-only discover: count=${discBody.products.length} | providers=${JSON.stringify(
      discBody.providersQueried
    )} | target="${tokenTarget.id}"`
  );

  // 2. Live SearchApi-only Mode B comparison on selected Minimalist SKU
  const cmpRes = await fetch(
    `${failoverUrl}/api/compare?productId=${encodeURIComponent(tokenTarget.id)}&q=${encodeURIComponent(
      tokenTarget.name
    )}&gl=in&refresh=true`
  );
  assert.equal(cmpRes.status, 200, `SearchApi compare should resolve live offers for ${tokenTarget.id}`);
  const cmpBody = await cmpRes.json();
  assertNoSecretsLeaked(cmpBody, "searchapi:compare");
  assert.equal(cmpBody.isLive, true);
  const allSaOffers = [
    ...(cmpBody.offers || []),
    ...(cmpBody.unverifiedOffers || []),
    ...(cmpBody.otherVariants || []),
  ];
  assert.ok(allSaOffers.length >= 1, "SearchApi compare must return at least 1 offer across variant buckets");
  for (const offer of allSaOffers) {
    assert.equal(
      String(offer.retailer || "").includes("[object Object]"),
      false,
      `Retailer name must never be [object Object], got "${offer.retailer}"`
    );
  }
  const saDirectLinks = allSaOffers.filter((o) => o.linkType === "exact_product");
  console.log(
    `PASS SearchApi-only compare: exact=${cmpBody.offers.length} | unverified=${cmpBody.unverifiedOffers.length} | otherVariants=${cmpBody.otherVariants.length} | directLinks=${saDirectLinks.length} | retailers=${JSON.stringify(
      allSaOffers.map((o) => o.retailer)
    )}`
  );
}

async function main() {
  loadEnvLocal();
  await runUnitAndResilienceTests();
  if (process.argv.includes("--live")) {
    const baseUrlArg = process.argv.find((a) => a.startsWith("--url="));
    const baseUrl = baseUrlArg ? baseUrlArg.slice(6) : "http://localhost:3000";
    await runLiveHttpTests(baseUrl);
  }
  const failoverArg = process.argv.find((a) => a.startsWith("--failover-url="));
  if (failoverArg) {
    await runLiveSearchApiFailoverTests(failoverArg.slice(15));
  }
  console.log("\nALL CHECKS PASSED");
}

main().catch((err) => {
  console.error("TEST FAILED:", err?.stack || err?.message || err);
  process.exit(1);
});
