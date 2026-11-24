import { NextResponse } from "next/server";
import { mockCatalog } from "@/data/mockCatalog";
import { getRegisteredProduct } from "@/lib/discoveryCache";
import { getConfiguredProviders } from "@/lib/providers/providerRegistry";
import {
  buildSearchCacheKey,
  getSearchCacheEntry,
  setSearchCacheEntry,
} from "@/lib/search/searchCache";
import { getQuotaDiagnostics, redactSecrets } from "@/lib/search/quotaManager";

function sanitizeRegisteredProduct(reg) {
  if (!reg || typeof reg !== "object") return null;
  const {
    immersivePageTokens: _unusedImmersive,
    searchApiProductTokens: _unusedSearchApi,
    ...safeFields
  } = reg;

  return {
    id: safeFields.id,
    canonicalProductId: safeFields.canonicalKey || safeFields.id,
    name: safeFields.name,
    title: safeFields.name,
    rawTitle: safeFields.rawTitle || safeFields.name,
    brand: safeFields.brand,
    category: safeFields.category,
    size: safeFields.volume || null,
    variant: safeFields.variant || null,
    spf: safeFields.spf || null,
    image: safeFields.image || null,
    imageUrl: safeFields.image || null,
    rating: safeFields.rating ?? null,
    reviewCount: safeFields.reviewCount ?? null,
    offersPreview: Array.isArray(safeFields.offersPreview)
      ? safeFields.offersPreview
      : [],
    providers: Array.isArray(safeFields.providers)
      ? safeFields.providers
      : [],
    hasDetailTokens: Boolean(
      (reg.immersivePageTokens && reg.immersivePageTokens.length > 0) ||
        (reg.searchApiProductTokens && reg.searchApiProductTokens.length > 0)
    ),
    dataSource: safeFields.dataSource || "live",
  };
}

export async function GET(request, context) {
  try {
    const resolvedParams = await context.params;
    const rawId = resolvedParams?.id || "";
    const productId = decodeURIComponent(rawId).trim();

    if (!productId) {
      return NextResponse.json(
        {
          ok: false,
          errorType: "INVALID_REQUEST",
          error: "Missing product id parameter.",
        },
        { status: 400 }
      );
    }

    const cacheKey = buildSearchCacheKey("product_meta_v2", { id: productId });
    const cached = getSearchCacheEntry(cacheKey, { allowStale: true });
    if (cached?.data?.product) {
      return NextResponse.json(
        {
          ok: true,
          cacheStatus: cached.status,
          cachedAt: cached.cachedAt,
          expiresAt: cached.expiresAt,
          ttlSeconds: cached.ttlSeconds,
          isLive: cached.data.product.dataSource !== "CURATED_DEMO",
          product: cached.data.product,
          providers: getConfiguredProviders("in"),
          quotaDiagnostics: getQuotaDiagnostics(),
        },
        { status: 200 }
      );
    }

    const registered = getRegisteredProduct(productId);
    let safeProduct = sanitizeRegisteredProduct(registered);

    if (!safeProduct) {
      const mockMatch = mockCatalog.find((item) => item.id === productId);
      if (mockMatch) {
        safeProduct = {
          id: mockMatch.id,
          canonicalProductId: mockMatch.id,
          name: mockMatch.name,
          title: mockMatch.name,
          rawTitle: mockMatch.name,
          brand: mockMatch.brand,
          category: mockMatch.category,
          size: mockMatch.volume,
          variant: mockMatch.variant || null,
          spf: null,
          image: mockMatch.image,
          imageUrl: mockMatch.image,
          rating: mockMatch.rating,
          reviewCount: mockMatch.reviewCount,
          offersPreview: (mockMatch.offers || []).map((o) => ({
            retailer: o.retailer,
            merchant: o.retailer,
            price: o.price,
            currency: o.currency,
            merchantProductUrl: o.storeUrl,
            linkType: o.linkType,
            inStock: o.inStock,
          })),
          providers: ["local_curated_catalog"],
          hasDetailTokens: false,
          dataSource: "CURATED_DEMO",
        };
      }
    }

    if (!safeProduct) {
      return NextResponse.json(
        {
          ok: false,
          errorType: "NOT_FOUND",
          error: `Product "${productId}" not found in active discovery or catalog registry.`,
          providers: getConfiguredProviders("in"),
        },
        { status: 404 }
      );
    }

    const cacheMeta = setSearchCacheEntry(
      cacheKey,
      { product: safeProduct },
      {
        kind: "metadata",
        providers: safeProduct.providers || [],
        isFailure: safeProduct.dataSource === "CURATED_DEMO",
      }
    );

    return NextResponse.json(
      {
        ok: true,
        cacheStatus: "MISS",
        cachedAt: cacheMeta?.cachedAt || null,
        expiresAt: cacheMeta?.expiresAt || null,
        ttlSeconds: cacheMeta?.ttlSeconds || null,
        isLive: safeProduct.dataSource !== "CURATED_DEMO",
        product: safeProduct,
        providers: getConfiguredProviders("in"),
        quotaDiagnostics: getQuotaDiagnostics(),
      },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        errorType: "INTERNAL_ERROR",
        error: "Unable to resolve canonical product metadata.",
        details: redactSecrets(error?.message || "Internal server error"),
      },
      { status: 500 }
    );
  }
}

