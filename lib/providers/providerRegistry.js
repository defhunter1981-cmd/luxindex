import { ApifyProvider } from "./apifyProvider";
import { BrightDataProvider } from "./brightDataProvider";
import { SearchApiProvider } from "./searchApiProvider";
import { SerpApiProvider } from "./serpApiProvider";
import { SerperProvider } from "./serperProvider";
import { PROVIDER_IDS, getQuotaDiagnostics } from "@/lib/search/quotaManager";

/**
 * Central provider capability manifest. Surfaces live Google Shopping providers
 * (`serpapi`, `serper`, `searchapi`, controlled fallback `apify` & `brightdata`),
 * paused/under-review providers (`hasdata`), and optional unconfigured merchant adapters honestly without synthetic data.
 */
export function getConfiguredProviders(gl = "in") {
  const diag = getQuotaDiagnostics();
  const market = { gl: gl === "us" ? "us" : "in", hl: "en", currency: gl === "us" ? "USD" : "INR" };

  const hasAmazonCreators = Boolean(
    process.env.AMAZON_CREATORS_KEY?.trim() &&
      process.env.AMAZON_CREATORS_SECRET?.trim()
  );
  const hasAffiliateFeed = Boolean(process.env.AFFILIATE_FEED_TOKEN?.trim());
  const hasDirectRetailer = Boolean(process.env.DIRECT_RETAILER_API_KEY?.trim());

  const serp = SerpApiProvider.getProviderStatus();
  const serper = SerperProvider.getProviderStatus();
  const searchapi = SearchApiProvider.getProviderStatus();
  const apify = ApifyProvider.getProviderStatus();
  const brightdata = BrightDataProvider.getProviderStatus();
  const hasdata = diag[PROVIDER_IDS.HASDATA];

  return [
    {
      ...serp,
      activeForMarket: serp.enabled && serp.callable,
      market,
    },
    {
      ...serper,
      activeForMarket: serper.enabled && serper.callable,
      market,
    },
    {
      ...searchapi,
      activeForMarket: searchapi.enabled && searchapi.callable,
      market,
    },
    {
      ...apify,
      activeForMarket: apify.enabled && apify.callable,
      market,
    },
    {
      ...brightdata,
      activeForMarket: brightdata.enabled && brightdata.callable,
      market,
    },
    {
      id: "hasdata_google_shopping",
      providerKey: PROVIDER_IDS.HASDATA,
      name: "HasData Google Shopping",
      role: "deferred_under_review",
      configured: hasdata?.configured || false,
      enabled: false,
      callable: false,
      activeForMarket: false,
      status: "under_review",
      gateReason: "account_under_review",
      market,
    },
    {
      id: "amazon_creators_api",
      name: "Amazon Creators API",
      role: "supplementary_merchant_api",
      configured: hasAmazonCreators,
      activeForMarket: hasAmazonCreators,
    },
    {
      id: "affiliate_product_feeds",
      name: "Affiliate Product Feeds",
      role: "supplementary_feed",
      configured: hasAffiliateFeed,
      activeForMarket: hasAffiliateFeed,
    },
    {
      id: "direct_retailer_integrations",
      name: "Direct Retailer Integrations",
      role: "merchant_direct_api",
      configured: hasDirectRetailer,
      activeForMarket: hasDirectRetailer,
    },
    {
      id: "local_curated_catalog",
      name: "Local Curated Beauty Index",
      role: "offline_demo_fallback",
      configured: true,
      activeForMarket: true,
    },
  ];
}
