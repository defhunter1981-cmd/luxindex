import { mockCatalog } from "@/data/mockCatalog";
import { normalizeText } from "@/lib/utils";

/**
 * Curated local fallback provider used ONLY when SerpApi is unconfigured,
 * offline, or quota-exhausted. Outputs are explicitly tagged `CURATED_DEMO`
 * and never masquerade as live retail results.
 */
export function discoverWithLocalCatalog({ query = "" }) {
  const qNorm = normalizeText(query);
  const tokens = qNorm.split(" ").filter((t) => t.length >= 2);

  const scored = mockCatalog.map((item) => {
    const haystack = normalizeText(
      [
        item.name,
        item.shortName,
        item.brand,
        item.category,
        ...(item.tags || []),
        ...(item.aliases || []),
        ...(item.keyNotes || []),
        item.description,
      ]
        .filter(Boolean)
        .join(" ")
    );

    if (!qNorm) return { item, score: 10 };
    if (haystack.includes(qNorm)) return { item, score: 50 };

    let matches = 0;
    for (const tok of tokens) {
      if (haystack.includes(tok)) matches++;
    }
    return { item, score: matches };
  });

  const matching = scored.filter((entry) => entry.score > 0);
  const pool =
    matching.length > 0
      ? matching.sort((a, b) => b.score - a.score).map((e) => e.item)
      : qNorm
      ? []
      : mockCatalog;

  // Flatten curated offers into normalized raw items compatible with aggregateDiscoveryProducts
  const flattened = [];
  for (const prod of pool) {
    for (const offer of prod.offers || []) {
      flattened.push({
        id: prod.id,
        title: prod.name,
        source: offer.retailer,
        retailer: offer.retailer,
        price: offer.price,
        extracted_price: offer.price,
        old_price: offer.originalPrice,
        extracted_old_price: offer.originalPrice,
        discountPercent: offer.discountPercent,
        inStock: offer.inStock,
        stockLabel: offer.stockLabel,
        delivery: offer.shippingInfo,
        rating: offer.storeRating ?? prod.rating,
        reviews: prod.reviewCount,
        thumbnail: prod.image,
        image: prod.image,
        description: prod.description,
        category: prod.category,
        variant: prod.variant,
        direct_link: offer.storeUrl,
        link: offer.storeUrl,
        sku: prod.id,
        gtin: null,
      });
    }
  }

  return {
    providerId: "local_curated_catalog",
    providerLabel: "Curated Beauty Baseline (Demo)",
    rawCount: flattened.length,
    items: flattened,
    serpFilters: [],
    hasNextProviderPage: false,
    nextStart: null,
    fetchedAt: new Date().toISOString(),
  };
}

