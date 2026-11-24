import { normalizeText } from "@/lib/utils";

const QUERY_FILLER_TOKENS = new Set([
  "india",
  "in",
  "online",
  "price",
  "prices",
  "buy",
  "best",
  "original",
  "authentic",
  "the",
  "for",
  "with",
  "and",
  "or",
  "of",
  "to",
  "from",
  "at",
  "on",
  "a",
  "an",
]);

const FORM_SYNONYMS = {
  sunscreen: ["sunscreen", "sunblock", "spf", "uv", "sun"],
  sunblock: ["sunscreen", "sunblock", "spf"],
  moisturizer: [
    "moisturizer",
    "moisturiser",
    "moisturizing",
    "moisturising",
    "cream",
    "lotion",
    "gel",
    "hydrating",
    "barrier",
  ],
  moisturiser: [
    "moisturizer",
    "moisturiser",
    "moisturizing",
    "moisturising",
    "cream",
    "lotion",
    "gel",
    "hydrating",
    "barrier",
  ],
  serum: ["serum", "ampoule", "concentrate", "essence"],
  cleanser: ["cleanser", "facewash", "wash", "cleansing", "micellar"],
  toner: ["toner", "essence", "mist"],
  perfume: ["perfume", "parfum", "edp", "edt", "fragrance", "cologne", "mist"],
  lipbalm: ["lip", "balm", "mask", "butter"],
  vitamin: ["vitamin", "ascorbic"],
};

/**
 * Bounded Optimal String Alignment (Damerau-Levenshtein) supporting adjacent
 * transpositions (e.g. "neutorgena" <-> "neutrogena") as edit distance 1.
 */
function osaEditDistance(a = "", b = "") {
  const lenA = a.length;
  const lenB = b.length;
  if (Math.abs(lenA - lenB) > 2) return 99;

  const d = Array.from({ length: lenA + 1 }, () => new Array(lenB + 1).fill(0));
  for (let i = 0; i <= lenA; i += 1) d[i][0] = i;
  for (let j = 0; j <= lenB; j += 1) d[0][j] = j;

  for (let i = 1; i <= lenA; i += 1) {
    for (let j = 1; j <= lenB; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let val = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        val = Math.min(val, d[i - 2][j - 2] + 1);
      }
      d[i][j] = val;
    }
  }
  return d[lenA][lenB];
}

export function extractMeaningfulQueryTerms(query = "") {
  const norm = normalizeText(query);
  if (!norm) return [];

  const rawTokens = norm.split(/\s+/).filter(Boolean);
  const terms = [];

  for (let i = 0; i < rawTokens.length; i += 1) {
    const tok = rawTokens[i];
    if (QUERY_FILLER_TOKENS.has(tok)) continue;
    // Keep meaningful single-letter chemical markers like "c" in "vitamin c" or "e" in "vitamin e"
    if (tok.length === 1) {
      const prev = rawTokens[i - 1] || "";
      if (prev === "vitamin" && /^[a-z0-9]$/.test(tok)) {
        terms.push(tok);
      }
      continue;
    }
    if (!terms.includes(tok)) {
      terms.push(tok);
    }
  }
  return terms;
}

function doesTermMatchHaystack(term, haystackWords, haystackNorm) {
  if (!term || !haystackNorm) return false;

  if (term.length === 1) {
    return new RegExp(`\\bvitamin\\s*${term}\\b`, "i").test(haystackNorm);
  }

  if (/^\d+$/.test(term)) {
    return new RegExp(`\\b${term}\\b|\\bspf\\s*${term}\\b`, "i").test(haystackNorm);
  }

  if (haystackNorm.includes(term)) {
    return true;
  }

  const synonyms = FORM_SYNONYMS[term];
  if (synonyms) {
    for (const syn of synonyms) {
      if (haystackNorm.includes(syn)) return true;
    }
  }

  // Typo tolerance ONLY for real words >= 5 chars without long repeated junk chars
  if (term.length >= 5 && !/(.)\1{3,}/.test(term) && term.length <= 20) {
    const maxDist = term.length >= 9 ? 2 : 1;
    for (const word of haystackWords) {
      if (word.length < 4) continue;
      if (osaEditDistance(term, word) <= maxDist) {
        return true;
      }
    }
    for (const [synKey, synValues] of Object.entries(FORM_SYNONYMS)) {
      if (synKey.length < 5) continue;
      if (osaEditDistance(term, synKey) <= 1) {
        for (const syn of synValues) {
          if (haystackNorm.includes(syn)) return true;
        }
      }
    }
  }

  return false;
}

/**
 * Classifies query structure and evaluates whether a normalized product genuinely
 * matches the user's intent, filtering unrelated fuzzy Google matches and allowing
 * authentic typo recovery without hardcoding individual queries.
 */
export function evaluateProductQueryRelevance(product, query = "", queryProfile = null) {
  const terms = extractMeaningfulQueryTerms(query);
  if (terms.length === 0) {
    return { relevant: false, score: 0, matchedTerms: [], reason: "empty_query" };
  }

  const haystackRaw = [
    product?.title,
    product?.name,
    product?.rawTitle,
    product?.brand,
    product?.category,
    product?.productType,
    product?.variant,
    product?.spf,
    ...(product?.ingredients || []),
    ...(product?.productTypes || []),
  ]
    .filter(Boolean)
    .join(" ");

  const haystackNorm = normalizeText(haystackRaw);
  const haystackWords = haystackNorm.split(/\s+/).filter((w) => w.length >= 2);

  const matchedTerms = [];
  for (const term of terms) {
    if (doesTermMatchHaystack(term, haystackWords, haystackNorm)) {
      matchedTerms.push(term);
    }
  }

  const ratio = matchedTerms.length / terms.length;
  const matchedBrands = queryProfile?.matchedBrands || [];
  const isBrandTargeted = matchedBrands.length > 0;
  const searchMode = queryProfile?.intent?.searchMode || "discover";

  let brandMatched = true;
  if (isBrandTargeted) {
    const productBrandNorm = normalizeText(product?.brand || "");
    brandMatched = matchedBrands.some((expectedBrand) => {
      const expNorm = normalizeText(expectedBrand);
      return (
        productBrandNorm === expNorm ||
        productBrandNorm.includes(expNorm) ||
        haystackNorm.includes(expNorm) ||
        haystackWords.some((w) => expNorm.length >= 5 && osaEditDistance(expNorm, w) <= 1)
      );
    });
  }

  if (matchedTerms.length === 0) {
    return {
      relevant: false,
      score: 0,
      matchedTerms,
      reason: "zero_term_overlap",
    };
  }

  if (isBrandTargeted && !brandMatched) {
    return {
      relevant: false,
      score: ratio * 0.4,
      matchedTerms,
      reason: "requested_brand_absent",
    };
  }

  // Require stricter coverage on multi-term exact/brand searches vs 1-word categories
  const minRatio =
    searchMode === "compare_exact"
      ? 0.65
      : isBrandTargeted && terms.length >= 3
      ? 0.6
      : terms.length >= 2
      ? 0.5
      : 1;

  if (ratio < minRatio) {
    return {
      relevant: false,
      score: ratio,
      matchedTerms,
      reason: `insufficient_query_overlap (${matchedTerms.length}/${terms.length})`,
    };
  }

  return {
    relevant: true,
    score: Math.round((ratio + (brandMatched && isBrandTargeted ? 0.25 : 0)) * 100) / 100,
    matchedTerms,
    reason: "relevant",
  };
}

/**
 * Filters a product list against query relevance while also tolerating brand typos
 * in the query (e.g., "Neutorgena sunscreen") via queryProfile expansion.
 */
export function filterRelevantDiscoveryProducts(products = [], query = "", queryProfile = null) {
  if (!Array.isArray(products) || products.length === 0) return [];
  const scored = [];
  for (const prod of products) {
    const rel = evaluateProductQueryRelevance(prod, query, queryProfile);
    if (rel.relevant) {
      scored.push({ product: prod, relevanceScore: rel.score });
    }
  }
  return scored
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .map((entry) => entry.product);
}

export function isObviouslyNonsenseQuery(query = "") {
  const terms = extractMeaningfulQueryTerms(query);
  if (terms.length === 0) return true;

  // Reject queries consisting only of unpronounceable random alphanumeric junk tokens
  return terms.every((tok) => {
    if (/^\d{4,}$/.test(tok)) return true;
    if (/(.)\1{3,}/.test(tok)) return true;
    if (tok.length >= 16 && !/[aeiou]{1,2}/.test(tok)) return true;
    if (tok.length >= 12 && /[0-9]/.test(tok) && /[a-z]/.test(tok) && /(.)\1{2,}|xyz|qwe|asd|zxc/.test(tok)) {
      return true;
    }
    return false;
  });
}

