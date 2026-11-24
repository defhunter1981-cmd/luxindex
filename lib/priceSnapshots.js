import fs from "node:fs/promises";
import path from "node:path";

const SNAPSHOT_FILE = path.join(process.cwd(), "data", "priceSnapshots.json");
const MAX_SNAPSHOTS_PER_PRODUCT = 90;
const DEDUPE_INTERVAL_MS = 30 * 60 * 1000;

function getMemoryStore() {
  if (!globalThis.__luxePriceSnapshots) {
    globalThis.__luxePriceSnapshots = {};
  }
  return globalThis.__luxePriceSnapshots;
}

async function readAllSnapshots() {
  const memory = getMemoryStore();
  try {
    const raw = await fs.readFile(SNAPSHOT_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      Object.assign(memory, parsed);
      return parsed;
    }
  } catch {
    // Fallback to in-memory snapshot map when disk file doesn't exist yet
  }
  return memory;
}

async function writeAllSnapshots(store) {
  const memory = getMemoryStore();
  Object.assign(memory, store);
  try {
    await fs.writeFile(SNAPSHOT_FILE, JSON.stringify(store, null, 2), "utf8");
  } catch {
    // Graceful no-op on read-only file systems; in-memory ledger remains active
  }
}

export function buildSnapshotKey(productIdOrQuery = "", currency = "INR") {
  const normalized = String(productIdOrQuery || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${normalized || "unknown"}::${String(currency || "INR").toUpperCase()}`;
}

export function formatShortDate(isoTimestamp) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "2-digit",
    }).format(new Date(isoTimestamp));
  } catch {
    return "Today";
  }
}

/**
 * Records a genuine live observed SerpApi price snapshot and returns
 * the chronological observation history for that product & currency.
 */
export async function recordLivePriceSnapshot({
  productKey,
  productName,
  lowestPrice,
  highestPrice,
  currency = "INR",
  bestRetailer,
  offerCount,
}) {
  if (!productKey || typeof lowestPrice !== "number" || lowestPrice <= 0) {
    return [];
  }

  const store = await readAllSnapshots();
  const nowIso = new Date().toISOString();
  const existing = Array.isArray(store[productKey]) ? [...store[productKey]] : [];

  const last = existing[existing.length - 1];
  const lastMs = last?.timestamp ? new Date(last.timestamp).getTime() : 0;
  const elapsedMs = Date.now() - lastMs;

  const isDuplicateWithinWindow =
    last &&
    elapsedMs >= 0 &&
    elapsedMs < DEDUPE_INTERVAL_MS &&
    last.price === lowestPrice &&
    last.bestRetailer === bestRetailer;

  if (!isDuplicateWithinWindow) {
    existing.push({
      timestamp: nowIso,
      date: formatShortDate(nowIso),
      price: lowestPrice,
      highPrice: highestPrice || lowestPrice,
      currency: String(currency || "INR").toUpperCase(),
      bestRetailer: bestRetailer || null,
      offerCount: offerCount || 1,
      productName,
      dataSource: "LIVE_OBSERVED",
    });
  }

  const trimmed = existing.slice(-MAX_SNAPSHOTS_PER_PRODUCT);
  store[productKey] = trimmed;
  await writeAllSnapshots(store);

  return trimmed;
}

export async function getRecordedPriceSnapshots(productKey) {
  if (!productKey) return [];
  const store = await readAllSnapshots();
  return Array.isArray(store[productKey]) ? store[productKey] : [];
}

