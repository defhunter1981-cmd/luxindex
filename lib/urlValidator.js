/**
 * Dedicated URL & Domain Validation Utility for LuxeIndex.
 *
 * Ensures "Go to Store" actions only ever open verified HTTP/HTTPS merchant
 * URLs belonging to recognized retailers, rejecting javascript:, Google Shopping
 * redirects, relative /goto proxies, and bare homepages while preserving valid
 * merchant tracking/affiliate parameters.
 */

export const RETAILER_ALLOWED_DOMAINS = {
  Sephora: ["sephora.nnnow.com", "sephora.com", "sephora.co.uk", "sephora.in"],
  Nykaa: ["nykaa.com", "nykaaman.com"],
  "Amazon Luxury": ["amazon.in", "amazon.com", "amazon.co.uk", "amazon.ae"],
  "Cult Beauty": ["cultbeauty.com", "cultbeauty.co.uk"],
  "Space NK": ["spacenk.com"],
  Myntra: ["myntra.com"],
  Flipkart: ["flipkart.com"],
  "Tira Beauty": ["tirabeauty.com"],
  Purplle: ["purplle.com"],
  "Ajio Luxe": ["ajio.com"],
  "Shoppers Stop": ["shoppersstop.com"],
  "Tata CLiQ": ["tatacliq.com"],
  Clinikally: ["clinikally.com"],
  Maccaron: ["maccaron.in"],
  JioMart: ["jiomart.com"],
  PharmEasy: ["pharmeasy.in"],
  "1mg": ["1mg.com"],
  "Tata 1mg": ["1mg.com"],
  Blinkit: ["blinkit.com"],
  Zepto: ["zepto.com", "zeptonow.com"],
  Instamart: ["swiggy.com"],
  "Swiggy Instamart": ["swiggy.com"],
  BigBasket: ["bigbasket.com"],
  Apollo247: ["apollo247.com"],
  "Apollo 247": ["apollo247.com"],
  "DMart Ready": ["dmart.in"],
  DawaaDost: ["dawaadost.com"],
  Minimalist: ["beminimalist.co"],
  "The Deconstruct": ["thedeconstruct.in"],
  Deconstruct: ["thedeconstruct.in"],
  Plum: ["plumgoodness.com"],
  "Dot & Key": ["dotandkey.com"],
  "The Derma Co": ["thedermaco.com"],
  Foxtale: ["foxtale.in"],
  Aqualogica: ["aqualogica.in"],
  Looknstyle: ["looknstyle.com"],
  Smytten: ["smytten.com"],
  HealthMug: ["healthmug.com"],
  "Beauty Barn": ["beautybarn.in"],
  Limese: ["limese.com"],
  Desertcart: ["desertcart.in", "desertcart.ae", "desertcart.com"],
  Ubuy: ["ubuy.co.in", "ubuy.com", "ubuy.ae"],
  "Ulta Beauty": ["ulta.com"],
  Nordstrom: ["nordstrom.com"],
  Dermstore: ["dermstore.com"],
  Meesho: ["meesho.com"],
  Kindlife: ["kindlife.in"],
  SweetCare: ["sweetcare.com"],
  StyleDotty: ["styledotty.com"],
  GoSupps: ["gosupps.com"],
  KIWLA: ["kiwla.com"],
  Foxy: ["foxy.in"],
  Boddess: ["boddess.com"],
};

const BLOCKED_HOSTS = [
  "google.com",
  "google.co.in",
  "google.co.uk",
  "google.ae",
  "googleadservices.com",
  "googlesyndication.com",
  "doubleclick.net",
  "serpapi.com",
  "goo.gl",
];

const SEARCH_PATH_PATTERNS = [
  /^\/search\b/i,
  /^\/s$/i,
  /^\/s\//i,
  /^\/sr$/i,
  /^\/elysium\.search/i,
];

const SEARCH_QUERY_KEYS = ["q", "search", "keyword", "text", "name", "k"];

function hostnameMatchesDomain(hostname = "", domain = "") {
  const h = hostname.toLowerCase().replace(/^www\./, "");
  const d = domain.toLowerCase().replace(/^www\./, "");
  return h === d || h.endsWith(`.${d}`);
}

export function isBlockedRedirectHost(hostname = "") {
  const lower = hostname.toLowerCase();
  if (lower.startsWith("google.") || lower.includes(".google.")) return true;
  return BLOCKED_HOSTS.some((blocked) => hostnameMatchesDomain(lower, blocked));
}

export function isSearchUrl(parsedUrl) {
  const path = parsedUrl.pathname || "/";
  if (SEARCH_PATH_PATTERNS.some((re) => re.test(path))) {
    return true;
  }

  // e.g. /products/?q=sunscreen or /search/all?name=serum
  if (path.toLowerCase().includes("search")) {
    return true;
  }

  // Check if path is shallow root-like with search query parameter (?q=...)
  const cleanSegments = path.split("/").filter(Boolean);
  if (cleanSegments.length <= 1) {
    for (const key of SEARCH_QUERY_KEYS) {
      if (parsedUrl.searchParams.has(key)) {
        return true;
      }
    }
  }
  return false;
}

export function isHomepageUrl(parsedUrl) {
  const cleanPath = (parsedUrl.pathname || "/").replace(/\/+$/, "");
  return cleanPath === "" && !parsedUrl.searchParams.toString();
}

export function isRecognizedMerchantHost(hostname, retailerName = "") {
  const allowedList = RETAILER_ALLOWED_DOMAINS[retailerName];
  if (allowedList) {
    return allowedList.some((d) => hostnameMatchesDomain(hostname, d));
  }

  // Check across any known beauty/e-commerce domain if retailerName varies
  for (const domains of Object.values(RETAILER_ALLOWED_DOMAINS)) {
    if (domains.some((d) => hostnameMatchesDomain(hostname, d))) {
      return true;
    }
  }

  // Dynamic Google Shopping merchant domain verification:
  // Accept if the cleaned retailer name appears meaningfully inside the hostname
  // or the retailer name itself is a valid domain.
  const hostCore = hostname.toLowerCase().replace(/^www\./, "");
  const merchantTokens = String(retailerName || "")
    .toLowerCase()
    .replace(/\.(com|in|co\.uk|ae|net|org|store|shop)$/i, "")
    .replace(/[^a-z0-9]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);

  return merchantTokens.some((tok) => hostCore.includes(tok));
}

/**
 * Validates a merchant URL strictly before rendering or storing it.
 *
 * @param {string|null|undefined} rawUrl
 * @param {string} retailerName
 * @param {{ allowSearchUrl?: boolean }} options
 */
export function validateRetailerProductUrl(
  rawUrl,
  retailerName = "",
  { allowSearchUrl = false, expectedProduct = null } = {}
) {
  if (!rawUrl || typeof rawUrl !== "string") {
    return {
      valid: false,
      url: null,
      linkType: "unavailable",
      hostname: null,
      reason: "Missing merchant URL",
    };
  }

  const trimmed = rawUrl.trim();

  // Explicitly block unsafe schemes or relative proxy paths like /goto?url=...
  if (!/^https?:\/\//i.test(trimmed)) {
    return {
      valid: false,
      url: null,
      linkType: "unavailable",
      hostname: null,
      reason: "Non-HTTP(S) or relative redirect URL rejected",
    };
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      valid: false,
      url: null,
      linkType: "unavailable",
      hostname: null,
      reason: "Malformed URL",
    };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      valid: false,
      url: null,
      linkType: "unavailable",
      hostname: null,
      reason: "Unsupported protocol",
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  if (isBlockedRedirectHost(hostname)) {
    return {
      valid: false,
      url: null,
      linkType: "unavailable",
      hostname,
      reason: "Google Shopping / proxy redirect host rejected",
    };
  }

  if (
    parsed.pathname.toLowerCase().startsWith("/goto") ||
    trimmed.toLowerCase().includes("ibp=oshop")
  ) {
    return {
      valid: false,
      url: null,
      linkType: "unavailable",
      hostname,
      reason: "Redirect wrapper rejected",
    };
  }

  if (!isRecognizedMerchantHost(hostname, retailerName)) {
    return {
      valid: false,
      url: null,
      linkType: "unavailable",
      hostname,
      reason: `Hostname "${hostname}" does not match recognized merchant "${retailerName}"`,
    };
  }

  if (isHomepageUrl(parsed)) {
    return {
      valid: false,
      url: null,
      linkType: "unavailable",
      hostname,
      reason: "Bare retailer homepage rejected",
    };
  }

  if (isSearchUrl(parsed)) {
    if (!allowSearchUrl) {
      return {
        valid: false,
        url: null,
        linkType: "unavailable",
        hostname,
        reason: "Retailer search page rejected where exact product URL is required",
      };
    }

    return {
      valid: true,
      url: parsed.toString(),
      linkType: "retailer_search",
      hostname: hostname.replace(/^www\./, ""),
      reason: "Validated retailer search link",
    };
  }

  if (expectedProduct && typeof expectedProduct === "object") {
    const mismatchReason = checkExpectedProductSlugConflict(
      parsed,
      hostname,
      expectedProduct
    );
    if (mismatchReason) {
      return {
        valid: false,
        url: null,
        linkType: "unavailable",
        hostname,
        reason: mismatchReason,
      };
    }
  }

  return {
    valid: true,
    url: parsed.toString(),
    linkType: "exact_product",
    hostname: hostname.replace(/^www\./, ""),
    reason: "Verified exact merchant product URL",
  };
}

const SLUG_KNOWN_BRANDS = [
  "minimalist",
  "neutrogena",
  "cerave",
  "cetaphil",
  "bioderma",
  "deconstruct",
  "plum",
  "foxtale",
  "aqualogica",
  "dot-and-key",
  "dot-key",
  "derma-co",
  "garnier",
  "lakme",
  "cosrx",
  "laneige",
  "ordinary",
  "requil",
  "reequil",
  "maybelline",
  "loreal",
  "nivea",
];

function checkExpectedProductSlugConflict(parsedUrl, hostname, expectedProduct) {
  let effectivePath = parsedUrl.pathname || "";
  const redirectParam = parsedUrl.searchParams.get("redirect");
  if (redirectParam && /^https?:\/\//i.test(redirectParam)) {
    try {
      effectivePath += " " + new URL(redirectParam).pathname;
    } catch {
      // Ignore unparseable redirect parameter
    }
  }

  const slugNorm = effectivePath
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!slugNorm) return null;

  const expectedBrandRaw = String(expectedProduct.brand || "").toLowerCase();
  const expectedBrandTokens = expectedBrandRaw
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 3);

  const expectedHostOwnsBrand =
    expectedBrandTokens.length > 0 &&
    expectedBrandTokens.some((tok) => hostname.includes(tok));

  if (
    expectedBrandTokens.length > 0 &&
    expectedBrandRaw !== "independent / other" &&
    !expectedHostOwnsBrand
  ) {
    const mentionsExpectedBrand = expectedBrandTokens.some((tok) =>
      new RegExp(`\\b${tok}\\b`, "i").test(slugNorm)
    );
    if (!mentionsExpectedBrand) {
      for (const otherBrand of SLUG_KNOWN_BRANDS) {
        const otherNorm = otherBrand.replace(/-/g, " ");
        if (
          !expectedBrandRaw.includes(otherNorm) &&
          new RegExp(`\\b${otherNorm}\\b`, "i").test(slugNorm)
        ) {
          return `URL path belongs to a different brand (${otherNorm})`;
        }
      }
    }
  }

  const expectedSizeMatch = String(expectedProduct.size || "").match(
    /(\d+(?:\.\d+)?)\s*(ml|g|gm)\b/i
  );
  const slugSizeMatch = slugNorm.match(/\b(\d+(?:\.\d+)?)\s*(ml|g|gm)\b/i);
  if (expectedSizeMatch && slugSizeMatch) {
    const expNum = Number(expectedSizeMatch[1]);
    const slugNum = Number(slugSizeMatch[1]);
    if (
      Number.isFinite(expNum) &&
      Number.isFinite(slugNum) &&
      Math.abs(expNum - slugNum) / Math.max(expNum, slugNum) > 0.1
    ) {
      return `URL size (${slugNum}${slugSizeMatch[2]}) conflicts with expected product (${expectedSizeMatch[1]}${expectedSizeMatch[2]})`;
    }
  }

  return null;
}

