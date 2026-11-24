/**
 * Phase 5 Benchmark: Bright Data SERP API vs SerpApi / Serper / SearchApi
 * Evaluates discovery quality, Indian retailer coverage, direct merchant URLs,
 * duplicate prevention, variant separation, price spread, latency, and credit usage.
 *
 * Strictly redacts/never prints any API keys or secrets.
 */

import fs from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

registerHooks({
  resolve(specifier, context, nextResolve) {
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

loadEnvLocal();

const BENCHMARK_QUERIES = [
  "sunscreen",
  "Minimalist SPF 50 sunscreen",
  "Minimalist Light Fluid SPF 50 50ml",
  "Neutrogena sunscreen",
  "Minimalist Vitamin C serum",
  "moisturizer",
];

function summarizeProviderRun(query, providerId, res, latencyMs, helpers) {
  const { deduplicateAndAggregateProducts, filterRelevantDiscoveryProducts } = helpers;
  const rawItems = Array.isArray(res?.items) ? res.items : [];
  const grouped = deduplicateAndAggregateProducts(rawItems, {
    displayCurrency: "INR",
    registerInServerCache: false,
  });
  const relevant = filterRelevantDiscoveryProducts(grouped, query);

  const indianRetailers = new Set();
  let directMerchantUrlCount = 0;
  let prices = [];
  const variants = new Set();

  for (const product of relevant) {
    if (typeof product.lowestPrice === "number" && product.lowestPrice > 0) {
      prices.push(product.lowestPrice);
    }
    variants.add(
      `${product.size || "nosize"}|${product.spfTier || product.spf || "nospf"}|${product.formulation || "base"}`
    );
    for (const offer of product.offersPreview || []) {
      if (offer.isDomesticIndian && offer.retailer) {
        indianRetailers.add(offer.retailer);
      }
      if (offer.merchantProductUrl) {
        directMerchantUrlCount += 1;
      }
    }
  }

  return {
    provider: providerId,
    ok: Boolean(res?.ok),
    errorType: res?.errorType || null,
    latencyMs,
    rawCount: rawItems.length,
    groupedCount: grouped.length,
    relevantCount: relevant.length,
    indianRetailerCount: indianRetailers.size,
    indianRetailers: [...indianRetailers].slice(0, 6),
    directMerchantUrlCount,
    distinctVariantCount: variants.size,
    minPriceInr: prices.length ? Math.min(...prices) : null,
    maxPriceInr: prices.length ? Math.max(...prices) : null,
  };
}

async function main() {
  const { BrightDataProvider } = await import("../lib/providers/brightDataProvider.js");
  const { SerpApiProvider } = await import("../lib/providers/serpApiProvider.js");
  const { SerperProvider } = await import("../lib/providers/serperProvider.js");
  const { SearchApiProvider } = await import("../lib/providers/searchApiProvider.js");
  const { deduplicateAndAggregateProducts } = await import("../lib/search/deduplicator.js");
  const { filterRelevantDiscoveryProducts } = await import("../lib/search/relevance.js");
  const { getMonthlyCreditStatus, canCallProvider, PROVIDER_IDS } = await import(
    "../lib/search/quotaManager.js"
  );

  const hasApiKey = Boolean(process.env.BRIGHTDATA_API_KEY?.trim());
  const hasSerpZone = Boolean(process.env.BRIGHTDATA_SERP_ZONE?.trim());
  const runLive = process.argv.includes("--live");
  const includeExisting = process.argv.includes("--compare-existing");

  console.log("=== BRIGHT DATA SERP BENCHMARK PREFLIGHT ===");
  console.log(
    JSON.stringify(
      {
        brightDataApiKeyPresent: hasApiKey,
        brightDataSerpZonePresent: hasSerpZone,
        brightDataEnabledEnv: process.env.BRIGHTDATA_ENABLED ?? "(unset -> false)",
        brightDataStatus: BrightDataProvider.getProviderStatus(),
        monthlyBudget: getMonthlyCreditStatus(PROVIDER_IDS.BRIGHTDATA),
        queries: BENCHMARK_QUERIES,
      },
      null,
      2
    )
  );

  if (!hasApiKey || !hasSerpZone) {
    console.log(
      "\nSKIPPED LIVE BRIGHT DATA BENCHMARK: Add BRIGHTDATA_API_KEY and BRIGHTDATA_SERP_ZONE to .env.local, then run:\n  node scripts/evaluate-brightdata.mjs --live --compare-existing"
    );
    return;
  }

  if (!runLive) {
    console.log(
      "\nDRY RUN COMPLETE: Credentials detected. Pass --live (and optionally --compare-existing) to run the 6-query benchmark."
    );
    return;
  }

  // Temporarily allow BrightDataProvider inside this isolated benchmark script only when explicitly invoked with --live.
  if (process.env.BRIGHTDATA_ENABLED !== "true") {
    process.env.BRIGHTDATA_ENABLED = "true";
  }

  const providers = [
    BrightDataProvider,
    ...(includeExisting ? [SerpApiProvider, SerperProvider, SearchApiProvider] : []),
  ];

  const report = [];
  for (const query of BENCHMARK_QUERIES) {
    const queryRow = { query, providers: {} };
    for (const adapter of providers) {
      if (adapter.id === PROVIDER_IDS.BRIGHTDATA) {
        const gate = canCallProvider(PROVIDER_IDS.BRIGHTDATA);
        if (!gate.allowed) {
          queryRow.providers[adapter.id] = {
            provider: adapter.id,
            ok: false,
            errorType: gate.reason,
          };
          continue;
        }
      }

      const t0 = Date.now();
      const res = await adapter.searchProducts(query, { gl: "in", hl: "en", start: 0 });
      const latencyMs = Date.now() - t0;
      queryRow.providers[adapter.id] = summarizeProviderRun(query, adapter.id, res, latencyMs, {
        deduplicateAndAggregateProducts,
        filterRelevantDiscoveryProducts,
      });
    }
    report.push(queryRow);
  }

  console.log("\n=== BRIGHT DATA BENCHMARK RESULTS ===");
  console.log(
    JSON.stringify(
      {
        report,
        monthlyBudgetAfter: getMonthlyCreditStatus(PROVIDER_IDS.BRIGHTDATA),
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error("evaluate-brightdata failed:", err?.message || err);
  process.exit(1);
});
