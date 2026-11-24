/**
 * Display-time image URL sizing for third-party provider imagery.
 *
 * Provider/live feeds sometimes return original-resolution CDN URLs
 * (several MB for hero-sized photos) while the UI renders them inside
 * 40–300px containers. For CDNs that support query-based resizing
 * (Unsplash/imgix), we append safe parameters so the browser downloads a
 * display-sized asset instead.
 *
 * Rules:
 * - Curated catalog URLs are left untouched (they already carry
 *   `?auto=format&fit=crop&w=900&q=80`).
 * - URLs that already have a query string are left untouched — we never
 *   override provider-supplied sizing.
 * - Only known imgix-style hosts are touched; unknown retailer CDN URLs are
 *   returned verbatim so provider images can never break.
 */
const RESIZABLE_HOSTS = new Set([
  "images.unsplash.com",
  "plus.unsplash.com",
]);

export function optimizeImageUrl(src, width = 600, quality = 60) {
  if (!src || typeof src !== "string") return src;

  let url;
  try {
    url = new URL(src);
  } catch {
    return src;
  }

  if (!RESIZABLE_HOSTS.has(url.hostname)) return src;
  if (url.searchParams.has("w")) return src;

  url.searchParams.set("auto", "format");
  url.searchParams.set("fit", "max");
  url.searchParams.set("w", String(Math.round(width)));
  url.searchParams.set("q", String(quality));

  return url.toString();
}
