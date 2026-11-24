import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_DISCOVERY_TTL_MS = 10 * 60 * 1000; // 10 minutes
const DEFAULT_COMPARE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const TOKEN_REGISTRY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_REGISTRY_ENTRIES = 1000;
const TOKEN_STORE_PATH = path.join(os.tmpdir(), "luxeindex-server-product-tokens.json");

function hydrateProductTokensFromDisk(registryMap) {
  try {
    if (!fs.existsSync(TOKEN_STORE_PATH)) return;
    const raw = fs.readFileSync(TOKEN_STORE_PATH, "utf8");
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.entries) return;

    const now = Date.now();
    for (const [productId, entry] of Object.entries(parsed.entries)) {
      if (!productId || !entry || typeof entry !== "object") continue;
      const registeredAt = Number(entry.registeredAtMs || 0);
      if (registeredAt + TOKEN_REGISTRY_TTL_MS <= now) continue;

      registryMap.set(productId, {
        ...entry,
        immersivePageTokens: sanitizeTokenList(entry.immersivePageTokens),
        searchApiProductTokens: sanitizeTokenList(entry.searchApiProductTokens),
      });
    }
  } catch {
    // Recover cleanly if persisted file is absent or malformed
  }
}

function persistProductTokensToDisk(registryMap) {
  try {
    const now = Date.now();
    // Merge existing non-expired disk entries first so concurrent workers never clobber tokens
    const combined = new Map();
    hydrateProductTokensFromDisk(combined);
    for (const [id, entry] of registryMap.entries()) {
      if (!id || !entry) continue;
      const prev = combined.get(id) || {};
      combined.set(id, {
        ...prev,
        ...entry,
        immersivePageTokens: sanitizeTokenList([
          ...(prev.immersivePageTokens || []),
          ...(entry.immersivePageTokens || []),
        ]),
        searchApiProductTokens: sanitizeTokenList([
          ...(prev.searchApiProductTokens || []),
          ...(entry.searchApiProductTokens || []),
        ]),
      });
    }

    const valid = [];
    for (const [id, entry] of combined.entries()) {
      if (!id || !entry) continue;
      const registeredAt = Number(entry.registeredAtMs || 0);
      if (registeredAt + TOKEN_REGISTRY_TTL_MS > now) {
        valid.push([id, entry]);
      }
    }
    valid.sort((a, b) => (b[1].registeredAtMs || 0) - (a[1].registeredAtMs || 0));
    const trimmed = valid.slice(0, MAX_REGISTRY_ENTRIES);

    const payload = {
      version: 1,
      serverOnly: true,
      updatedAt: new Date(now).toISOString(),
      entries: Object.fromEntries(trimmed),
    };
    fs.writeFileSync(TOKEN_STORE_PATH, JSON.stringify(payload), "utf8");
  } catch {
    // Non-fatal in read-only filesystems
  }
}

function sanitizeTokenList(list) {
  if (!Array.isArray(list)) return [];
  const deduped = new Set();
  for (const item of list) {
    if (typeof item === "string" && item.trim().length > 0) {
      deduped.add(item.trim());
    }
  }
  return [...deduped];
}

function getCacheRoots() {
  if (!globalThis.__luxeV2Cache) {
    const registry = new Map();
    hydrateProductTokensFromDisk(registry);
    globalThis.__luxeV2Cache = {
      discovery: new Map(),
      discoveryInflight: new Map(),
      compare: new Map(),
      compareInflight: new Map(),
      productRegistry: registry,
    };
  }
  return globalThis.__luxeV2Cache;
}

/**
 * Resets in-memory caches ONLY (preserving persisted disk token store) so tests
 * can simulate a cold server restart and verify server-side token hydration.
 */
export function __resetDiscoveryRamOnlyForTest() {
  delete globalThis.__luxeV2Cache;
}

export function getDiscoveryCacheStats() {
  const roots = getCacheRoots();
  return {
    discoveryEntries: roots.discovery.size,
    compareEntries: roots.compare.size,
    registeredProducts: roots.productRegistry.size,
    discoveryTtlSeconds: Math.round(DEFAULT_DISCOVERY_TTL_MS / 1000),
    compareTtlSeconds: Math.round(DEFAULT_COMPARE_TTL_MS / 1000),
  };
}

/**
 * Registers server-side metadata & provider tokens (`immersivePageTokens`,
 * `searchApiProductTokens`) in RAM + server-only disk storage (`os.tmpdir()`) so
 * Mode B comparisons survive disk-cache hydration and server restarts without
 * ever leaking tokens into public JSON responses.
 */
export function registerDiscoveredProduct(productId, metadata) {
  if (!productId || !metadata || typeof metadata !== "object") return;
  const roots = getCacheRoots();
  if (roots.productRegistry.size >= MAX_REGISTRY_ENTRIES && !roots.productRegistry.has(productId)) {
    const oldestKey = roots.productRegistry.keys().next().value;
    if (oldestKey) roots.productRegistry.delete(oldestKey);
  }

  const existing = roots.productRegistry.get(productId) || {};
  const mergedImmersive = sanitizeTokenList([
    ...(existing.immersivePageTokens || []),
    ...(metadata.immersivePageTokens || []),
  ]);
  const mergedSearchApi = sanitizeTokenList([
    ...(existing.searchApiProductTokens || []),
    ...(metadata.searchApiProductTokens || []),
  ]);

  roots.productRegistry.set(productId, {
    ...existing,
    ...metadata,
    immersivePageTokens: mergedImmersive,
    searchApiProductTokens: mergedSearchApi,
    registeredAtMs: Date.now(),
  });

  persistProductTokensToDisk(roots.productRegistry);
}

function parseCanonicalAliasSignature(productId = "") {
  if (typeof productId !== "string") return null;
  const parts = productId.split("__");
  if (parts.length !== 3) return null;
  const [brand, slug, spec] = parts;
  if (!brand || !slug || !spec) return null;
  const normalizedSlug = slug
    .toLowerCase()
    .replace(/spf(\d)/g, "spf-$1")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const tokens = normalizedSlug.split(/\s+/).filter(Boolean).sort();
  if (tokens.length === 0) return null;
  const specLower = spec.toLowerCase();
  const firstUnderscore = specLower.indexOf("_");
  const sizePart = firstUnderscore >= 0 ? specLower.slice(0, firstUnderscore) : specLower;
  const variantRest = firstUnderscore >= 0 ? specLower.slice(firstUnderscore + 1) : "";
  return {
    brand: brand.toLowerCase(),
    spec: specLower,
    sizePart,
    variantRest,
    tokenBagKey: tokens.join(" "),
  };
}

function collectEquivalentEntries(registryMap, targetId, now = Date.now()) {
  const sig = parseCanonicalAliasSignature(targetId);
  if (!sig) return [];
  const exactMatches = [];
  const nosizeSiblings = [];
  for (const [id, entry] of registryMap.entries()) {
    if (id === targetId || !entry) continue;
    if (Number(entry.registeredAtMs || 0) + TOKEN_REGISTRY_TTL_MS <= now) continue;
    const candSig = parseCanonicalAliasSignature(id);
    if (!candSig) continue;
    if (candSig.brand !== sig.brand || candSig.tokenBagKey !== sig.tokenBagKey) continue;

    if (candSig.spec === sig.spec) {
      exactMatches.push(entry);
    } else if (candSig.sizePart === "nosize" && candSig.variantRest === sig.variantRest) {
      // Many Google Shopping cards omit bottle volume in the headline ("nosize");
      // offer-level identity filtering still enforces exact size when comparing.
      nosizeSiblings.push(entry);
    }
  }
  return [...exactMatches, ...nosizeSiblings];
}

export function getRegisteredProduct(productId) {
  if (!productId) return null;
  const roots = getCacheRoots();
  hydrateProductTokensFromDisk(roots.productRegistry);

  const now = Date.now();
  let entry = roots.productRegistry.get(productId);
  if (entry && Number(entry.registeredAtMs || 0) + TOKEN_REGISTRY_TTL_MS <= now) {
    roots.productRegistry.delete(productId);
    persistProductTokensToDisk(roots.productRegistry);
    entry = null;
  }

  const aliases = collectEquivalentEntries(roots.productRegistry, productId, now);
  if (!entry && aliases.length === 0) return null;
  if (aliases.length === 0) return entry;

  const base = entry || aliases[0];
  return {
    ...base,
    id: entry?.id || productId,
    immersivePageTokens: sanitizeTokenList([
      ...(base.immersivePageTokens || []),
      ...aliases.flatMap((a) => a.immersivePageTokens || []),
    ]),
    searchApiProductTokens: sanitizeTokenList([
      ...(base.searchApiProductTokens || []),
      ...aliases.flatMap((a) => a.searchApiProductTokens || []),
    ]),
  };
}

export function getCachedDiscovery(cacheKey, ttlMs = DEFAULT_DISCOVERY_TTL_MS) {
  const roots = getCacheRoots();
  const entry = roots.discovery.get(cacheKey);
  if (!entry) return null;
  if (Date.now() - entry.cachedAtMs >= ttlMs) {
    return null;
  }
  return entry;
}

export function setCachedDiscovery(cacheKey, payload, meta = {}) {
  const roots = getCacheRoots();
  const nowMs = Date.now();
  const ttlMs = meta.ttlMs || DEFAULT_DISCOVERY_TTL_MS;
  const entry = {
    payload,
    mode: meta.mode || "live",
    dataSource: meta.dataSource || "LIVE_OBSERVED",
    cachedAtMs: nowMs,
    cachedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + ttlMs).toISOString(),
    ttlSeconds: Math.round(ttlMs / 1000),
  };
  roots.discovery.set(cacheKey, entry);
  return entry;
}

export async function coalescedDiscoveryFetch(cacheKey, fetcherFn) {
  const roots = getCacheRoots();
  if (roots.discoveryInflight.has(cacheKey)) {
    return roots.discoveryInflight.get(cacheKey);
  }
  const promise = Promise.resolve()
    .then(fetcherFn)
    .finally(() => {
      roots.discoveryInflight.delete(cacheKey);
    });
  roots.discoveryInflight.set(cacheKey, promise);
  return promise;
}

export function getCachedComparison(cacheKey, ttlMs = DEFAULT_COMPARE_TTL_MS) {
  const roots = getCacheRoots();
  const entry = roots.compare.get(cacheKey);
  if (!entry) return null;
  if (Date.now() - entry.cachedAtMs >= ttlMs) {
    return null;
  }
  return entry;
}

export function setCachedComparison(cacheKey, payload, meta = {}) {
  const roots = getCacheRoots();
  const nowMs = Date.now();
  const ttlMs = meta.ttlMs || DEFAULT_COMPARE_TTL_MS;
  const entry = {
    payload,
    mode: meta.mode || "live",
    cachedAtMs: nowMs,
    cachedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + ttlMs).toISOString(),
    ttlSeconds: Math.round(ttlMs / 1000),
  };
  roots.compare.set(cacheKey, entry);
  return entry;
}

export async function coalescedComparisonFetch(cacheKey, fetcherFn) {
  const roots = getCacheRoots();
  if (roots.compareInflight.has(cacheKey)) {
    return roots.compareInflight.get(cacheKey);
  }
  const promise = Promise.resolve()
    .then(fetcherFn)
    .finally(() => {
      roots.compareInflight.delete(cacheKey);
    });
  roots.compareInflight.set(cacheKey, promise);
  return promise;
}
