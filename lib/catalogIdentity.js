import {
  normalizeText,
  extractVariantSignature,
  parsePriceString,
  convertCurrency,
  classifySearchQuery,
} from "@/lib/utils";
import { validateRetailerProductUrl } from "@/lib/urlValidator";
import { registerDiscoveredProduct } from "@/lib/discoveryCache";

export { classifySearchQuery };

export const BEAUTY_BRAND_DISPLAY_MAP = [
  ["la roche posay", "La Roche-Posay"],
  ["la roche-posay", "La Roche-Posay"],
  ["beauty of joseon", "Beauty of Joseon"],
  ["the ordinary", "The Ordinary"],
  ["estee lauder", "Estée Lauder"],
  ["sol de janeiro", "Sol de Janeiro"],
  ["charlotte tilbury", "Charlotte Tilbury"],
  ["augustinus bader", "Augustinus Bader"],
  ["paula s choice", "Paula's Choice"],
  ["paulas choice", "Paula's Choice"],
  ["the derma co", "The Derma Co"],
  ["derma co", "The Derma Co"],
  ["dot & key", "Dot & Key"],
  ["dot key", "Dot & Key"],
  ["dot and key", "Dot & Key"],
  ["dr sheth", "Dr. Sheth's"],
  ["dr. sheth", "Dr. Sheth's"],
  ["re equil", "Re'equil"],
  ["reequil", "Re'equil"],
  ["rare beauty", "Rare Beauty"],
  ["drunk elephant", "Drunk Elephant"],
  ["glow recipe", "Glow Recipe"],
  ["summer fridays", "Summer Fridays"],
  ["conscious chemist", "Conscious Chemist"],
  ["pat mcgrath", "Pat McGrath Labs"],
  ["carolina herrera", "Carolina Herrera"],
  ["giorgio armani", "Giorgio Armani"],
  ["fenty beauty", "Fenty Beauty"],
  ["fenty skin", "Fenty Skin"],
  ["uv doux", "UV Doux"],
  ["round lab", "Round Lab"],
  ["jo malone", "Jo Malone"],
  ["tom ford", "Tom Ford"],
  ["le labo", "Le Labo"],
  ["l oreal", "L'Oréal Paris"],
  ["loreal", "L'Oréal Paris"],
  ["la mer", "La Mer"],
  ["minimalist", "Minimalist"],
  ["neutrogena", "Neutrogena"],
  ["cerave", "CeraVe"],
  ["deconstruct", "Deconstruct"],
  ["foxtale", "Foxtale"],
  ["aqualogica", "Aqualogica"],
  ["fixderma", "Fixderma"],
  ["wishcare", "WishCare"],
  ["mamaearth", "Mamaearth"],
  ["hyphen", "Hyphen"],
  ["plum", "Plum"],
  ["cosrx", "COSRX"],
  ["laneige", "Laneige"],
  ["skinceuticals", "SkinCeuticals"],
  ["cetaphil", "Cetaphil"],
  ["bioderma", "Bioderma"],
  ["eucerin", "Eucerin"],
  ["aveeno", "Aveeno"],
  ["garnier", "Garnier"],
  ["lakme", "Lakmé"],
  ["forest essentials", "Forest Essentials"],
  ["kama ayurveda", "Kama Ayurveda"],
  ["kay beauty", "Kay Beauty"],
  ["kerastase", "Kérastase"],
  ["olaplex", "Olaplex"],
  ["clinique", "Clinique"],
  ["kiehls", "Kiehl's"],
  ["tatcha", "Tatcha"],
  ["innisfree", "Innisfree"],
  ["sulwhasoo", "Sulwhasoo"],
  ["skin1004", "SKIN1004"],
  ["isntree", "Isntree"],
  ["mixsoon", "Mixsoon"],
  ["torriden", "Torriden"],
  ["biodance", "Biodance"],
  ["anua", "Anua"],
  ["shiseido", "Shiseido"],
  ["lancome", "Lancôme"],
  ["glossier", "Glossier"],
  ["hourglass", "Hourglass"],
  ["diptyque", "Diptyque"],
  ["byredo", "Byredo"],
  ["rhode", "Rhode"],
  ["fenty", "Fenty Beauty"],
  ["nars", "NARS"],
  ["dior", "Dior"],
  ["ysl", "YSL Beauty"],
  ["chanel", "Chanel"],
  ["versace", "Versace"],
  ["gucci", "Gucci"],
  ["prada", "Prada"],
  ["gisou", "Gisou"],
  ["mac", "MAC"],
];

const INGREDIENT_PATTERNS = [
  [/niacinamide/i, "Niacinamide"],
  [/hyaluronic/i, "Hyaluronic Acid"],
  [/vitamin\s*c|ascorbic/i, "Vitamin C"],
  [/salicylic/i, "Salicylic Acid"],
  [/ceramides?/i, "Ceramides"],
  [/retinol|retinoid/i, "Retinol"],
  [/peptides?/i, "Peptides"],
  [/snail\s*(?:mucin|filtrate)?/i, "Snail Mucin"],
  [/rice\s*water|rice\s*\+|oryza/i, "Rice Extract"],
  [/centella|cica/i, "Centella / Cica"],
  [/zinc\b/i, "Zinc"],
  [/kojic/i, "Kojic Acid"],
  [/glycolic/i, "Glycolic Acid"],
  [/azelaic/i, "Azelaic Acid"],
  [/squalane/i, "Squalane"],
  [/panthenol|b5\b/i, "Panthenol (B5)"],
  [/shea\s*butter/i, "Shea Butter"],
  [/glutathione/i, "Glutathione"],
];

const SKIN_TYPE_PATTERNS = [
  [/oily(?:\s*(?:&|and)?\s*acne)?/i, "Oily Skin"],
  [/acne[-\s]*prone/i, "Acne-Prone"],
  [/dry\s*(?:skin|to\s*very\s*dry)|normal\s*to\s*dry/i, "Dry Skin"],
  [/sensitive/i, "Sensitive Skin"],
  [/combination/i, "Combination Skin"],
  [/all\s*skin\s*types/i, "All Skin Types"],
];

const FINISH_PATTERNS = [
  [/ultra[-\s]*matte|matte/i, "Matte"],
  [/dewy/i, "Dewy"],
  [/\bglow\b|\bglowing\b|\bsuper\s*bright\b/i, "Glow / Brightening"],
  [/invisible|no\s*white\s*cast|zero\s*white\s*cast/i, "Invisible / No White Cast"],
  [/tinted/i, "Tinted"],
  [/satin/i, "Satin"],
  [/sheer/i, "Sheer"],
  [/velvet/i, "Velvet"],
  [/lightweight|aqua[-\s]*fresh|water\s*light/i, "Lightweight / Aqua"],
];

const PRODUCT_TYPE_PATTERNS = [
  [/\bgel\b|\baqua\s*gel\b/i, "Gel"],
  [/\bfluid\b/i, "Fluid"],
  [/\bserum\b/i, "Serum"],
  [/\bessence\b/i, "Essence"],
  [/\blotion\b/i, "Lotion"],
  [/\bcream\b|\bcreme\b/i, "Cream"],
  [/\bbalm\b/i, "Balm"],
  [/\bmask\b/i, "Mask"],
  [/\bmist\b/i, "Mist"],
  [/eau de parfum|\bedp\b/i, "Eau de Parfum"],
  [/eau de toilette|\bedt\b/i, "Eau de Toilette"],
  [/\bspray\b/i, "Spray"],
  [/\bstick\b/i, "Stick"],
  [/\boil\b/i, "Oil"],
  [/\bfoam\b|\bfoaming\b/i, "Foam"],
  [/\bcleanser\b|\bface\s*wash\b/i, "Cleanser"],
  [/\btoner\b/i, "Toner"],
];

const EXCLUDED_QUERY_PATTERNS_WHEN_UNASKED = [
  "pack of",
  "combo",
  "bundle",
  "kit",
  "gift set",
  "sample",
  "sachet",
  "tester",
];

export function extractBrandFromItem({ title = "", source = "", url = "" }) {
  // Always inspect product title first so search/referral URL params never override the true brand.
  const titleNorm = normalizeText(title);
  for (const [key, display] of BEAUTY_BRAND_DISPLAY_MAP) {
    const pattern = new RegExp(`\\b${key.replace(/\s+/g, "\\s+")}\\b`, "i");
    if (pattern.test(titleNorm)) {
      return display;
    }
  }

  let urlPathNorm = "";
  try {
    if (url && /^https?:\/\//i.test(String(url).trim())) {
      urlPathNorm = normalizeText(new URL(String(url).trim()).pathname);
    }
  } catch {
    urlPathNorm = "";
  }
  if (urlPathNorm) {
    for (const [key, display] of BEAUTY_BRAND_DISPLAY_MAP) {
      const pattern = new RegExp(`\\b${key.replace(/\s+/g, "\\s+")}\\b`, "i");
      if (pattern.test(urlPathNorm)) {
        return display;
      }
    }
  }

  const cleanSource = String(source || "").trim();
  if (cleanSource) {
    const sourceNorm = normalizeText(cleanSource);
    for (const [key, display] of BEAUTY_BRAND_DISPLAY_MAP) {
      if (sourceNorm.includes(key)) {
        return display;
      }
    }
  }

  // Only promote non-marketplace first word/phrase if source equals brand (e.g. standalone brand stores)
  const marketplaces = /nykaa|amazon|flipkart|myntra|sephora|tira|purplle|ajio|tatacliq|ubuy|desertcart|blinkit|zepto|jiomart|shoppers|maccaron|pharmeasy|1mg|meesho|kiwla|gosupps|sweetcare|cult\s*beauty|space\s*nk/i;
  if (cleanSource && !marketplaces.test(cleanSource) && cleanSource.length <= 28) {
    return cleanSource.replace(/\.(com|in|co\.in|co\.uk)$/i, "").trim();
  }

  return "Independent / Other";
}

export function categorizeBeautyProduct(text = "", queryHint = "") {
  const target = `${text} ${queryHint}`.toLowerCase();
  if (/\bsunscreen|\bsunblock|\bspf\b|\buv\b|\bsun\s+fluid/i.test(target)) {
    return "Sunscreen";
  }
  if (/\blip\s+(?:sleeping\s+)?mask|\blip\s+balm|\blip\s+oil|\blip\s+butter|\blip\s+care/i.test(target)) {
    return "Lip Care";
  }
  if (/\bperfume|\beau de parfum|\beau de toilette|\bparfum|\bcologne|\bfragrance|\bbody mist/i.test(target)) {
    return "Fragrances";
  }
  if (/\bshampoo|\bconditioner|\bhair\s+(?:oil|serum|mask)|\bscalp/i.test(target)) {
    return "Haircare";
  }
  if (/\bcleanser|\bface\s+wash|\bmicellar|\bcleansing/i.test(target)) {
    return "Cleansers";
  }
  if (/\bmoisturizer|\bmoisturiser|\bcream|\bcreme|\blotion|\bbarrier/i.test(target)) {
    return "Moisturizers";
  }
  if (/\btoner|\bessence|\bmucin/i.test(target)) {
    return "Toners & Essences";
  }
  if (/\bserum|\bampoule|\bniacinamide|\bvitamin\s*c|\bretinol|\bsalicylic/i.test(target)) {
    return "Serums";
  }
  if (/\blipstick|\bblush|\bfoundation|\bconcealer|\bmascara|\bprimer/i.test(target)) {
    return "Makeup";
  }
  return "Skincare";
}

export function parseSizeDetails(text = "") {
  const match = String(text || "").match(
    /(\d+(?:\.\d+)?)\s*(ml|g|gm|grams|gram|kg|litres?|liters?|fluid\s*ounces?|ounces?|fl\.?\s*oz|oz|l)\b/i
  );
  if (!match) {
    return {
      sizeValue: null,
      sizeUnit: null,
      sizeLabel: null,
      normalizedBaseMlOrG: null,
      normalizedBaseUnit: null,
    };
  }

  const rawNum = parseFloat(match[1]);
  let unit = match[2].toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
  if (unit === "gm" || unit === "grams" || unit === "gram") unit = "g";
  if (unit === "litre" || unit === "litres" || unit === "liter" || unit === "liters") {
    unit = "l";
  }
  if (unit === "ounce" || unit === "ounces") unit = "oz";
  if (unit === "fluid ounce" || unit === "fluid ounces") unit = "fl oz";

  let normalizedBaseMlOrG = rawNum;
  let normalizedBaseUnit = unit === "g" || unit === "kg" ? "g" : "ml";
  if (unit === "kg" || unit === "l") {
    normalizedBaseMlOrG = rawNum * 1000;
  } else if (unit === "oz" || unit === "fl oz") {
    normalizedBaseMlOrG = Math.round(rawNum * 29.5735 * 10) / 10;
    normalizedBaseUnit = "ml";
  }

  return {
    sizeValue: rawNum,
    sizeUnit: unit,
    sizeLabel: `${match[1]}${unit === "fl oz" ? " fl oz" : unit}`,
    normalizedBaseMlOrG,
    normalizedBaseUnit,
  };
}

export function computePricePer100Unit(price, sizeInfo, currency = "INR") {
  if (
    typeof price !== "number" ||
    price <= 0 ||
    !sizeInfo?.normalizedBaseMlOrG ||
    sizeInfo.normalizedBaseMlOrG <= 0
  ) {
    return { value: null, label: null };
  }

  const rawPer100 = (price / sizeInfo.normalizedBaseMlOrG) * 100;
  const rounded =
    currency === "USD"
      ? Math.round(rawPer100 * 100) / 100
      : Math.round(rawPer100);
  return {
    value: rounded,
    label: `per 100${sizeInfo.normalizedBaseUnit || "ml"}`,
  };
}

export function extractSpfLabel(text = "") {
  const spfMatch = String(text || "").match(/spf\s*(\d+\+?)/i);
  if (!spfMatch) return null;
  const paMatch = String(text || "").match(/\b(pa\+{1,4})/i);
  const spfCore = `SPF ${spfMatch[1]}`;
  return paMatch ? `${spfCore} ${paMatch[1].toUpperCase()}` : spfCore;
}

export function extractSpfTier(spfLabel = "") {
  if (!spfLabel) return null;
  const match = String(spfLabel).match(/spf\s*(\d+\+?)/i);
  return match ? `SPF ${match[1]}` : null;
}

function matchPatterns(text, patterns) {
  const found = [];
  for (const [regex, label] of patterns) {
    if (regex.test(text) && !found.includes(label)) {
      found.push(label);
    }
  }
  return found;
}

export function extractStructuredAttributes({
  title = "",
  snippet = "",
  extensions = [],
  url = "",
  source = "",
  queryHint = "",
  categoryHint = null,
}) {
  const extText = Array.isArray(extensions) ? extensions.join(" ") : "";
  const combined = `${title} ${snippet} ${extText}`.trim();
  const sig = extractVariantSignature(`${title} ${url}`);
  const size = parseSizeDetails(`${title} ${url}`);
  const spf = extractSpfLabel(combined);
  const spfTier = extractSpfTier(spf);
  const ingredients = matchPatterns(combined, INGREDIENT_PATTERNS);
  const skinTypes = matchPatterns(combined, SKIN_TYPE_PATTERNS);
  const finishes = matchPatterns(combined, FINISH_PATTERNS);
  const productTypes = matchPatterns(combined, PRODUCT_TYPE_PATTERNS);
  const brand = extractBrandFromItem({ title, source, url });
  const category =
    categoryHint || categorizeBeautyProduct(combined, queryHint);

  return {
    brand,
    category,
    sizeLabel: size.sizeLabel,
    sizeValue: size.sizeValue,
    sizeUnit: size.sizeUnit,
    normalizedBaseMlOrG: size.normalizedBaseMlOrG,
    normalizedBaseUnit: size.normalizedBaseUnit,
    spf,
    spfTier,
    concentration: sig.concentration,
    packCount: sig.packCount || 1,
    formulation: sig.formulation || null,
    formulationLabel: sig.formulationLabel || null,
    formulationTags: sig.formulationTags || [],
    ingredients,
    skinTypes,
    finishes,
    productTypes,
    isBundle: sig.isBundle,
    isMini: sig.isMini,
  };
}

export function normalizeRetailerName(source = "", link = "") {
  const combined = `${source} ${link}`.toLowerCase();
  if (combined.includes("sephora")) return "Sephora";
  if (combined.includes("nykaa")) return "Nykaa";
  if (combined.includes("amazon")) return "Amazon Luxury";
  if (combined.includes("cultbeauty") || combined.includes("cult beauty")) {
    return "Cult Beauty";
  }
  if (combined.includes("spacenk") || combined.includes("space nk")) {
    return "Space NK";
  }
  if (combined.includes("purplle")) return "Purplle";
  if (combined.includes("ajio")) return "Ajio Luxe";
  if (combined.includes("myntra")) return "Myntra";
  if (combined.includes("flipkart")) return "Flipkart";
  if (combined.includes("tira")) return "Tira Beauty";
  if (combined.includes("clinikally")) return "Clinikally";
  if (combined.includes("shoppers stop")) return "Shoppers Stop";
  if (combined.includes("tatacliq") || combined.includes("tata cliq")) return "Tata CLiQ";
  if (combined.includes("maccaron")) return "Maccaron";
  if (combined.includes("jiomart")) return "JioMart";
  if (combined.includes("blinkit")) return "Blinkit";
  if (combined.includes("zepto")) return "Zepto";
  if (combined.includes("1mg")) return "Tata 1mg";
  if (combined.includes("pharmeasy")) return "PharmEasy";
  if (combined.includes("foxy")) return "Foxy";
  if (combined.includes("boddess")) return "Boddess";
  if (combined.includes("kindlife")) return "Kindlife";
  if (combined.includes("desertcart")) return "Desertcart";
  if (combined.includes("ubuy")) return "Ubuy";
  if (combined.includes("sweetcare")) return "SweetCare";

  return String(source || "")
    .replace(/\s+-\s+.*$/, "")
    .replace(/\s+(?:now|minutes|express)$/i, "")
    .replace(/\.(com|in|co\.uk|co\.in|ae|sa)$/i, "")
    .trim();
}

export function cleanCanonicalTitle(rawTitle = "", brand = "") {
  let clean = String(rawTitle || "").trim();
  if (!clean) return "";

  clean = clean
    .replace(/\s*\|\s*.*$/, "")
    .replace(/\s*-\s*(?:buy online|at best price|price in india).*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (
    brand &&
    brand !== "Independent / Other" &&
    !normalizeText(clean).includes(normalizeText(brand))
  ) {
    clean = `${brand} ${clean}`;
  }

  return clean;
}

export function buildCanonicalGroupKey({
  title = "",
  brand = "",
  sizeLabel = null,
  spfTier = null,
  concentration = null,
  formulation = null,
  packCount = 1,
}) {
  const brandSlug = normalizeText(brand === "Independent / Other" ? "" : brand);
  // Remove volume, percentages, and punctuation noise cleanly while keeping core product identity tokens
  const coreNorm = normalizeText(title)
    .replace(/\b\d+(?:\.\d+)?\s*(?:ml|g|gm|grams|oz|fl|l|kg)\b/g, " ")
    .replace(/\bpa\+{1,4}\b/g, " ")
    .replace(/\b(?:by|for|with|and|the|in|at|on|pack|of|women|men|unisex|skin|face|all|types)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = coreNorm
    .split(" ")
    .filter(Boolean)
    .filter((tok, idx, arr) => arr.indexOf(tok) === idx)
    .filter((tok) => !brandSlug.split(" ").includes(tok))
    .slice(0, 5);

  const wordsSlug = words.join("-") || "item";
  const variantParts = [
    sizeLabel ? normalizeText(sizeLabel) : "nosize",
    spfTier ? normalizeText(spfTier) : "nospf",
    concentration ? normalizeText(concentration) : "noconc",
  ];
  if (formulation) {
    const formSlug = normalizeText(formulation).replace(/\s+/g, "-");
    if (formSlug && !wordsSlug.includes(formSlug)) {
      variantParts.push(formSlug);
    }
  }
  if (typeof packCount === "number" && packCount > 1) {
    variantParts.push(`pack${packCount}`);
  }

  return `${brandSlug || "nobrand"}__${wordsSlug}__${variantParts.join("_")}`;
}

export function parseImmersivePageToken(immUrl) {
  if (!immUrl || typeof immUrl !== "string") return null;
  try {
    const parsed = new URL(immUrl);
    return parsed.searchParams.get("page_token") || null;
  } catch {
    return null;
  }
}

export function isDiscoveryNoiseItem(item, query = "") {
  const qLower = String(query || "").toLowerCase();
  const titleLower = String(item?.title || "").toLowerCase();

  for (const noise of EXCLUDED_QUERY_PATTERNS_WHEN_UNASKED) {
    if (!qLower.includes(noise) && titleLower.includes(noise)) {
      return true;
    }
  }
  return false;
}

/**
 * Normalizes raw SerpApi or local catalog listings into distinct canonical products,
 * preserving variant boundaries (size/concentration/SPF) and registering safe server
 * comparison tokens for lazy Mode B drilldowns.
 */
export function aggregateDiscoveryProducts(
  rawItems = [],
  {
    query = "",
    gl = "in",
    displayCurrency = "INR",
    dataSource = "LIVE_OBSERVED",
    fetchedAt = new Date().toISOString(),
  } = {}
) {
  const defaultCurr = gl === "us" ? "USD" : "INR";
  const minThreshold = displayCurrency === "USD" ? 2 : 50;
  const groups = new Map();

  for (const raw of rawItems) {
    if (!raw?.title) continue;
    if (isDiscoveryNoiseItem(raw, query)) continue;

    const parsedPrice =
      typeof raw.extracted_price === "number" && raw.extracted_price > 0
        ? {
            amount: raw.extracted_price,
            currency: parsePriceString(raw.price, defaultCurr).currency,
          }
        : parsePriceString(raw.price, defaultCurr);

    if (!parsedPrice.amount || parsedPrice.amount <= 0) continue;

    const dispPrice = convertCurrency(
      parsedPrice.amount,
      parsedPrice.currency,
      displayCurrency
    );
    if (!dispPrice || dispPrice < minThreshold) continue;

    let originalDispPrice = null;
    const rawOld = raw.extracted_old_price || raw.old_price;
    if (rawOld) {
      const parsedOld =
        typeof rawOld === "number"
          ? { amount: rawOld, currency: parsedPrice.currency }
          : parsePriceString(rawOld, parsedPrice.currency);
      if (parsedOld.amount && parsedOld.amount > parsedPrice.amount) {
        originalDispPrice = convertCurrency(
          parsedOld.amount,
          parsedOld.currency,
          displayCurrency
        );
      }
    }
    const discountPercent =
      originalDispPrice && originalDispPrice > dispPrice
        ? Math.round(((originalDispPrice - dispPrice) / originalDispPrice) * 100)
        : raw.discountPercent || null;

    const retailerName = normalizeRetailerName(
      raw.source || raw.retailer || "",
      raw.link || raw.direct_link || ""
    );
    if (!retailerName) continue;

    const attrs = extractStructuredAttributes({
      title: raw.title,
      snippet: raw.snippet || raw.description || "",
      extensions: raw.extensions || [],
      url: raw.direct_link || raw.link || "",
      source: raw.source || retailerName,
      queryHint: query,
      categoryHint: raw.category || null,
    });

    if (attrs.isBundle || attrs.isMini) {
      const qLower = query.toLowerCase();
      if (!qLower.includes("combo") && !qLower.includes("set") && !qLower.includes("mini")) {
        continue;
      }
    }

    const canonicalName = cleanCanonicalTitle(raw.title, attrs.brand);
    const canonicalKey = buildCanonicalGroupKey({
      title: canonicalName,
      brand: attrs.brand,
      sizeLabel: attrs.sizeLabel,
      spfTier: attrs.spfTier,
      concentration: attrs.concentration,
      formulation: attrs.formulation,
      packCount: attrs.packCount,
    });

    const urlCheck = validateRetailerProductUrl(
      raw.direct_link || raw.link || "",
      retailerName,
      { allowSearchUrl: dataSource === "CURATED_DEMO" }
    );

    const isOutOfStock = /out of stock|unavailable|sold out/i.test(
      `${raw.tag || ""} ${raw.stockLabel || ""}`
    );

    const pageToken = parseImmersivePageToken(raw.serpapi_immersive_product_api);
    const gtin = raw.gtin || raw.barcode || null;
    const sku = raw.sku || raw.product_id || null;

    const offerSnapshot = {
      retailer: retailerName,
      price: dispPrice,
      originalPrice: originalDispPrice,
      discountPercent,
      currency: displayCurrency,
      inStock: typeof raw.inStock === "boolean" ? raw.inStock : !isOutOfStock,
      delivery: raw.delivery || raw.shippingInfo || null,
      rating: typeof raw.rating === "number" ? raw.rating : null,
      storeUrl: urlCheck.valid ? urlCheck.url : null,
      linkType: urlCheck.valid ? urlCheck.linkType : "unavailable",
      productId: raw.product_id || null,
      hasImmersiveToken: Boolean(pageToken),
    };

    if (!groups.has(canonicalKey)) {
      const safeProductId =
        raw.id ||
        (raw.product_id ? `serp-${raw.product_id}` : `canon-${canonicalKey}`);

      const unitPrice = computePricePer100Unit(
        dispPrice,
        {
          normalizedBaseMlOrG: attrs.normalizedBaseMlOrG,
          normalizedBaseUnit: attrs.normalizedBaseUnit,
        },
        displayCurrency
      );

      groups.set(canonicalKey, {
        id: safeProductId,
        canonicalKey,
        serpProductId: raw.product_id || null,
        gtin,
        sku,
        brand: attrs.brand,
        name: canonicalName,
        rawTitle: raw.title,
        category: attrs.category,
        size: attrs.sizeLabel,
        sizeValue: attrs.sizeValue,
        sizeUnit: attrs.sizeUnit,
        normalizedBaseMlOrG: attrs.normalizedBaseMlOrG,
        normalizedBaseUnit: attrs.normalizedBaseUnit,
        variant:
          raw.variant ||
          [attrs.spfTier, attrs.concentration, attrs.finishes?.[0], attrs.sizeLabel]
            .filter(Boolean)
            .join(" · ") ||
          null,
        spf: attrs.spfTier,
        spfFull: attrs.spf,
        concentration: attrs.concentration,
        packCount: attrs.packCount || 1,
        formulation: attrs.formulation || null,
        formulationLabel: attrs.formulationLabel || null,
        ingredients: attrs.ingredients,
        skinTypes: attrs.skinTypes,
        finishes: attrs.finishes,
        productTypes: attrs.productTypes,
        image: raw.thumbnail || raw.image || null,
        rating: typeof raw.rating === "number" ? raw.rating : null,
        reviewCount: typeof raw.reviews === "number" ? raw.reviews : typeof raw.reviewCount === "number" ? raw.reviewCount : null,
        description: raw.snippet || raw.description || null,
        lowestPrice: dispPrice,
        highestPrice: dispPrice,
        averagePrice: dispPrice,
        priceDifference: 0,
        pricePer100Unit: unitPrice.value,
        unitLabel: unitPrice.label,
        currency: displayCurrency,
        bestRetailer: retailerName,
        maxDiscountPercent: discountPercent || 0,
        inStock: offerSnapshot.inStock,
        retailers: [retailerName],
        offersPreview: [offerSnapshot],
        _tokens: pageToken ? [pageToken] : [],
        _directUrlsCount: urlCheck.valid ? 1 : 0,
        matchConfidence: attrs.sizeLabel && attrs.brand !== "Independent / Other" ? "exact" : "high",
        dataSource,
        lastUpdated: fetchedAt,
      });
    } else {
      const existing = groups.get(canonicalKey);
      // Merge genuine distinct retailer offers for this exact variant
      const alreadyHasRetailer = existing.offersPreview.some(
        (o) => o.retailer === retailerName
      );
      if (!alreadyHasRetailer) {
        existing.offersPreview.push(offerSnapshot);
        existing.retailers.push(retailerName);
      } else {
        const idx = existing.offersPreview.findIndex(
          (o) => o.retailer === retailerName
        );
        if (idx >= 0 && dispPrice < existing.offersPreview[idx].price) {
          existing.offersPreview[idx] = offerSnapshot;
        }
      }

      if (pageToken && !existing._tokens.includes(pageToken)) {
        existing._tokens.push(pageToken);
      }
      if (urlCheck.valid) existing._directUrlsCount += 1;

      const prices = existing.offersPreview.map((o) => o.price);
      existing.lowestPrice = Math.min(...prices);
      existing.highestPrice = Math.max(...prices);
      const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
      existing.averagePrice =
        displayCurrency === "USD"
          ? Math.round(avg * 100) / 100
          : Math.round(avg);
      existing.priceDifference =
        displayCurrency === "USD"
          ? Math.round((existing.highestPrice - existing.lowestPrice) * 100) / 100
          : Math.round(existing.highestPrice - existing.lowestPrice);

      const bestOffer = existing.offersPreview.reduce((min, o) =>
        o.price < min.price ? o : min
      );
      existing.bestRetailer = bestOffer.retailer;
      existing.inStock = existing.offersPreview.some((o) => o.inStock);
      existing.maxDiscountPercent = Math.max(
        existing.maxDiscountPercent || 0,
        discountPercent || 0
      );

      if (!existing.image && (raw.thumbnail || raw.image)) {
        existing.image = raw.thumbnail || raw.image;
      }
      if (existing.rating == null && typeof raw.rating === "number") {
        existing.rating = raw.rating;
      }
      if (existing.reviewCount == null && typeof raw.reviews === "number") {
        existing.reviewCount = raw.reviews;
      }
      for (const ing of attrs.ingredients) {
        if (!existing.ingredients.includes(ing)) existing.ingredients.push(ing);
      }
      for (const st of attrs.skinTypes) {
        if (!existing.skinTypes.includes(st)) existing.skinTypes.push(st);
      }
      for (const fin of attrs.finishes) {
        if (!existing.finishes.includes(fin)) existing.finishes.push(fin);
      }
      for (const pt of attrs.productTypes) {
        if (!existing.productTypes.includes(pt)) existing.productTypes.push(pt);
      }

      const unitPrice = computePricePer100Unit(
        existing.lowestPrice,
        {
          normalizedBaseMlOrG: existing.normalizedBaseMlOrG,
          normalizedBaseUnit: existing.normalizedBaseUnit,
        },
        displayCurrency
      );
      existing.pricePer100Unit = unitPrice.value;
      existing.unitLabel = unitPrice.label;
    }
  }

  const products = [];
  for (const prod of groups.values()) {
    // Register server-side lazy token & identity metadata for Mode B comparison
    registerDiscoveredProduct(prod.id, {
      id: prod.id,
      canonicalKey: prod.canonicalKey,
      name: prod.name,
      rawTitle: prod.rawTitle,
      brand: prod.brand,
      category: prod.category,
      volume: prod.size,
      variant: prod.variant,
      spf: prod.spfFull,
      gtin: prod.gtin,
      sku: prod.sku,
      image: prod.image,
      rating: prod.rating,
      reviewCount: prod.reviewCount,
      description: prod.description,
      immersivePageTokens: prod._tokens,
      serpProductId: prod.serpProductId,
      dataSource: prod.dataSource,
    });

    const { _tokens, _directUrlsCount, ...publicProduct } = prod;
    products.push({
      ...publicProduct,
      offerCount: publicProduct.offersPreview.length,
      hasDetailToken: (_tokens || []).length > 0,
      hasDirectUrlPreview: _directUrlsCount > 0,
    });
  }

  return products;
}

export function buildDiscoveryFacets(products = []) {
  const countMap = () => new Map();
  const inc = (map, val) => {
    if (!val) return;
    map.set(val, (map.get(val) || 0) + 1);
  };

  const brands = countMap();
  const categories = countMap();
  const spf = countMap();
  const sizes = countMap();
  const skinTypes = countMap();
  const ingredients = countMap();
  const productTypes = countMap();
  const finishes = countMap();
  const retailers = countMap();

  let minPrice = Infinity;
  let maxPrice = 0;
  let discountedCount = 0;
  let ratedCount = 0;
  let inStockCount = 0;

  for (const p of products) {
    if (p.brand && p.brand !== "Independent / Other") inc(brands, p.brand);
    inc(categories, p.category);
    inc(spf, p.spf);
    inc(sizes, p.size);
    for (const s of p.skinTypes || []) inc(skinTypes, s);
    for (const i of p.ingredients || []) inc(ingredients, i);
    for (const t of p.productTypes || []) inc(productTypes, t);
    for (const f of p.finishes || []) inc(finishes, f);
    for (const r of p.retailers || []) inc(retailers, r);

    if (typeof p.lowestPrice === "number") {
      if (p.lowestPrice < minPrice) minPrice = p.lowestPrice;
      if (p.lowestPrice > maxPrice) maxPrice = p.lowestPrice;
    }
    if (p.maxDiscountPercent > 0) discountedCount++;
    if (typeof p.rating === "number") ratedCount++;
    if (p.inStock) inStockCount++;
  }

  const toSortedArray = (map) =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([value, count]) => ({ value, count }));

  return {
    brands: toSortedArray(brands),
    categories: toSortedArray(categories),
    spf: toSortedArray(spf),
    sizes: toSortedArray(sizes),
    skinTypes: toSortedArray(skinTypes),
    ingredients: toSortedArray(ingredients),
    productTypes: toSortedArray(productTypes),
    finishes: toSortedArray(finishes),
    retailers: toSortedArray(retailers),
    priceRange: {
      min: Number.isFinite(minPrice) ? minPrice : 0,
      max: maxPrice,
    },
    discountedCount,
    ratedCount,
    inStockCount,
  };
}
