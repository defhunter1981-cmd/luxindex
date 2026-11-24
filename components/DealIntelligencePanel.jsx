"use client";

import { memo, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Calculator,
  ShieldCheck,
  Truck,
  TrendingDown,
  Sparkles,
} from "lucide-react";
import { formatPrice } from "@/lib/utils";
import { EASE, DURATIONS } from "@/lib/motion";

const panelMotion = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: DURATIONS.slow, ease: EASE, delay: 0.18 },
};

function DealIntelligencePanel({
  offers = [],
  summary,
  priceIntelligence = null,
  currency = "INR",
}) {
  const [promoMode, setPromoMode] = useState("percent");
  const [promoValue, setPromoValue] = useState("");
  const [customShipping, setCustomShipping] = useState("");

  const activeOffers = useMemo(
    () =>
      offers.filter(
        (o) =>
          !o.isUnavailablePlaceholder &&
          o.inStock &&
          typeof o.displayPrice === "number" &&
          o.displayPrice > 0
      ),
    [offers]
  );

  const bestOffer = useMemo(() => {
    if (activeOffers.length === 0) return null;
    return activeOffers.reduce((min, curr) =>
      curr.displayPrice < min.displayPrice ? curr : min
    );
  }, [activeOffers]);

  const promoNumeric = parseFloat(promoValue);
  const shippingOverrideNumeric = parseFloat(customShipping);

  const calculator = useMemo(() => {
    if (!bestOffer) return null;

    const basePrice = bestOffer.displayPrice;
    const disclosedShipping = bestOffer.displayShippingCost;
    const shippingKnown = typeof disclosedShipping === "number";
    const shippingAmount = shippingKnown
      ? disclosedShipping
      : Number.isFinite(shippingOverrideNumeric) && shippingOverrideNumeric >= 0
      ? shippingOverrideNumeric
      : null;

    let promoSavings = 0;
    if (Number.isFinite(promoNumeric) && promoNumeric > 0) {
      if (promoMode === "percent") {
        const clampedPct = Math.min(promoNumeric, 80);
        promoSavings = (basePrice * clampedPct) / 100;
      } else {
        promoSavings = Math.min(promoNumeric, basePrice);
      }
    }

    const totalBeforeShipping = Math.max(0, basePrice - promoSavings);
    const landedTotal =
      shippingAmount != null ? totalBeforeShipping + shippingAmount : null;

    return {
      basePrice,
      shippingKnown,
      disclosedShipping,
      shippingAmount,
      promoSavings:
        currency === "USD"
          ? Math.round(promoSavings * 100) / 100
          : Math.round(promoSavings),
      totalBeforeShipping:
        currency === "USD"
          ? Math.round(totalBeforeShipping * 100) / 100
          : Math.round(totalBeforeShipping),
      landedTotal:
        landedTotal != null
          ? currency === "USD"
            ? Math.round(landedTotal * 100) / 100
            : Math.round(landedTotal)
          : null,
    };
  }, [bestOffer, promoNumeric, promoMode, shippingOverrideNumeric, currency]);

  if (!bestOffer) return null;

  return (
    <motion.section
      aria-label="Deal evaluation and landed savings calculator"
      className="grid grid-cols-1 gap-5 lg:grid-cols-12"
      {...panelMotion}
    >
      {/* Left: Best Retailer Recommendation */}
      <motion.div
        whileHover={{ y: -3 }}
        transition={{ duration: DURATIONS.fast, ease: EASE }}
        className="relative overflow-hidden rounded-[20px] border border-[#E4DFCF]/80 bg-white/88 p-5 shadow-[0_24px_70px_-56px_rgba(26,24,21,0.5)] backdrop-blur-sm sm:p-6 lg:col-span-6"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-14 -top-20 h-48 w-48 rounded-full bg-[radial-gradient(circle,rgba(212,222,180,0.22)_0%,rgba(250,248,245,0)_70%)]"
        />

        <div className="relative flex items-start justify-between gap-3 border-b border-[#EFEDE2]/70 pb-4">
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#141311]">
              Retailer Recommendation
            </p>
            <h3 className="mt-1.5 font-serif text-[1.3rem] font-normal tracking-[-0.015em] text-[#141311]">
              Best verified deal
            </h3>
          </div>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F6F8EA] text-[#5C6B2E] ring-1 ring-[#DCE5C0]/70">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          </span>
        </div>

        <dl className="relative mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <div className="group/tile rounded-xl border border-[#EFEDE2]/80 bg-[#F0EDE4]/70 p-3.5 transition-colors duration-200 hover:border-[#D5D2C2]/70 hover:bg-white">
            <dt className="font-mono text-[8px] uppercase tracking-[0.16em] text-[#8B8780]">
              Recommended store
            </dt>
            <dd className="mt-1.5 font-serif text-[15px] font-medium text-[#141311]">
              {bestOffer.retailer}
            </dd>
            <dd className="mt-0.5 font-mono text-[11px] text-[#4A5527] tabular-nums">
              {formatPrice(bestOffer.displayPrice, currency)}
            </dd>
          </div>

          <div className="group/tile rounded-xl border border-[#EFEDE2]/80 bg-[#F0EDE4]/70 p-3.5 transition-colors duration-200 hover:border-[#D5D2C2]/70 hover:bg-white">
            <dt className="font-mono text-[8px] uppercase tracking-[0.16em] text-[#8B8780]">
              Market spread savings
            </dt>
            <dd className="mt-1.5 flex items-center gap-1.5 font-mono text-[14px] font-semibold text-[#4A5527] tabular-nums">
              <TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />
              {summary?.maxSavings > 0
                ? formatPrice(summary.maxSavings, currency)
                : formatPrice(0, currency)}
            </dd>
            <dd className="mt-0.5 font-mono text-[8.5px] leading-relaxed text-[#8B8780]">
              {summary?.maxSavingsPercent > 0
                ? `${summary.maxSavingsPercent}% below highest active stockist`
                : "Lowest parity match"}
            </dd>
          </div>

          <div className="group/tile rounded-xl border border-[#EFEDE2]/80 bg-[#F0EDE4]/70 p-3.5 transition-colors duration-200 hover:border-[#D5D2C2]/70 hover:bg-white">
            <dt className="font-mono text-[8px] uppercase tracking-[0.16em] text-[#8B8780]">
              Fastest disclosed delivery
            </dt>
            <dd className="mt-1.5 flex items-center gap-1.5 text-[12px] font-medium text-[#141311]">
              <Truck className="h-3.5 w-3.5 text-[#8B8780]" aria-hidden="true" />
              {summary?.fastestStore
                ? `${summary.fastestStore} (~${summary.fastestDays}d)`
                : "Not disclosed"}
            </dd>
          </div>

          <div className="group/tile rounded-xl border border-[#EFEDE2]/80 bg-[#F0EDE4]/70 p-3.5 transition-colors duration-200 hover:border-[#D5D2C2]/70 hover:bg-white">
            <dt className="font-mono text-[8px] uppercase tracking-[0.16em] text-[#8B8780]">
              Stock coverage
            </dt>
            <dd className="mt-1.5 font-mono text-[11px] font-medium leading-relaxed text-[#141311] tabular-nums">
              {summary?.activeCount || activeOffers.length} of{" "}
              {offers.filter((o) => !o.isUnavailablePlaceholder).length} returned
              offers in stock
            </dd>
          </div>
        </dl>

        {(summary?.averagePrice != null ||
          summary?.pricePer100Unit != null ||
          priceIntelligence) && (
          <div className="relative mt-3 grid grid-cols-1 gap-2 border-t border-[#EFEDE2]/60 pt-3.5 sm:grid-cols-3">
            <div className="rounded-lg bg-[#F0EDE4]/80 px-3 py-2">
              <span className="block font-mono text-[7.5px] uppercase tracking-[0.14em] text-[#8B8780]">
                Average market
              </span>
              <span className="mt-1 block font-mono text-[11px] font-medium text-[#141311] tabular-nums">
                {summary?.averagePrice != null
                  ? formatPrice(summary.averagePrice, currency)
                  : "—"}
              </span>
            </div>
            <div className="rounded-lg bg-[#F0EDE4]/80 px-3 py-2">
              <span className="block font-mono text-[7.5px] uppercase tracking-[0.14em] text-[#8B8780]">
                {summary?.unitLabel || "Normalized unit"}
              </span>
              <span className="mt-1 block font-mono text-[11px] font-medium text-[#141311] tabular-nums">
                {summary?.pricePer100Unit != null
                  ? formatPrice(summary.pricePer100Unit, currency)
                  : "Size unverified"}
              </span>
            </div>
            <div className="rounded-lg bg-[#F0EDE4]/80 px-3 py-2">
              <span className="block font-mono text-[7.5px] uppercase tracking-[0.14em] text-[#8B8780]">
                Recorded windows
              </span>
              <span className="mt-1 block font-mono text-[9.5px] font-medium leading-relaxed text-[#141311] tabular-nums">
                {priceIntelligence
                  ? `${priceIntelligence.history7d?.observationCount || 0} / ${priceIntelligence.history30d?.observationCount || 0} / ${priceIntelligence.history90d?.observationCount || 0} pts (${priceIntelligence.history30d?.volatilityLabel || "Unrecorded"})`
                  : "Pending snapshots"}
              </span>
            </div>
          </div>
        )}
      </motion.div>

      {/* Right: Landed Total Estimator */}
      <motion.div
        whileHover={{ y: -3 }}
        transition={{ duration: DURATIONS.fast, ease: EASE }}
        className="relative overflow-hidden rounded-[20px] border border-[#E4DFCF]/80 bg-[linear-gradient(170deg,#FFFFFF_0%,#FDFAF6_60%,#FBF5EF_100%)] p-5 shadow-[0_24px_70px_-56px_rgba(26,24,21,0.5)] sm:p-6 lg:col-span-6"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-16 -bottom-20 h-48 w-48 rounded-full bg-[radial-gradient(circle,rgba(201,242,77,0.14)_0%,rgba(250,248,245,0)_70%)]"
        />

        <div className="relative flex items-start justify-between gap-3 border-b border-[#EFEDE2]/70 pb-4">
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#141311]">
              Landed Total Estimator
            </p>
            <h3 className="mt-1.5 font-serif text-[1.3rem] font-normal tracking-[-0.015em] text-[#141311]">
              Savings &amp; checkout simulator
            </h3>
          </div>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F0EDE4] text-[#141311] ring-1 ring-[#E3DFD2]/70">
            <Calculator className="h-4 w-4" aria-hidden="true" />
          </span>
        </div>

        <div className="relative mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label
              htmlFor="luxe-promo-input"
              className="block font-mono text-[8px] uppercase tracking-[0.16em] text-[#8B8780]"
            >
              Store voucher ({promoMode === "percent" ? "% off" : `${currency} off`})
            </label>
            <div className="mt-1.5 flex">
              <input
                id="luxe-promo-input"
                type="number"
                min="0"
                step="any"
                placeholder={promoMode === "percent" ? "e.g. 10" : "e.g. 150"}
                value={promoValue}
                onChange={(e) => setPromoValue(e.target.value)}
                className="min-h-[40px] w-full rounded-l-lg border border-[#D8D4C6] bg-white/80 px-3 font-mono text-xs text-[#141311] transition-all duration-200 placeholder:text-[#B4B2A4] focus:border-[#3A3733] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#3A3733]/8"
              />
              <button
                type="button"
                onClick={() =>
                  setPromoMode((prev) => (prev === "percent" ? "flat" : "percent"))
                }
                className="shrink-0 rounded-r-lg border border-l-0 border-[#D8D4C6] bg-[#F0EDE4] px-3 font-mono text-[10px] font-medium text-[#141311] transition-colors hover:bg-[#EAE7DC]"
              >
                {promoMode === "percent" ? "%" : currency}
              </button>
            </div>
          </div>

          <div>
            <label
              htmlFor="luxe-ship-input"
              className="block font-mono text-[8px] uppercase tracking-[0.16em] text-[#8B8780]"
            >
              {calculator?.shippingKnown
                ? "Disclosed retailer shipping"
                : `Estimated shipping (${currency})`}
            </label>
            {calculator?.shippingKnown ? (
              <div className="mt-1.5 flex min-h-[40px] items-center rounded-lg border border-[#EFEDE2]/80 bg-[#F0EDE4]/70 px-3 font-mono text-xs text-[#141311]">
                {calculator.disclosedShipping === 0
                  ? "Free (disclosed)"
                  : formatPrice(calculator.disclosedShipping, currency)}
              </div>
            ) : (
              <input
                id="luxe-ship-input"
                type="number"
                min="0"
                step="any"
                placeholder="Not disclosed"
                value={customShipping}
                onChange={(e) => setCustomShipping(e.target.value)}
                className="mt-1.5 min-h-[40px] w-full rounded-lg border border-[#D8D4C6] bg-white/80 px-3 font-mono text-xs text-[#141311] transition-all duration-200 placeholder:text-[#B4B2A4] focus:border-[#3A3733] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#3A3733]/8"
              />
            )}
          </div>
        </div>

        <motion.div
          key={calculator?.landedTotal ?? calculator?.totalBeforeShipping ?? "empty"}
          initial={{ opacity: 0.55 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.22 }}
          className="relative mt-5 overflow-hidden rounded-xl border border-[#E8E3D2]/70 bg-[linear-gradient(120deg,#FDF9F1_0%,#FAF4EA_60%,#FBF0EA_100%)] px-4 py-4"
        >
          <div
            aria-hidden="true"
            className="absolute left-0 top-0 h-full w-[2px] bg-gradient-to-b from-[#8B8780] to-[#5C6B2E]"
          />
          <div className="flex flex-wrap items-end justify-between gap-3 pl-2">
            <div className="font-mono text-[10px] leading-relaxed text-[#75716B]">
              {calculator?.promoSavings > 0 && (
                <span className="mr-3 block text-[#4A5527]">
                  Voucher: &minus;{formatPrice(calculator.promoSavings, currency)}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="h-3 w-3 text-[#5C6B2E]" aria-hidden="true" />
                {calculator?.landedTotal != null
                  ? "Estimated landed payable"
                  : "Subtotal (shipping not disclosed)"}
              </span>
            </div>
            <span className="font-serif text-[1.5rem] leading-none text-[#141311] tabular-nums">
              {calculator?.landedTotal != null
                ? formatPrice(calculator.landedTotal, currency)
                : formatPrice(calculator?.totalBeforeShipping, currency)}
            </span>
          </div>
        </motion.div>
      </motion.div>
    </motion.section>
  );
}

export default memo(DealIntelligencePanel);
