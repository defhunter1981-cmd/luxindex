import { areFormulationsCompatible, normalizeText } from "@/lib/utils";

const STOP_WORDS = new Set([
  "the",
  "for",
  "with",
  "and",
  "with",
  "skin",
  "face",
  "daily",
  "protection",
  "women",
  "men",
  "unisex",
  "all",
  "types",
  "broad",
  "spectrum",
  "pa",
  "new",
  "original",
]);

function tokenizeIdentityTitle(text = "", brand = "") {
  const brandNorm = normalizeText(brand);
  const words = normalizeText(text)
    .replace(/\b\d+(?:\.\d+)?\s*(?:ml|g|gm|oz|fl\s*oz|l|kg)\b/g, " ")
    .replace(/\bspf\s*\d+\+?\b/g, " ")
    .replace(/\bpa\+{1,4}\b/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w) && w !== brandNorm);

  return new Set(words);
}

function jaccardSimilarity(setA, setB) {
  if (!setA.size || !setB.size) return 0;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function areSizesCompatible(itemA, itemB) {
  const sizeA = itemA?.sizeInfo?.normalizedBaseMlOrG;
  const sizeB = itemB?.sizeInfo?.normalizedBaseMlOrG;
  const unitA = itemA?.sizeInfo?.normalizedBaseUnit;
  const unitB = itemB?.sizeInfo?.normalizedBaseUnit;

  if (sizeA && sizeB) {
    if (unitA && unitB && unitA !== unitB) {
      return { compatible: false, exact: false, conflict: `size unit mismatch (${itemA.size} vs ${itemB.size})` };
    }
    const diffRatio = Math.abs(sizeA - sizeB) / Math.max(sizeA, sizeB);
    if (diffRatio > 0.05) {
      return { compatible: false, exact: false, conflict: `size mismatch (${itemA.size} vs ${itemB.size})` };
    }
    return { compatible: true, exact: true, conflict: null };
  }

  if (sizeA || sizeB) {
    return { compatible: true, exact: false, conflict: "one listing missing size" };
  }

  return { compatible: true, exact: false, conflict: null };
}

function normalizeFormFactor(productType = "") {
  const t = normalizeText(productType);
  if (!t) return null;
  if (t.includes("serum")) return "serum";
  if (t.includes("cleanser") || t.includes("face wash")) return "cleanser";
  if (t.includes("toner")) return "toner";
  if (t.includes("mist") || t.includes("spray")) return "spray";
  if (t.includes("stick")) return "stick";
  if (t.includes("oil")) return "oil";
  if (t.includes("balm")) return "balm";
  if (t.includes("mask")) return "mask";
  if (t.includes("gel") || t.includes("fluid") || t.includes("lotion") || t.includes("cream") || t.includes("moisturizer")) {
    return "emulsion";
  }
  if (t.includes("edp") || t.includes("parfum") || t.includes("edt") || t.includes("toilette") || t.includes("fragrance")) {
    return t;
  }
  return t;
}

function isKnownBrand(brandNorm) {
  return (
    Boolean(brandNorm) &&
    brandNorm !== "independent / other" &&
    brandNorm !== "independent beauty"
  );
}

/**
 * Compares two normalized product records and classifies match confidence
 * (`high`, `medium`, `low`) without ever silently merging different sizes,
 * SPF ratings, concentrations, shades, pack counts, or distinct product lines.
 */
export function scoreProductMatch(itemA, itemB) {
  const conflicts = [];
  const reasons = [];

  if (!itemA || !itemB) {
    return { confidence: "low", score: 0, canMerge: false, reasons, conflicts: ["missing item"] };
  }

  const brandA = normalizeText(itemA.brand || "");
  const brandB = normalizeText(itemB.brand || "");
  const knownBrandA = isKnownBrand(brandA);
  const knownBrandB = isKnownBrand(brandB);

  if (knownBrandA && knownBrandB && brandA !== brandB) {
    conflicts.push(`brand mismatch (${itemA.brand} vs ${itemB.brand})`);
  } else if (knownBrandA && knownBrandB && brandA === brandB) {
    reasons.push("exact_brand");
  }

  const spfA = normalizeText(itemA.spfTier || itemA.spf || "");
  const spfB = normalizeText(itemB.spfTier || itemB.spf || "");
  if (spfA && spfB && spfA !== spfB) {
    conflicts.push(`SPF mismatch (${itemA.spfTier} vs ${itemB.spfTier})`);
  } else if (spfA && spfB && spfA === spfB) {
    reasons.push("exact_spf");
  } else if (Boolean(spfA) !== Boolean(spfB)) {
    conflicts.push("one item specifies SPF while the other does not");
  }

  const concA = normalizeText(itemA.concentration || "");
  const concB = normalizeText(itemB.concentration || "");
  if (concA && concB && concA !== concB) {
    conflicts.push(`concentration mismatch (${itemA.concentration} vs ${itemB.concentration})`);
  }

  const shadeA = normalizeText(itemA.shade || "");
  const shadeB = normalizeText(itemB.shade || "");
  if (shadeA && shadeB && shadeA !== shadeB) {
    conflicts.push(`shade mismatch (${itemA.shade} vs ${itemB.shade})`);
  } else if (Boolean(shadeA) !== Boolean(shadeB)) {
    conflicts.push("tinted vs untinted variant mismatch");
  }

  const packA = Number(itemA.packCount || 1);
  const packB = Number(itemB.packCount || 1);
  if (packA !== packB) {
    conflicts.push(`pack count mismatch (${packA} vs ${packB})`);
  }

  const formA = normalizeFormFactor(itemA.productType);
  const formB = normalizeFormFactor(itemB.productType);
  if (formA && formB && formA !== formB) {
    conflicts.push(`product form mismatch (${itemA.productType} vs ${itemB.productType})`);
  }

  if (!areFormulationsCompatible(itemA.formulation || itemA.title, itemB.formulation || itemB.title)) {
    conflicts.push(
      `formulation mismatch (${itemA.formulation || "base"} vs ${itemB.formulation || "base"})`
    );
  }

  const sizeCheck = areSizesCompatible(itemA, itemB);
  if (!sizeCheck.compatible) {
    conflicts.push(sizeCheck.conflict);
  } else if (sizeCheck.exact) {
    reasons.push("exact_size");
  }

  if (conflicts.length > 0) {
    return {
      confidence: "low",
      score: 0,
      canMerge: false,
      reasons,
      conflicts,
    };
  }

  // Exact canonical key match with compatible attributes
  const canonicalEqual =
    Boolean(itemA.canonicalProductId && itemB.canonicalProductId) &&
    itemA.canonicalProductId === itemB.canonicalProductId;

  const tokensA = tokenizeIdentityTitle(itemA.rawTitle || itemA.title, itemA.brand);
  const tokensB = tokenizeIdentityTitle(itemB.rawTitle || itemB.title, itemB.brand);
  const tokenSim = jaccardSimilarity(tokensA, tokensB);

  let score = tokenSim * 0.65;
  if (reasons.includes("exact_brand")) score += 0.2;
  if (reasons.includes("exact_size")) score += 0.15;
  if (canonicalEqual) score = Math.max(score, 0.88);

  const boundedScore = Math.round(Math.min(1, score) * 100) / 100;

  // High confidence merge requires zero hard conflicts, same brand (when known),
  // matching size when present (never merging size-present with size-missing on ambiguous titles),
  // and strong identity similarity or identical canonical key.
  const canMergeHigh =
    canonicalEqual ||
    (boundedScore >= 0.78 &&
      tokenSim >= 0.6 &&
      (!sizeCheck.conflict || tokenSim >= 0.8));

  if (canMergeHigh) {
    return {
      confidence: "high",
      score: boundedScore,
      canMerge: true,
      reasons: canonicalEqual ? [...reasons, "canonical_key"] : [...reasons, "token_similarity"],
      conflicts: [],
    };
  }

  if (boundedScore >= 0.5 && tokenSim >= 0.4) {
    return {
      confidence: "medium",
      score: boundedScore,
      canMerge: false,
      reasons,
      conflicts: sizeCheck.conflict ? [sizeCheck.conflict] : ["insufficient identity certainty to merge"],
    };
  }

  return {
    confidence: "low",
    score: boundedScore,
    canMerge: false,
    reasons,
    conflicts: ["distinct product"],
  };
}
