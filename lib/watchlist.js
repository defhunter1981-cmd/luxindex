const WATCHLIST_KEY = "luxeindex_watchlist_v1";
const RECENT_SEARCHES_KEY = "luxeindex_recent_searches_v1";
const COMPARISON_HISTORY_KEY = "luxeindex_comparison_history_v1";
const CLIENT_SNAPSHOTS_KEY = "luxeindex_live_snapshots_v1";

function safeParse(raw, fallback) {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export function getWatchlist() {
  if (typeof window === "undefined") return [];
  return safeParse(window.localStorage.getItem(WATCHLIST_KEY), []);
}

export function saveWatchlist(items = []) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WATCHLIST_KEY, JSON.stringify(items));
  } catch {
    // Ignore storage quota errors
  }
}

export function upsertWatchItem({
  id,
  name,
  brand,
  image,
  targetPrice,
  currency = "INR",
  lastObservedPrice = null,
  bestRetailer = null,
  isLive = false,
}) {
  const list = getWatchlist();
  const now = new Date().toISOString();
  const idx = list.findIndex((item) => item.id === id);

  const entry = {
    id,
    name,
    brand: brand || "",
    image: image || "",
    targetPrice: Number(targetPrice),
    currency,
    lastObservedPrice,
    bestRetailer,
    isLive,
    updatedAt: now,
    createdAt: idx >= 0 ? list[idx].createdAt : now,
  };

  const next =
    idx >= 0
      ? list.map((item, i) => (i === idx ? entry : item))
      : [entry, ...list].slice(0, 24);

  saveWatchlist(next);
  return next;
}

export function removeWatchItem(id) {
  const list = getWatchlist();
  const next = list.filter((item) => item.id !== id);
  saveWatchlist(next);
  return next;
}

export function getRecentSearches() {
  if (typeof window === "undefined") return [];
  return safeParse(window.localStorage.getItem(RECENT_SEARCHES_KEY), []);
}

export function pushRecentSearch(query) {
  if (typeof window === "undefined") return [];
  const trimmed = String(query || "").trim();
  if (!trimmed) return getRecentSearches();

  const existing = getRecentSearches();
  const next = [
    trimmed,
    ...existing.filter((q) => q.toLowerCase() !== trimmed.toLowerCase()),
  ].slice(0, 8);

  try {
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage errors
  }
  return next;
}

export function clearRecentSearches() {
  if (typeof window === "undefined") return [];
  try {
    window.localStorage.removeItem(RECENT_SEARCHES_KEY);
  } catch {
    // Ignore storage errors
  }
  return [];
}

export function getComparisonHistory() {
  if (typeof window === "undefined") return [];
  return safeParse(window.localStorage.getItem(COMPARISON_HISTORY_KEY), []);
}

export function pushComparisonHistory({
  id,
  name,
  brand,
  bestPrice,
  currency = "INR",
  bestStore = null,
  offerCount = 0,
  isLive = false,
}) {
  if (typeof window === "undefined" || !name) return [];
  const existing = getComparisonHistory();
  const entry = {
    id: id || name.toLowerCase().replace(/\s+/g, "-"),
    name,
    brand: brand || "",
    bestPrice,
    currency,
    bestStore,
    offerCount,
    isLive,
    comparedAt: new Date().toISOString(),
  };

  const next = [
    entry,
    ...existing.filter((item) => item.name.toLowerCase() !== name.toLowerCase()),
  ].slice(0, 10);

  try {
    window.localStorage.setItem(COMPARISON_HISTORY_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage errors
  }
  return next;
}

export function recordClientLiveObservation(productKey, point) {
  if (typeof window === "undefined" || !productKey || !point?.price) return [];
  const all = safeParse(window.localStorage.getItem(CLIENT_SNAPSHOTS_KEY), {});
  const list = Array.isArray(all[productKey]) ? [...all[productKey]] : [];
  const last = list[list.length - 1];

  const withinTenMinutes =
    last?.timestamp &&
    Date.now() - new Date(last.timestamp).getTime() < 10 * 60 * 1000 &&
    last.price === point.price;

  if (!withinTenMinutes) {
    list.push({
      ...point,
      dataSource: "LIVE_OBSERVED",
    });
  }

  const trimmed = list.slice(-90);
  all[productKey] = trimmed;
  try {
    window.localStorage.setItem(CLIENT_SNAPSHOTS_KEY, JSON.stringify(all));
  } catch {
    // Ignore storage errors
  }
  return trimmed;
}

export function getClientLiveObservations(productKey) {
  if (typeof window === "undefined" || !productKey) return [];
  const all = safeParse(window.localStorage.getItem(CLIENT_SNAPSHOTS_KEY), {});
  return Array.isArray(all[productKey]) ? all[productKey] : [];
}

