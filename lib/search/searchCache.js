import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeText } from "@/lib/utils";

export const CACHE_TTL_MS = Object.freeze({
  category: 12 * 60 * 60 * 1000, // 12 hours for broad category discovery
  brand: 6 * 60 * 60 * 1000, // 6 hours for brand-specific discovery
  exact: 24 * 60 * 60 * 1000, // 24 hours for canonical exact product identity
  offers: 2 * 60 * 60 * 1000, // 2 hours for retailer offer pricing
  metadata: 7 * 24 * 60 * 60 * 1000, // 7 days for non-volatile product metadata
});

const STALE_WHILE_REVALIDATE_MS = 2 * 60 * 60 * 1000;
const MAX_PERSISTED_ENTRIES = 250;
const CACHE_FILE_PATH = path.join(os.tmpdir(), "luxeindex-v2-search-cache.json");

function getMemoryStore() {
  if (!globalThis.__luxeSearchCacheStore) {
    globalThis.__luxeSearchCacheStore = {
      loadedFromDisk: false,
      entries: new Map(),
      inFlight: new Map(),
      stats: {
        hits: 0,
        staleHits: 0,
        misses: 0,
        coalescedHits: 0,
        writes: 0,
        skippedFailureWrites: 0,
      },
    };
  }
  const store = globalThis.__luxeSearchCacheStore;
  if (!store.loadedFromDisk) {
    store.loadedFromDisk = true;
    hydrateFromDisk(store);
  }
  return store;
}

function hydrateFromDisk(store) {
  try {
    if (!fs.existsSync(CACHE_FILE_PATH)) return;
    const raw = fs.readFileSync(CACHE_FILE_PATH, "utf8");
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.entries) return;

    const now = Date.now();
    for (const [key, entry] of Object.entries(parsed.entries)) {
      if (!entry || typeof entry !== "object") continue;
      const staleDeadline = Number(entry.expiresAt || 0) + STALE_WHILE_REVALIDATE_MS;
      if (staleDeadline > now && entry.data !== undefined) {
        store.entries.set(key, entry);
      }
    }
  } catch {
    // Ignore corrupted or inaccessible tmp cache files
  }
}

function persistToDisk(store) {
  try {
    const now = Date.now();
    const validEntries = [];
    for (const [key, entry] of store.entries.entries()) {
      const staleDeadline = Number(entry.expiresAt || 0) + STALE_WHILE_REVALIDATE_MS;
      if (staleDeadline > now) {
        validEntries.push([key, entry]);
      }
    }
    validEntries.sort((a, b) => (b[1].cachedAtMs || 0) - (a[1].cachedAtMs || 0));
    const trimmed = validEntries.slice(0, MAX_PERSISTED_ENTRIES);

    const payload = {
      version: 2,
      updatedAt: new Date(now).toISOString(),
      entries: Object.fromEntries(trimmed),
    };
    fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(payload), "utf8");
  } catch {
    // Non-fatal in read-only or ephemeral environments
  }
}

export function buildSearchCacheKey(namespace, params = {}) {
  const parts = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => {
      if (key === "query" || key === "q") {
        return `${key}:${normalizeText(String(value))}`;
      }
      return `${key}:${String(value).trim().toLowerCase()}`;
    });
  return `${namespace}|${parts.join("|")}`;
}

export function resolveTtlForKind(kind = "category") {
  return CACHE_TTL_MS[kind] || CACHE_TTL_MS.category;
}

/**
 * Reads an entry from the shared provider-independent search cache.
 * Supports fresh hits and bounded stale-while-revalidate hits.
 */
export function getSearchCacheEntry(key, { allowStale = true } = {}) {
  const store = getMemoryStore();
  const entry = store.entries.get(key);
  if (!entry) {
    store.stats.misses += 1;
    return null;
  }

  const now = Date.now();
  if (now <= entry.expiresAt) {
    store.stats.hits += 1;
    return {
      status: "HIT",
      isStale: false,
      cachedAt: entry.cachedAt,
      expiresAt: new Date(entry.expiresAt).toISOString(),
      ttlSeconds: Math.max(0, Math.round((entry.expiresAt - now) / 1000)),
      providers: entry.providers || [],
      data: entry.data,
    };
  }

  if (allowStale && now <= entry.expiresAt + STALE_WHILE_REVALIDATE_MS) {
    store.stats.staleHits += 1;
    return {
      status: "STALE_HIT",
      isStale: true,
      cachedAt: entry.cachedAt,
      expiresAt: new Date(entry.expiresAt).toISOString(),
      ttlSeconds: 0,
      providers: entry.providers || [],
      data: entry.data,
    };
  }

  store.entries.delete(key);
  store.stats.misses += 1;
  return null;
}

/**
 * Writes successful, non-empty results to the shared cache.
 * Failed responses or empty payloads are explicitly rejected so outages are never cached.
 */
export function setSearchCacheEntry(
  key,
  data,
  { kind = "category", ttlMs = null, providers = [], isFailure = false } = {}
) {
  const store = getMemoryStore();
  if (isFailure || !data) {
    store.stats.skippedFailureWrites += 1;
    return null;
  }

  const hasProducts =
    Array.isArray(data.products) && data.products.length > 0;
  const hasOffers =
    Array.isArray(data.offers) && data.offers.length > 0;
  const hasProduct = Boolean(data.product && data.product.id);

  if (!hasProducts && !hasOffers && !hasProduct) {
    store.stats.skippedFailureWrites += 1;
    return null;
  }

  const effectiveTtl =
    typeof ttlMs === "number" && ttlMs > 0 ? ttlMs : resolveTtlForKind(kind);
  const now = Date.now();
  const entry = {
    kind,
    providers: Array.isArray(providers) ? [...new Set(providers)] : [],
    cachedAt: new Date(now).toISOString(),
    cachedAtMs: now,
    expiresAt: now + effectiveTtl,
    data,
  };

  store.entries.set(key, entry);
  store.stats.writes += 1;
  persistToDisk(store);

  return {
    status: "MISS",
    cachedAt: entry.cachedAt,
    expiresAt: new Date(entry.expiresAt).toISOString(),
    ttlSeconds: Math.round(effectiveTtl / 1000),
  };
}

/**
 * Prevents thundering-herd duplicate external provider calls for identical concurrent queries.
 */
export async function coalescedSearchFetch(key, fetcher) {
  const store = getMemoryStore();
  if (store.inFlight.has(key)) {
    store.stats.coalescedHits += 1;
    return store.inFlight.get(key);
  }

  const promise = (async () => {
    try {
      return await fetcher();
    } finally {
      store.inFlight.delete(key);
    }
  })();

  store.inFlight.set(key, promise);
  return promise;
}

/**
 * Invalidates all cached entries, optionally filtering by provider ID or namespace prefix.
 */
export function invalidateSearchCache({ provider = null, prefix = null } = {}) {
  const store = getMemoryStore();
  let removed = 0;

  for (const [key, entry] of store.entries.entries()) {
    const matchPrefix = !prefix || key.startsWith(prefix);
    const matchProvider =
      !provider || (Array.isArray(entry.providers) && entry.providers.includes(provider));
    if (matchPrefix && matchProvider) {
      store.entries.delete(key);
      removed += 1;
    }
  }

  if (removed > 0) {
    persistToDisk(store);
  }
  return removed;
}

export function getSearchCacheDiagnostics() {
  const store = getMemoryStore();
  return {
    entriesCount: store.entries.size,
    inFlightCount: store.inFlight.size,
    ...store.stats,
  };
}

