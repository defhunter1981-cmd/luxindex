import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export const USD_TO_INR_RATE = 84.5;

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export function normalizeText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9%+.\/\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function convertCurrency(amount, fromCurrency = "INR", toCurrency = "INR") {
  if (amount == null || Number.isNaN(Number(amount))) return null;
  const numeric = Number(amount);
  const from = String(fromCurrency || "INR").toUpperCase();
  const to = String(toCurrency || "INR").toUpperCase();

  if (from === to) return numeric;
  if (from === "INR" && to === "USD") {
    return Math.round((numeric / USD_TO_INR_RATE) * 100) / 100;
  }
  if (from === "USD" && to === "INR") {
    return Math.round(numeric * USD_TO_INR_RATE);
  }
  return numeric;
}

export function formatPrice(amount, currency = "INR") {
  if (amount == null || Number.isNaN(Number(amount))) return "—";
  const code = String(currency || "INR").toUpperCase() === "USD" ? "USD" : "INR";
  const locale = code === "INR" ? "en-IN" : "en-US";

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: code,
    minimumFractionDigits: code === "USD" ? 2 : 0,
    maximumFractionDigits: code === "USD" ? 2 : 0,
  }).format(Number(amount));
}

export function parsePriceString(raw, fallbackCurrency = "INR") {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return { amount: raw, currency: fallbackCurrency };
  }
  if (!raw) return { amount: null, currency: fallbackCurrency };

  const text = String(raw).trim();
  let currency = fallbackCurrency;
  if (text.includes("$") || /USD/i.test(text)) {
    currency = "USD";
  } else if (text.includes("₹") || /INR|Rs\.?/i.test(text)) {
    currency = "INR";
  }

  const cleaned = text.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  const parsed = cleaned ? parseFloat(cleaned[0]) : NaN;

  return {
    amount: Number.isFinite(parsed) ? parsed : null,
    currency,
  };
}

function normalizeVolumeToken(numStr, rawUnit) {
  let unit = String(rawUnit || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\./g, "")
    .trim();
  if (unit === "gm" || unit === "gms" || unit === "grm" || unit === "grms" || unit === "grams" || unit === "gram") {
    unit = "g";
  }
  if (unit === "litre" || unit === "litres" || unit === "liter" || unit === "liters") {
    unit = "l";
  }
  if (unit === "ounce" || unit === "ounces") unit = "oz";
  if (unit === "fluid ounce" || unit === "fluid ounces" || unit === "fl oz") {
    unit = "fl oz";
  }
  return `${numStr}${unit === "fl oz" ? " fl oz" : unit}`;
}

function volumeToApproxMl(volString) {
  if (!volString) return null;
  const match = String(volString).match(/^(\d+(?:\.\d+)?)\s*(ml|l|oz|fl oz)$/i);
  if (!match) return null;
  const num = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === "ml") return num;
  if (unit === "l") return num * 1000;
  if (unit === "oz" || unit === "fl oz") return num * 29.5735;
  return null;
}

export function volumesCompatible(targetVol, candVol) {
  if (!targetVol || !candVol) return false;
  if (targetVol.toLowerCase() === candVol.toLowerCase()) return true;

  // Liquid volume units (ml / l / fl oz) NEVER match solid weight units (g / kg).
  const targetMl = volumeToApproxMl(targetVol);
  const candMl = volumeToApproxMl(candVol);
  if (targetMl && candMl) {
    const diffRatio = Math.abs(targetMl - candMl) / Math.max(targetMl, candMl);
    return diffRatio <= 0.06;
  }
  return false;
}

const FORMULATION_RULES = [
  { key: "light-fluid", label: "Light Fluid", pattern: /\blight\s*[-\s]?fluid\b|\bultra[-\s]*light(?:weight)?\s*fluid\b/i },
  { key: "multi-vitamin", label: "Multi-Vitamin", pattern: /\bmulti[-\s]?vitamins?\b/i },
  { key: "aqua-gel", label: "Aqua Gel", pattern: /\baqua[-\s]*gel\b/i },
  { key: "silicone-gel", label: "Silicone Gel", pattern: /\bsilicone\s*gel\b/i },
  { key: "matte-gel", label: "Matte Gel", pattern: /\bmatte\s*gel\b/i },
  { key: "ultra-sheer", label: "Ultra Sheer", pattern: /\bultra\s*sheer\b/i },
  { key: "hydro-boost", label: "Hydro Boost", pattern: /\bhydro\s*boost\b/i },
  { key: "sun-stick", label: "Sun Stick", pattern: /\bsun\s*stick\b|\bstick\b/i },
  { key: "tinted", label: "Tinted", pattern: /\btinted\b/i },
  { key: "spray", label: "Spray", pattern: /\bspray\b/i },
  { key: "mist", label: "Mist", pattern: /\bmist\b/i },
  { key: "milk", label: "Milk", pattern: /\bsun\s*milk\b|\bmilk\b/i },
  { key: "mousse", label: "Mousse", pattern: /\bmousse\b/i },
  { key: "serum", label: "Serum", pattern: /\bsun\s*serum\b|\bface\s*serum\b|\bserum\b/i },
  { key: "lotion", label: "Lotion", pattern: /\blotion\b/i },
  { key: "cream", label: "Cream", pattern: /\bsun\s*cream\b|\bcream\b|\bcreme\b/i },
  { key: "gel", label: "Gel", pattern: /\bgel\b/i },
  { key: "fluid", label: "Fluid", pattern: /\bfluid\b/i },
  { key: "matte", label: "Matte", pattern: /\bultra[-\s]*matte\b|\bmatte\b/i },
  { key: "invisible", label: "Invisible", pattern: /\binvisible\b/i },
  { key: "dewy", label: "Dewy", pattern: /\bdewy\b/i },
];

export function extractFormulationSignature(text = "") {
  const input = String(text || "");
  const matched = [];
  for (const rule of FORMULATION_RULES) {
    if (rule.pattern.test(input)) {
      matched.push(rule);
    }
  }
  if (matched.length === 0) {
    return { formulation: null, formulationLabel: null, formulationTags: [] };
  }
  // If both "fluid" and "light-fluid" hit, "light-fluid" wins because it appears first;
  // if "cream" and generic "fluid" hit (e.g. "Fluid Water and Sweat Resistant, Sun Cream"), "cream" wins.
  const primary = matched[0];
  return {
    formulation: primary.key,
    formulationLabel: primary.label,
    formulationTags: matched.map((r) => r.key),
  };
}

export function areFormulationsCompatible(targetForm, candForm, candTags = [], targetTags = []) {
  if (!targetForm || !candForm) return false;
  if (targetForm === candForm) return true;

  // "Light Fluid" is strictly its own line (distinct from "Multi-Vitamin", "Cream", "Gel", "Fluid Cream", etc.).
  if (targetForm === "light-fluid" || candForm === "light-fluid") {
    return targetForm === candForm;
  }

  // Same specific line tag (e.g. both "multi-vitamin" with one adding "cream") aligns without cross-line mixing.
  const sharedSpecific =
    (targetForm === "multi-vitamin" && candTags.includes("multi-vitamin")) ||
    (candForm === "multi-vitamin" && targetTags.includes("multi-vitamin"));
  if (sharedSpecific) {
    const conflictingOther = ["gel", "aqua-gel", "lotion", "serum", "spray", "sun-stick", "tinted"].some(
      (t) => targetTags.includes(t) !== candTags.includes(t)
    );
    return !conflictingOther;
  }

  return false;
}

function extractPackQuantity(normalized = "") {
  const explicitPatterns = [
    /(?:pack\s*of|set\s*of|combo\s*of)\s*(\d+)\b/i,
    /\b(\d+)\s*[x*]\s*\d+(?:\.\d+)?\s*(?:ml|g|gm|gms|grm|grms|grams|gram|kg|oz|fl\.?\s*oz|l)\b/i,
    /\d+(?:\.\d+)?\s*(?:ml|g|gm|gms|grm|grms|grams|gram|kg|oz|fl\.?\s*oz|l)\s*[x*]\s*(\d+)\b/i,
    /\b(\d+)\s*(?:-\s*)?(?:pack|pcs|pieces|piece|ea|bottles|tubes)\b/i,
  ];
  for (const re of explicitPatterns) {
    const m = normalized.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n >= 2 && n <= 24) return n;
    }
  }
  if (/\b(?:twin\s*pack|duo|buy\s*1\s*get\s*1|b1g1|bogo)\b/i.test(normalized)) {
    return 2;
  }
  if (/\btrio\b/i.test(normalized)) {
    return 3;
  }
  return 1;
}

/**
 * Extracts normalized size/volume, concentration, SPF, bundle count, mini flags,
 * and formulation descriptors from a product title or query so distinct variants
 * are never falsely merged or compared as equal.
 */
export function extractVariantSignature(text = "") {
  const normalized = String(text || "").toLowerCase();

  const volRegex =
    /(\d+(?:\.\d+)?)\s*(ml|g|gm|gms|grm|grms|grams|gram|kg|litres?|liters?|fluid\s*ounces?|ounces?|fl\.?\s*oz|oz|l)\b/gi;
  const matches = [...normalized.matchAll(volRegex)];
  const volumes = matches.map((m) => normalizeVolumeToken(m[1], m[2]));

  // Prefer metric ml/g/kg/l when both metric and oz parentheticals appear, else first match
  const volume =
    volumes.find((v) => /(?:ml|g|kg|l)$/i.test(v)) || volumes[0] || null;

  let sizeValue = null;
  let sizeUnit = null;
  if (volume) {
    const unitMatch = volume.match(/^(\d+(?:\.\d+)?)\s*(ml|g|kg|l|oz|fl oz)$/i);
    if (unitMatch) {
      sizeValue = parseFloat(unitMatch[1]);
      sizeUnit = unitMatch[2].toLowerCase();
    }
  }

  // Detect multiple unrelated product sizes in one listing (e.g. "100ml + 100g" or "19 ounce & 16 fluid ounce")
  const distinctMetricOrOz = [];
  for (const v of volumes) {
    if (!distinctMetricOrOz.some((existing) => volumesCompatible(existing, v))) {
      distinctMetricOrOz.push(v);
    }
  }
  const hasMultiSizeCombo = distinctMetricOrOz.length >= 2;

  const spfMatch = normalized.match(/spf\s*(\d+\+?)/i);
  const spf = spfMatch ? `spf ${spfMatch[1].toLowerCase()}` : null;

  const concMatch = normalized.match(/(\d+(?:\.\d+)?%)/);
  const concentration = concMatch ? concMatch[1] : null;

  const packCount = extractPackQuantity(normalized);

  const isBundle =
    packCount > 1 ||
    hasMultiSizeCombo ||
    /\b(bundle|combo|duo|trio|twin\s*pack|value set|gift set|care set|2-piece|kit|set of \d+|buy\s*1\s*get\s*1|b1g1|bogo)\b/i.test(
      normalized
    ) ||
    /\b(?:set\s*\d+\.\d+|\bplus\b.*\b(?:mask|balm|cream|serum|cleanser|essence|toner)\b)/i.test(
      normalized
    );

  const isMini =
    /\b(mini|travel size|trial pack|sample|sachet|deluxe mini|tester)\b/i.test(
      normalized
    );

  const formInfo = extractFormulationSignature(normalized);

  return {
    volume,
    sizeValue,
    sizeUnit,
    spf,
    concentration,
    packCount,
    isBundle,
    isMini,
    formulation: formInfo.formulation,
    formulationLabel: formInfo.formulationLabel,
    formulationTags: formInfo.formulationTags,
  };
}

const GENERIC_BEAUTY_CATEGORIES = new Set([
  "sunscreen",
  "serum",
  "serums",
  "moisturizer",
  "moisturizers",
  "cleanser",
  "cleansers",
  "skincare",
  "makeup",
  "fragrance",
  "fragrances",
  "haircare",
  "lip mask",
  "hair oil",
  "blush",
  "toner",
  "essence",
]);

export function isBroadCategoryQuery(query = "") {
  const norm = normalizeText(query);
  if (!norm) return true;
  if (GENERIC_BEAUTY_CATEGORIES.has(norm)) return true;
  const tokens = norm.split(" ").filter((t) => t.length > 2);
  return tokens.length <= 1;
}

const KNOWN_BEAUTY_BRANDS = [
  "the ordinary",
  "la roche posay",
  "estee lauder",
  "sol de janeiro",
  "charlotte tilbury",
  "augustinus bader",
  "paula s choice",
  "paulas choice",
  "beauty of joseon",
  "rare beauty",
  "drunk elephant",
  "glow recipe",
  "summer fridays",
  "the derma co",
  "dot and key",
  "pat mcgrath",
  "carolina herrera",
  "giorgio armani",
  "conscious chemist",
  "forest essentials",
  "kama ayurveda",
  "kay beauty",
  "dr sheth",
  "re equil",
  "reequil",
  "uv doux",
  "round lab",
  "la mer",
  "jo malone",
  "tom ford",
  "le labo",
  "cerave",
  "cosrx",
  "laneige",
  "skinceuticals",
  "minimalist",
  "deconstruct",
  "foxtale",
  "aqualogica",
  "fixderma",
  "wishcare",
  "mamaearth",
  "hyphen",
  "olaplex",
  "kerastase",
  "tatcha",
  "clinique",
  "kiehls",
  "bioderma",
  "neutrogena",
  "cetaphil",
  "aveeno",
  "eucerin",
  "innisfree",
  "sulwhasoo",
  "hourglass",
  "diptyque",
  "byredo",
  "skin1004",
  "mixsoon",
  "isntree",
  "torriden",
  "biodance",
  "lancome",
  "glossier",
  "shiseido",
  "garnier",
  "chanel",
  "versace",
  "gucci",
  "prada",
  "fenty",
  "rhode",
  "nars",
  "dior",
  "ysl",
  "gisou",
  "anua",
  "plum",
];

const DISTINCT_SUBLINE_KEYWORDS = [
  "eye",
  "eyelid",
  "cleansing balm",
  "glowy balm",
  "lip balm",
  "dual essence",
  "all in one",
  "salicylic",
  "acne",
  "foaming",
  "sa smoothing",
  "body wash",
  "moisturizing lotion",
  "whitening",
  "toner",
  "ampoule",
  "sheet mask",
  "rescue solution",
  "revitalizing supreme",
];

const FLAVOR_OR_SHADE_KEYWORDS = [
  "berry",
  "sweet candy",
  "gummy bear",
  "vanilla",
  "grapefruit",
  "mint choco",
  "apple lime",
  "peach iced tea",
  "peach",
  "chocolate",
  "mango",
  "watermelon",
  "cotton candy",
  "matcha",
  "lemon",
  "taro",
];

function detectQueryBrand(queryNorm) {
  for (const brand of KNOWN_BEAUTY_BRANDS) {
    if (queryNorm.includes(brand)) return brand;
  }
  return null;
}

/**
 * Verifies whether a candidate retailer listing represents the same product/variant
 * as the reference query or lead product.
/**
 * Classifies a candidate retailer listing against a target product + variant into:
 * - "exact": Confirmed same product AND every verifiable variant axis matches without omission.
 * - "unverified": Confirmed same product line with no conflicting variant attributes,
 *   but retailer omitted explicit size, SPF, pack, concentration, or formulation details.
 * - "variant": Confirmed same product family with an explicit variant difference
 *   (size/unit, pack count, SPF, formulation, concentration, or shade/flavor).
 * - "unrelated": Different brand, sub-line, or unrelated product.
 */
export function evaluateVariantComparison({
  query = "",
  candidateTitle = "",
  candidateUrl = "",
  candidateSource = "",
  candidateMetadata = "",
  referenceTitle = "",
  expectedVolume = null,
  expectedSpf = null,
  expectedConcentration = null,
  expectedPackCount = null,
  expectedFormulation = null,
  expectedFormulationLabel = null,
  expectedFormulationTags = [],
}) {
  const candNorm = normalizeText(candidateTitle);
  const metaNorm = normalizeText(candidateMetadata);
  const sourceNorm = normalizeText(
    typeof candidateSource === "string" ? candidateSource : ""
  );
  let urlHostNorm = "";
  try {
    if (candidateUrl && /^https?:\/\//i.test(String(candidateUrl).trim())) {
      urlHostNorm = normalizeText(
        new URL(String(candidateUrl).trim()).hostname.replace(/^www\./i, "")
      );
    }
  } catch {
    urlHostNorm = "";
  }
  const urlSlugNorm = normalizeText(
    String(candidateUrl || "").replace(/^https?:\/\/[^/]+/i, " ")
  );
  const combinedNorm = `${candNorm} ${urlSlugNorm}`.trim();
  const candInspectNorm = `${candNorm} ${metaNorm} ${urlSlugNorm}`.trim();
  const brandAwareNorm = `${candInspectNorm} ${sourceNorm} ${urlHostNorm}`.trim();
  const queryNorm = normalizeText(query);
  const refNorm = normalizeText(referenceTitle || query);

  if (!candNorm) {
    return {
      classification: "unrelated",
      isExactVariant: false,
      isMatch: false,
      matchStatus: "unrelated",
      variantStatusLabel: null,
      reason: "Missing listing title",
      variantDifferences: [],
      missingVariantFields: [],
      detectedVolume: null,
      detectedSpf: null,
      detectedConcentration: null,
      detectedPackCount: 1,
      detectedFormulation: null,
      detectedFormulationLabel: null,
    };
  }

  const querySig = extractVariantSignature(query);
  const refSig = extractVariantSignature(referenceTitle);
  const expVolSig = expectedVolume ? extractVariantSignature(expectedVolume) : null;
  const expFormSig = expectedFormulation
    ? extractFormulationSignature(expectedFormulationLabel || expectedFormulation)
    : null;
  const candSig = extractVariantSignature(`${candidateTitle} ${candidateMetadata} ${urlSlugNorm}`);
  const broad = isBroadCategoryQuery(query) && !referenceTitle;

  const targetVolume =
    querySig.volume ||
    expVolSig?.volume ||
    (!broad ? refSig.volume : null) ||
    null;

  const targetSpf =
    querySig.spf ||
    (expectedSpf ? extractVariantSignature(expectedSpf).spf : null) ||
    (!broad ? refSig.spf : null) ||
    null;

  const targetConcentration =
    querySig.concentration ||
    expectedConcentration ||
    (!broad ? refSig.concentration : null) ||
    null;

  const parsedExpectedPack =
    typeof expectedPackCount === "number" && expectedPackCount > 1
      ? expectedPackCount
      : null;
  const targetPackCount =
    querySig.packCount > 1
      ? querySig.packCount
      : parsedExpectedPack || (!broad && refSig.packCount > 1 ? refSig.packCount : 1);
  const targetIsBundle = Boolean(
    targetPackCount > 1 || querySig.isBundle || (!broad && refSig.isBundle)
  );
  const targetIsMini = Boolean(querySig.isMini || (!broad && refSig.isMini));

  const targetFormulation =
    querySig.formulation ||
    expFormSig?.formulation ||
    expectedFormulation ||
    (!broad ? refSig.formulation : null) ||
    null;
  const targetFormulationLabel =
    querySig.formulationLabel ||
    expectedFormulationLabel ||
    expFormSig?.formulationLabel ||
    (!broad ? refSig.formulationLabel : null) ||
    null;
  const targetFormulationTags = Array.from(
    new Set([
      ...(querySig.formulationTags || []),
      ...(expFormSig?.formulationTags || []),
      ...(Array.isArray(expectedFormulationTags) ? expectedFormulationTags : []),
      ...(!broad ? refSig.formulationTags || [] : []),
    ])
  );

  const baseResult = (fields) => ({
    detectedVolume: candSig.volume || null,
    detectedSpf: candSig.spf || null,
    detectedConcentration: candSig.concentration || null,
    detectedPackCount: candSig.packCount || 1,
    detectedFormulation: candSig.formulation || null,
    detectedFormulationLabel: candSig.formulationLabel || null,
    candidateSignature: candSig,
    targetSignature: {
      volume: targetVolume,
      spf: targetSpf,
      concentration: targetConcentration,
      packCount: targetPackCount,
      isBundle: targetIsBundle,
      isMini: targetIsMini,
      formulation: targetFormulation,
      formulationLabel: targetFormulationLabel,
    },
    variantDifferences: [],
    missingVariantFields: [],
    variantStatusLabel: null,
    ...fields,
  });

  // 1. Enforce explicit brand presence if target specifies a recognized beauty brand
  const requestedBrand = detectQueryBrand(`${queryNorm} ${referenceTitle ? refNorm : ""}`);
  if (requestedBrand) {
    const compactedHost = urlHostNorm.replace(/\s+/g, "");
    const compactedBrand = requestedBrand.replace(/\s+/g, "");
    const brandInTitleOrUrl =
      brandAwareNorm.includes(requestedBrand) ||
      compactedHost.includes(compactedBrand) ||
      (requestedBrand === "the ordinary" &&
        (/\bordinary\b/.test(brandAwareNorm) || /\bdeciem\b/.test(brandAwareNorm))) ||
      (requestedBrand === "estee lauder" && /\bestee\b/.test(brandAwareNorm));
    if (!brandInTitleOrUrl) {
      return baseResult({
        classification: "unrelated",
        isExactVariant: false,
        isMatch: false,
        matchStatus: "unrelated",
        reason: `Brand mismatch (expected ${requestedBrand})`,
      });
    }
  }

  // 2. Block distinct sub-lines or unrelated product forms
  if (!broad) {
    const anchorNorm = `${queryNorm} ${refNorm}`;
    for (const subKw of DISTINCT_SUBLINE_KEYWORDS) {
      const pattern = new RegExp(`\\b${subKw.replace(/\s+/g, "\\s+")}\\b`, "i");
      if (pattern.test(candInspectNorm) && !pattern.test(anchorNorm)) {
        return baseResult({
          classification: "unrelated",
          isExactVariant: false,
          isMatch: false,
          matchStatus: "unrelated",
          reason: `Different product form/line (${subKw})`,
        });
      }
    }
  }

  const queryTokens = queryNorm
    .split(" ")
    .filter((t) => t.length > 2);

  if (queryTokens.length === 1 && !GENERIC_BEAUTY_CATEGORIES.has(queryNorm) && !referenceTitle) {
    const qTok = queryTokens[0];
    if (!candInspectNorm.includes(qTok)) {
      return baseResult({
        classification: "unrelated",
        isExactVariant: false,
        isMatch: false,
        matchStatus: "unrelated",
        reason: `Candidate does not mention "${qTok}"`,
      });
    }
  }

  // 3. Verify same core product family before separating exact vs unverified vs other variants.
  // Strip variant-only tokens (size/unit, SPF number, pack terms, and formulation descriptors)
  // so sibling formulations/sizes stay grouped under "Other available variants".
  const stopWords = new Set([
    "the",
    "for",
    "and",
    "with",
    "skin",
    "face",
    "all",
    "types",
    "original",
    "pack",
    "combo",
    "duo",
    "trio",
    "set",
    "from",
    "new",
    "spf",
  ]);
  const formulationTokens = new Set([
    "light",
    "fluid",
    "ultra",
    "sheer",
    "multi",
    "vitamin",
    "aqua",
    "silicone",
    "matte",
    "cream",
    "creme",
    "gel",
    "lotion",
    "spray",
    "mist",
    "milk",
    "mousse",
    "stick",
    "tinted",
    "invisible",
    "dewy",
  ]);
  const stripNonCoreTokens = (tok) =>
    !/^\d+(?:\.\d+)?(?:ml|g|gm|gms|grm|grms|grams|gram|kg|oz|fl|l)?$/i.test(tok) &&
    !/^pa\+{1,4}$/i.test(tok) &&
    !/^\d+(?:\.\d+)?%$/i.test(tok) &&
    !stopWords.has(tok) &&
    !formulationTokens.has(tok);

  const anchorForCore = queryNorm || refNorm;
  const rawAnchorTokens = anchorForCore
    .split(" ")
    .filter((t) => t.length >= 2 && stripNonCoreTokens(t));
  const brandParts = new Set((requestedBrand || "").split(" ").filter(Boolean));
  const coreProductTokens = rawAnchorTokens.filter((t) => !brandParts.has(t));

  // If the user explicitly named an SPF tier (e.g. "Minimalist SPF 50 30gm"),
  // unrelated categories like face serums/cleansers must remain "unrelated".
  if (
    !broad &&
    targetSpf &&
    !candSig.spf &&
    !/\b(?:sunscreen|sunblock|sun\s*(?:fluid|cream|gel|lotion|stick|spray)|spf|uv)\b/i.test(
      candInspectNorm
    )
  ) {
    return baseResult({
      classification: "unrelated",
      isExactVariant: false,
      isMatch: false,
      matchStatus: "unrelated",
      reason: "Candidate is not an SPF sun-care product",
    });
  }

  if (!broad && coreProductTokens.length >= 1) {
    const matchedCore = coreProductTokens.filter((t) => candInspectNorm.includes(t));
    const coreRatio = matchedCore.length / coreProductTokens.length;
    const minCoreRatio =
      coreProductTokens.length === 1 ? 1.0 : coreProductTokens.length === 2 ? 0.5 : 0.6;
    if (coreRatio < minCoreRatio) {
      return baseResult({
        classification: "unrelated",
        isExactVariant: false,
        isMatch: false,
        matchStatus: "unrelated",
        reason: "Product line does not match target SKU",
      });
    }
  } else if (!broad && !targetSpf) {
    const fallbackTokens = anchorForCore
      .split(" ")
      .filter((t) => t.length > 2 && stripNonCoreTokens(t));
    if (fallbackTokens.length >= 2) {
      const matched = fallbackTokens.filter((t) => candInspectNorm.includes(t));
      if (matched.length / fallbackTokens.length < 0.45) {
        return baseResult({
          classification: "unrelated",
          isExactVariant: false,
          isMatch: false,
          matchStatus: "unrelated",
          reason: "Insufficient product name overlap",
        });
      }
    }
  }

  if (broad) {
    return baseResult({
      classification: "unverified",
      isExactVariant: false,
      isMatch: true,
      matchStatus: "broad-query",
      variantStatusLabel: "Variant unverified",
      missingVariantFields: ["specific SKU selection"],
      reason: "Variant unverified — category query; confirm size & formulation",
    });
  }

  // 4. Variant Axis Verification (collect EVERY explicit difference + missing attribute)
  const variantDifferences = [];
  const missingVariantFields = [];

  // 4a. Pack count / bundle parity
  if (candSig.packCount !== targetPackCount) {
    const candLabel =
      candSig.packCount > 1 ? `Pack of ${candSig.packCount}` : "Single unit";
    const targetLabel =
      targetPackCount > 1 ? `Pack of ${targetPackCount}` : "Single unit";
    variantDifferences.push(`Pack quantity differs (${candLabel} vs ${targetLabel})`);
  } else if (!targetIsBundle && candSig.isBundle) {
    variantDifferences.push("Multi-pack or bundle listing differs from single unit");
  } else if (targetIsBundle && !candSig.isBundle) {
    variantDifferences.push("Single unit differs from target multi-pack/bundle");
  }

  // 4b. Mini / travel size parity
  if (candSig.isMini !== targetIsMini) {
    variantDifferences.push(
      candSig.isMini
        ? "Mini / trial size differs from full-size SKU"
        : "Full size differs from mini / trial SKU"
    );
  }

  // 4c. Exact Size / Volume & Unit parity (ml !== g)
  if (targetVolume) {
    if (!candSig.volume) {
      missingVariantFields.push(`size (${targetVolume} expected)`);
    } else if (!volumesCompatible(targetVolume, candSig.volume)) {
      variantDifferences.push(`Size differs (${candSig.volume} vs ${targetVolume})`);
    }
  }

  // 4d. SPF rating parity (SPF 30 vs SPF 50 vs SPF 50+)
  if (targetSpf) {
    if (!candSig.spf) {
      missingVariantFields.push(`SPF (${targetSpf.toUpperCase()} expected)`);
    } else if (candSig.spf !== targetSpf) {
      variantDifferences.push(
        `SPF differs (${candSig.spf.toUpperCase()} vs ${targetSpf.toUpperCase()})`
      );
    }
  }

  // 4e. Formulation parity (Light Fluid vs Multi-Vitamin vs Cream vs Gel etc.)
  if (targetFormulation) {
    if (!candSig.formulation) {
      missingVariantFields.push(
        `formulation (${targetFormulationLabel || targetFormulation} expected)`
      );
    } else if (
      !areFormulationsCompatible(
        targetFormulation,
        candSig.formulation,
        candSig.formulationTags,
        targetFormulationTags
      )
    ) {
      variantDifferences.push(
        `Formulation differs (${candSig.formulationLabel || candSig.formulation} vs ${
          targetFormulationLabel || targetFormulation
        })`
      );
    }
  }

  // 4f. Concentration / percentage parity (e.g., 10% vs 5%)
  if (targetConcentration) {
    if (!candSig.concentration) {
      missingVariantFields.push(`concentration (${targetConcentration} expected)`);
    } else if (candSig.concentration !== targetConcentration) {
      variantDifferences.push(
        `Concentration differs (${candSig.concentration} vs ${targetConcentration})`
      );
    }
  }

  // 4g. Flavor / shade mismatch guard (e.g., Berry vs Sweet Candy)
  const requestedFlavors = FLAVOR_OR_SHADE_KEYWORDS.filter((f) =>
    new RegExp(`\\b${f}\\b`, "i").test(anchorForCore)
  );
  if (requestedFlavors.length > 0) {
    const candFlavors = FLAVOR_OR_SHADE_KEYWORDS.filter((f) =>
      new RegExp(`\\b${f}\\b`, "i").test(combinedNorm)
    );
    if (
      candFlavors.length > 0 &&
      !requestedFlavors.some((rf) => candFlavors.includes(rf))
    ) {
      variantDifferences.push(
        `Variant/shade differs (${candFlavors[0]} vs ${requestedFlavors[0]})`
      );
    }
  }

  // 4h. Model/line number parity from user query (excluding SPF, PA ratings & size numbers)
  const modelSourceNorm = (queryNorm || refNorm)
    .replace(/\bspf\s*\d+\+?\b/gi, " ")
    .replace(/\bpa\s*\d+\b/gi, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(?:ml|g|gm|gms|grm|grms|grams|gram|kg|oz|fl|l)\b/gi, " ");
  const queryModelNums = modelSourceNorm.split(" ").filter((t) => /^\d+$/.test(t));
  for (const numTok of queryModelNums) {
    if (!new RegExp(`\\b${numTok}\\b`).test(candInspectNorm)) {
      variantDifferences.push(`Model/line number differs ("${numTok}" expected)`);
    }
  }

  if (variantDifferences.length > 0) {
    const isPackOnly =
      variantDifferences.every((d) => /pack|bundle/i.test(d)) &&
      candSig.packCount !== targetPackCount;
    const isMiniOnly =
      variantDifferences.every((d) => /mini|trial/i.test(d)) &&
      candSig.isMini !== targetIsMini;
    return baseResult({
      classification: "variant",
      isExactVariant: false,
      isMatch: false,
      matchStatus: isPackOnly
        ? "bundle-mismatch"
        : isMiniOnly
        ? "mini-mismatch"
        : "variant-mismatch",
      variantStatusLabel: "Other available variant",
      variantDifferences,
      missingVariantFields,
      reason: variantDifferences.join(" • "),
    });
  }

  // If the product itself has no size/variant descriptors verified anywhere yet, mark unverified if retailer omits size when other listings specify it
  if (missingVariantFields.length > 0 || (!targetVolume && !candSig.volume)) {
    const needsSizeLabel = !candSig.volume && Boolean(targetVolume || !candSig.volume);
    if (missingVariantFields.length === 0 && !candSig.volume) {
      missingVariantFields.push("size/weight");
    }
    return baseResult({
      classification: "unverified",
      isExactVariant: false,
      isMatch: true,
      matchStatus: needsSizeLabel ? "unverified-size" : "unverified-variant",
      variantStatusLabel: "Variant unverified",
      missingVariantFields,
      reason: `Variant unverified — listing omits ${missingVariantFields.join(", ")}`,
    });
  }

  return baseResult({
    classification: "exact",
    isExactVariant: true,
    isMatch: true,
    matchStatus: "exact",
    variantStatusLabel: "Exact Variant Match",
    reason: "Exact product & variant match",
  });
}

/**
 * Verifies whether a candidate retailer listing represents the exact requested beauty SKU
 * (delegating to evaluateVariantComparison as the single source of truth).
 */
export function evaluateProductIdentity(params = {}) {
  return evaluateVariantComparison(params);
}

export function computeOfferAnalytics(
  offers = [],
  displayCurrency = "INR",
  productVolume = null
) {
  const converted = offers.map((offer) => {
    const sourceCurrency = offer.currency || "INR";
    const convertedPrice =
      offer.price != null
        ? convertCurrency(offer.price, sourceCurrency, displayCurrency)
        : null;

    const convertedOriginal =
      offer.originalPrice != null && offer.originalPrice > (offer.price ?? 0)
        ? convertCurrency(offer.originalPrice, sourceCurrency, displayCurrency)
        : null;

    const convertedShipping =
      typeof offer.shippingCost === "number"
        ? convertCurrency(offer.shippingCost, sourceCurrency, displayCurrency)
        : null;

    const landedPrice =
      convertedPrice != null && convertedShipping != null
        ? displayCurrency === "USD"
          ? Math.round((convertedPrice + convertedShipping) * 100) / 100
          : Math.round(convertedPrice + convertedShipping)
        : null;

    return {
      ...offer,
      displayPrice: convertedPrice,
      displayOriginalPrice: convertedOriginal,
      displayShippingCost: convertedShipping,
      displayLandedPrice: landedPrice,
      displayCurrency,
    };
  });

  const pricedOffers = converted.filter(
    (o) => typeof o.displayPrice === "number" && o.displayPrice > 0
  );

  if (pricedOffers.length === 0) {
    return {
      enrichedOffers: converted.map((o) => ({
        ...o,
        savingsAmount: 0,
        savingsPercent: 0,
        isLowestActive: false,
        isHighest: false,
      })),
      summary: {
        bestStore: null,
        bestPrice: null,
        highestPrice: null,
        averagePrice: null,
        priceDifference: 0,
        maxSavings: 0,
        maxSavingsPercent: 0,
        pricePer100Unit: null,
        unitLabel: null,
        activeCount: converted.filter((o) => o.inStock).length,
        fastestStore: null,
        fastestDays: null,
      },
    };
  }

  const highestPrice = Math.max(...pricedOffers.map((o) => o.displayPrice));
  const activePriced = pricedOffers.filter((o) => o.inStock);
  const candidatePool = activePriced.length > 0 ? activePriced : pricedOffers;

  const lowestOffer = candidatePool.reduce((min, curr) =>
    curr.displayPrice < min.displayPrice ? curr : min
  );

  const deliveryCandidates = candidatePool.filter(
    (o) => typeof o.shippingDays === "number" && o.shippingDays > 0
  );
  const fastestOffer =
    deliveryCandidates.length > 0
      ? deliveryCandidates.reduce((min, curr) =>
          curr.shippingDays < min.shippingDays ? curr : min
        )
      : null;

  const enrichedOffers = converted.map((offer) => {
    const hasPrice =
      typeof offer.displayPrice === "number" && offer.displayPrice > 0;
    const rawDelta = hasPrice ? highestPrice - offer.displayPrice : 0;
    const savingsAmount =
      displayCurrency === "USD"
        ? Math.round(rawDelta * 100) / 100
        : Math.round(rawDelta);
    const savingsPercent =
      hasPrice && highestPrice > 0
        ? Math.round((rawDelta / highestPrice) * 100)
        : 0;

    return {
      ...offer,
      savingsAmount: savingsAmount > 0 ? savingsAmount : 0,
      savingsPercent: savingsPercent > 0 ? savingsPercent : 0,
      isLowestActive:
        Boolean(lowestOffer) &&
        offer.retailer === lowestOffer.retailer &&
        offer.inStock &&
        hasPrice,
      isHighest:
        hasPrice &&
        offer.displayPrice === highestPrice &&
        highestPrice > lowestOffer.displayPrice,
    };
  });

  const rawMaxSavings = highestPrice - lowestOffer.displayPrice;
  const maxSavings =
    displayCurrency === "USD"
      ? Math.round(rawMaxSavings * 100) / 100
      : Math.round(rawMaxSavings);

  const avgRaw =
    pricedOffers.reduce((sum, o) => sum + o.displayPrice, 0) /
    pricedOffers.length;
  const averagePrice =
    displayCurrency === "USD"
      ? Math.round(avgRaw * 100) / 100
      : Math.round(avgRaw);

  let pricePer100Unit = null;
  let unitLabel = null;
  if (productVolume && lowestOffer?.displayPrice > 0) {
    const volMatch = String(productVolume).match(
      /(\d+(?:\.\d+)?)\s*(ml|g|gm|grams|kg|litres?|liters?|l|oz|fl\.?\s*oz)\b/i
    );
    if (volMatch) {
      const qty = parseFloat(volMatch[1]);
      const unit = volMatch[2].toLowerCase().replace(/\./g, "").trim();
      let baseQty = qty;
      let baseUnit = unit.startsWith("g") || unit === "kg" ? "g" : "ml";
      if (unit === "kg" || unit === "l" || unit.startsWith("lit")) {
        baseQty = qty * 1000;
      } else if (unit.includes("oz")) {
        baseQty = qty * 29.5735;
        baseUnit = "ml";
      }
      if (baseQty > 0) {
        const rawPer100 = (lowestOffer.displayPrice / baseQty) * 100;
        pricePer100Unit =
          displayCurrency === "USD"
            ? Math.round(rawPer100 * 100) / 100
            : Math.round(rawPer100);
        unitLabel = `per 100${baseUnit}`;
      }
    }
  }

  return {
    enrichedOffers,
    summary: {
      bestStore: lowestOffer.retailer,
      bestPrice: lowestOffer.displayPrice,
      highestPrice,
      averagePrice,
      priceDifference: maxSavings > 0 ? maxSavings : 0,
      maxSavings: maxSavings > 0 ? maxSavings : 0,
      maxSavingsPercent:
        highestPrice > 0
          ? Math.round((rawMaxSavings / highestPrice) * 100)
          : 0,
      pricePer100Unit,
      unitLabel,
      activeCount: activePriced.length,
      fastestStore: fastestOffer?.retailer || null,
      fastestDays: fastestOffer?.shippingDays || null,
    },
  };
}

export function sortOffers(
  offers = [],
  sortBy = "price",
  options = false
) {
  const opts =
    typeof options === "boolean" ? { hideOutOfStock: options } : options || {};
  const {
    hideOutOfStock = false,
    targetRetailersOnly = false,
    exactVariantsOnly = false,
  } = opts;

  let filtered = [...offers];
  if (hideOutOfStock) {
    filtered = filtered.filter((offer) => offer.inStock);
  }
  if (targetRetailersOnly) {
    filtered = filtered.filter((offer) => offer.isTargetRetailer);
  }
  if (exactVariantsOnly) {
    filtered = filtered.filter((offer) => offer.variantMatchStatus === "exact");
  }

  return filtered.sort((a, b) => {
    const aHasPrice = typeof a.displayPrice === "number" && a.displayPrice > 0;
    const bHasPrice = typeof b.displayPrice === "number" && b.displayPrice > 0;

    if (aHasPrice !== bHasPrice) return aHasPrice ? -1 : 1;

    if (sortBy === "shipping") {
      if (a.inStock !== b.inStock) return a.inStock ? -1 : 1;
      const aKnown = typeof a.shippingDays === "number";
      const bKnown = typeof b.shippingDays === "number";
      if (aKnown !== bKnown) return aKnown ? -1 : 1;
      const aDays = a.shippingDays ?? 999;
      const bDays = b.shippingDays ?? 999;
      if (aDays !== bDays) return aDays - bDays;
      return (a.displayPrice ?? Infinity) - (b.displayPrice ?? Infinity);
    }

    if (sortBy === "rating") {
      const aKnown = typeof a.storeRating === "number";
      const bKnown = typeof b.storeRating === "number";
      if (aKnown !== bKnown) return aKnown ? -1 : 1;
      const aRating = a.storeRating ?? -1;
      const bRating = b.storeRating ?? -1;
      if (bRating !== aRating) return bRating - aRating;
      return (a.displayPrice ?? Infinity) - (b.displayPrice ?? Infinity);
    }

    if (sortBy === "discount") {
      const aDisc = a.discountPercent ?? -1;
      const bDisc = b.discountPercent ?? -1;
      if (bDisc !== aDisc) return bDisc - aDisc;
      return (a.displayPrice ?? Infinity) - (b.displayPrice ?? Infinity);
    }

    if (a.inStock !== b.inStock) return a.inStock ? -1 : 1;
    return (a.displayPrice ?? Infinity) - (b.displayPrice ?? Infinity);
  });
}

export function matchMockProduct(query, catalog = []) {
  const qNorm = normalizeText(query);
  if (!qNorm) return null;

  // Identify if the user's query explicitly names a known beauty brand
  const queryExplicitBrand = KNOWN_BEAUTY_BRANDS.find((b) =>
    new RegExp(`\\b${b.replace(/\s+/g, "\\s+")}\\b`, "i").test(qNorm)
  );

  const qTokens = qNorm.split(" ").filter((t) => t.length > 1);
  let bestMatch = null;
  let bestScore = 0;

  for (const product of catalog) {
    const titleNorm = normalizeText(product.name);
    const shortNorm = normalizeText(product.shortName || "");
    const brandNorm = normalizeText(product.brand || "");
    const categoryNorm = normalizeText(product.category || "");
    const tagNorm = (product.tags || []).map(normalizeText).join(" ");
    const aliasText = (product.aliases || []).map(normalizeText).join(" ");
    const haystack = `${titleNorm} ${shortNorm} ${brandNorm} ${categoryNorm} ${tagNorm} ${aliasText}`;

    if (titleNorm === qNorm || shortNorm === qNorm || product.id === qNorm) {
      return product;
    }

    // Never match a mock catalog product from a DIFFERENT brand when query explicitly names a brand
    if (queryExplicitBrand) {
      const brandMatches =
        brandNorm.includes(queryExplicitBrand) ||
        queryExplicitBrand.includes(brandNorm) ||
        aliasText.includes(queryExplicitBrand);
      if (!brandMatches) {
        continue;
      }
    }

    let score = 0;
    if (titleNorm.includes(qNorm) || (shortNorm && qNorm.includes(shortNorm))) {
      score += 50;
    }

    for (const token of qTokens) {
      if (brandNorm.includes(token)) score += 15;
      if (titleNorm.includes(token)) score += 12;
      if (aliasText.includes(token)) score += 10;
      if (categoryNorm.includes(token) || tagNorm.includes(token)) score += 8;
      if (haystack.includes(token)) score += 3;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = product;
    }
  }

  return bestScore >= 12 ? bestMatch : null;
}

export function convertHistoryCurrency(
  priceHistory = [],
  fromCurrency = "INR",
  toCurrency = "INR"
) {
  return priceHistory.map((point) => ({
    ...point,
    displayPrice: convertCurrency(point.price, fromCurrency, toCurrency),
  }));
}

export function computeHistoryAnalytics(
  points = [],
  sourceCurrency = "INR",
  displayCurrency = "INR",
  windowDays = 30
) {
  if (!Array.isArray(points) || points.length === 0) {
    return null;
  }

  const nowMs = Date.now();
  const filtered = points.filter((pt) => {
    if (typeof pt.daysAgo === "number") {
      return pt.daysAgo <= windowDays;
    }
    if (pt.timestamp) {
      const diffDays = (nowMs - new Date(pt.timestamp).getTime()) / 86400000;
      return Number.isFinite(diffDays) ? diffDays <= windowDays : true;
    }
    return true;
  });

  const activeSet = filtered.length > 0 ? filtered : points;
  const converted = activeSet
    .map((pt) => ({
      ...pt,
      value: convertCurrency(
        pt.price,
        pt.currency || sourceCurrency,
        displayCurrency
      ),
    }))
    .filter((pt) => typeof pt.value === "number" && pt.value > 0);

  if (converted.length === 0) return null;

  const values = converted.map((p) => p.value);
  const lowest = Math.min(...values);
  const highest = Math.max(...values);
  const avgRaw = values.reduce((acc, v) => acc + v, 0) / values.length;
  const average =
    displayCurrency === "USD"
      ? Math.round(avgRaw * 100) / 100
      : Math.round(avgRaw);
  const current = converted[converted.length - 1].value;
  const first = converted[0].value;

  const movementPct =
    first > 0 ? Math.round(((current - first) / first) * 1000) / 10 : 0;
  const spreadPct =
    average > 0 ? Math.round(((highest - lowest) / average) * 1000) / 10 : 0;

  let volatilityLabel = "Stable";
  if (spreadPct >= 12) {
    volatilityLabel = "High Swing";
  } else if (spreadPct >= 5) {
    volatilityLabel = "Moderate";
  }

  return {
    points: converted,
    lowest,
    highest,
    average,
    current,
    first,
    movementPct,
    spreadPct,
    volatilityLabel,
    observationCount: converted.length,
    windowCovered: filtered.length > 0,
  };
}

/**
 * Summarizes genuine live or curated price intelligence across current retailer
 * offers and authentic 7D/30D/90D timestamped observations without synthesizing points.
 */
export function computePriceIntelligence({
  offers = [],
  priceHistory = [],
  productVolume = null,
  sourceCurrency = "INR",
  displayCurrency = "INR",
}) {
  const { summary } = computeOfferAnalytics(offers, displayCurrency, productVolume);

  const buildWindowSummary = (days) => {
    const windowStats = computeHistoryAnalytics(
      priceHistory,
      sourceCurrency,
      displayCurrency,
      days
    );
    if (!windowStats) {
      return {
        windowDays: days,
        sufficientData: false,
        observationCount: 0,
        low: null,
        high: null,
        average: null,
        movementPct: null,
        spreadPct: null,
        volatilityLabel: "Unrecorded",
      };
    }

    return {
      windowDays: days,
      sufficientData: windowStats.observationCount >= 2 && windowStats.windowCovered,
      observationCount: windowStats.observationCount,
      low: windowStats.lowest,
      high: windowStats.highest,
      average: windowStats.average,
      movementPct: windowStats.movementPct,
      spreadPct: windowStats.spreadPct,
      volatilityLabel:
        windowStats.observationCount >= 2
          ? windowStats.volatilityLabel
          : "Single Snapshot",
    };
  };

  return {
    lowestPrice: summary.bestPrice,
    highestPrice: summary.highestPrice,
    averagePrice: summary.averagePrice ?? null,
    priceDifference: summary.priceDifference ?? 0,
    pricePer100Unit: summary.pricePer100Unit ?? null,
    unitLabel: summary.unitLabel ?? null,
    bestStore: summary.bestStore,
    observationCount: Array.isArray(priceHistory) ? priceHistory.length : 0,
    history7d: buildWindowSummary(7),
    history30d: buildWindowSummary(30),
    history90d: buildWindowSummary(90),
  };
}

export const BEAUTY_CATEGORY_TERMS = [
  "sunscreen",
  "sunscreens",
  "sunblock",
  "moisturizer",
  "moisturizers",
  "serum",
  "serums",
  "perfume",
  "perfumes",
  "fragrance",
  "fragrances",
  "lip balm",
  "lip balms",
  "lip mask",
  "lip sleeping mask",
  "cleanser",
  "cleansers",
  "face wash",
  "toner",
  "essence",
  "shampoo",
  "conditioner",
  "hair oil",
  "haircare",
  "skincare",
  "makeup",
  "lipstick",
  "blush",
  "foundation",
  "concealer",
  "mascara",
  "night cream",
  "eye cream",
  "face cream",
  "body lotion",
  "body mist",
  "mist",
];

/**
 * Classifies a search query into Mode A (multi-brand product discovery) vs
 * Mode B (exact single-SKU price comparison).
 */
export function classifySearchQuery(query = "") {
  const norm = normalizeText(query);
  if (!norm) {
    return {
      intent: "category",
      recommendedMode: "discover",
      reason: "Empty query defaults to discovery",
    };
  }

  const tokens = norm.split(" ").filter(Boolean);
  const sig = extractVariantSignature(query);

  const hasExactBrand = KNOWN_BEAUTY_BRANDS.some((brandKey) =>
    new RegExp(`\\b${brandKey.replace(/\s+/g, "\\s+")}\\b`, "i").test(norm)
  );
  const matchedCat = BEAUTY_CATEGORY_TERMS.some((cat) =>
    new RegExp(`\\b${cat.replace(/\s+/g, "\\s+")}\\b`, "i").test(norm)
  );

  // Explicit single-SKU indicators: brand + (volume OR concentration) OR >= 5 tokens with a size/grade number
  const nonSpfNumeric = /\b\d+(?:\.\d+)?(?:ml|g|gm|oz|fl|%)\b|\b(?:96|400)\b/i.test(
    query
  );
  if (
    hasExactBrand &&
    (sig.volume || sig.concentration || nonSpfNumeric || tokens.length >= 5)
  ) {
    return {
      intent: "exact_product",
      recommendedMode: "compare",
      reason: "Query identifies a specific brand formulation or bottle size",
    };
  }

  if (matchedCat && !hasExactBrand) {
    return {
      intent: "category",
      recommendedMode: "discover",
      reason: "Category discovery search across multiple brands",
    };
  }

  if (hasExactBrand && tokens.length <= 3 && !sig.volume) {
    return {
      intent: "brand",
      recommendedMode: "discover",
      reason: "Brand catalog discovery across available SKUs",
    };
  }

  if (tokens.length <= 3) {
    return {
      intent: "category",
      recommendedMode: "discover",
      reason: "Multi-product discovery query",
    };
  }

  return {
    intent: "exact_product",
    recommendedMode: "compare",
    reason: "Detailed product specification",
  };
}
