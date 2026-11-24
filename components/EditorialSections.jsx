"use client";

import { useCallback, useRef, useState } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Sparkle,
  Star,
} from "lucide-react";
import { TRENDING_CATEGORIES } from "@/data/mockCatalog";
import { convertCurrency, formatPrice } from "@/lib/utils";
import { EASE_REVEAL } from "@/lib/motion";
import { optimizeImageUrl } from "@/lib/imageUrl";

/* ── AestheticMatch editorial palette ────────────────────────
   Clean white canvas, warm cream product surfaces, near-black
   serif type, soft grey support copy, bright yellow-green accent
   used sparingly. */
const INK = "#141311";
const GREY = "#75716B";
const CREAM = "#F3EFE7";
const LIME = "#C9F24D";
const RADIUS_IMG = "2rem";

function scrollToId(id) {
  if (typeof document === "undefined") return;
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

const reveal = {
  hidden: { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE_REVEAL } },
};

function SectionEyebrow({ children }) {
  return (
    <p
      className="text-[11px] font-semibold uppercase tracking-[0.22em]"
      style={{ color: GREY }}
    >
      {children}
    </p>
  );
}

function BlackPill({ children, onClick, className = "", ariaLabel }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.97 }}
      transition={{ duration: 0.25, ease: EASE_REVEAL }}
      className={`inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full px-7 text-[15px] font-medium text-white ${className}`}
      style={{ backgroundColor: INK }}
    >
      {children}
    </motion.button>
  );
}

function lowestInStockPrice(product, currency) {
  const inStock = (product.offers || []).filter((o) => o.inStock);
  const pool = inStock.length ? inStock : product.offers || [];
  if (!pool.length) return null;
  const min = Math.min(...pool.map((o) => o.price));
  return formatPrice(convertCurrency(min, "INR", currency), currency);
}

/* ── Shared product card (cream surface, square image) ─────── */
function ProductCard({ product, currency, onSelect, wide = false }) {
  return (
    <motion.div
      whileHover="hover"
      initial="rest"
      animate="rest"
      variants={{ rest: {}, hover: {} }}
      className="group flex flex-col overflow-hidden rounded-[2rem]"
      style={{ backgroundColor: CREAM }}
    >
      <button
        type="button"
        onClick={() => onSelect(product)}
        aria-label={`Compare ${product.name} across retailers`}
        className="relative block aspect-square w-full overflow-hidden focus-visible:outline-2 focus-visible:outline-offset-2"
        style={{ outlineColor: LIME }}
      >
        <Image
          src={optimizeImageUrl(product.image, 700)}
          alt={product.name}
          fill
          sizes="(max-width: 768px) 90vw, (max-width: 1280px) 40vw, 30vw"
          className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
        />
        {product.mrp && (
          <span
            className="absolute left-4 top-4 rounded-full px-3 py-1 text-[11px] font-semibold"
            style={{ backgroundColor: LIME, color: INK }}
          >
            MRP ₹{product.mrp.toLocaleString("en-IN")}
          </span>
        )}
      </button>

      <div className={`flex flex-1 flex-col p-5 ${wide ? "sm:p-6" : ""}`}>
        <p
          className="text-[11px] uppercase tracking-[0.18em]"
          style={{ color: GREY }}
        >
          {product.brand}
        </p>
        <h3
          className="mt-1.5 font-serif text-[19px] leading-snug lux-serif-display"
          style={{ color: INK }}
        >
          {product.shortName || product.name}
        </h3>
        <div
          className="mt-2 flex items-center gap-1.5 text-[12.5px]"
          style={{ color: GREY }}
        >
          <Star className="h-3.5 w-3.5 fill-current" style={{ color: INK }} />
          <span className="font-semibold" style={{ color: INK }}>
            {product.rating}
          </span>
          <span>·</span>
          <span>{product.reviewCount?.toLocaleString("en-IN")} reviews</span>
        </div>

        <div className="mt-4 flex items-end justify-between gap-3">
          <div>
            <p className="text-[11px]" style={{ color: GREY }}>
              Best in index
            </p>
            <p
              className="font-serif text-[22px] leading-none lux-serif-display"
              style={{ color: INK }}
            >
              {lowestInStockPrice(product, currency) || "—"}
            </p>
          </div>
          <motion.button
            type="button"
            onClick={() => onSelect(product)}
            aria-label={`Compare ${product.name} across retailers`}
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.94 }}
            className="flex h-11 w-11 items-center justify-center rounded-full text-white transition-colors duration-300 group-hover:text-black"
            style={{ backgroundColor: INK }}
          >
            <ArrowRight className="h-4 w-4" />
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}

/* ── C. Most Popular — horizontal carousel ─────────────────── */
function MostPopular({ products, currency, onSelect }) {
  const scrollerRef = useRef(null);

  const nudge = useCallback((dir) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.min(el.clientWidth * 0.8, 720), behavior: "smooth" });
  }, []);

  return (
    <section aria-labelledby="most-popular-heading" className="py-16 sm:py-20">
      <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }} variants={reveal}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <SectionEyebrow>The index · by review volume</SectionEyebrow>
            <h2
              id="most-popular-heading"
              className="mt-3 max-w-[16ch] font-serif text-[2.1rem] leading-[1.05] lux-serif-display sm:text-[2.9rem]"
              style={{ color: INK }}
            >
              The most reviewed{" "}
              <span
                className="rounded px-2"
                style={{ backgroundColor: LIME, color: INK }}
              >
                beauty
              </span>{" "}
              formulas
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => nudge(-1)}
              aria-label="Scroll products left"
              className="flex h-11 w-11 items-center justify-center rounded-full border transition-colors duration-200"
              style={{ borderColor: INK, color: INK }}
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => nudge(1)}
              aria-label="Scroll products right"
              className="flex h-11 w-11 items-center justify-center rounded-full text-white transition-opacity duration-200"
              style={{ backgroundColor: INK }}
            >
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </motion.div>

      <div
        ref={scrollerRef}
        className="mt-10 flex snap-x snap-mandatory gap-5 overflow-x-auto pb-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {products.map((product) => (
          <div
            key={product.id}
            className="w-[78%] shrink-0 snap-start sm:w-[46%] lg:w-[31%]"
          >
            <ProductCard product={product} currency={currency} onSelect={onSelect} />
          </div>
        ))}
      </div>

      <div className="mt-4">
        <BlackPill onClick={() => scrollToId("best-sellers-heading")}>
          Shop the index <ArrowRight className="h-4 w-4" />
        </BlackPill>
      </div>
    </section>
  );
}

/* ── D. Editorial beauty feature — asymmetric two columns ──── */
function EditorialFeature() {
  return (
    <section aria-labelledby="editorial-feature-heading" className="py-16 sm:py-20">
      <div className="grid gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-center lg:gap-16">
        <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }} variants={reveal} className="relative">
          <div className="relative aspect-[4/5] w-full overflow-hidden" style={{ borderRadius: RADIUS_IMG }}>
            <Image
              src="https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=900&h=1125&q=70"
              alt="Luxury beauty products arranged on a warm stone surface"
              fill
              sizes="(max-width: 1024px) 92vw, 45vw"
              className="object-cover"
            />
          </div>
          <div
            className="absolute -bottom-6 -right-2 hidden max-w-[220px] rounded-[1.5rem] p-5 shadow-xl sm:block"
            style={{ backgroundColor: "white" }}
          >
            <p className="font-serif text-[15px] leading-snug lux-serif-display" style={{ color: INK }}>
              Five flagship retailers, one honest index.
            </p>
          </div>
        </motion.div>

        <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }} variants={reveal}>
          <SectionEyebrow>The editorial standard</SectionEyebrow>
          <h2
            id="editorial-feature-heading"
            className="mt-3 font-serif text-[2.1rem] leading-[1.06] lux-serif-display sm:text-[2.9rem]"
            style={{ color: INK }}
          >
            Beauty pricing, finally{" "}
            <span className="italic" style={{ color: GREY }}>
              in plain sight.
            </span>
          </h2>
          <div className="mt-6 flex flex-wrap gap-2">
            {TRENDING_CATEGORIES.filter((c) => c !== "All").slice(0, 6).map((cat) => (
              <span
                key={cat}
                className="rounded-full border px-4 py-1.5 text-[13px]"
                style={{ borderColor: CREAM, backgroundColor: CREAM, color: INK }}
              >
                {cat}
              </span>
            ))}
          </div>
          <p className="mt-6 max-w-[52ch] text-[15.5px] leading-[1.8]" style={{ color: GREY }}>
            LuxeIndex aligns exact variants — volume, formulation, finish —
            before comparing a single rupee. If a price cannot be verified, it
            is disclosed as curated, never presented as live.
          </p>
          <div className="mt-8 relative aspect-[16/9] w-full overflow-hidden" style={{ borderRadius: RADIUS_IMG }}>
            <Image
              src="https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=1200&h=675&q=70"
              alt="Makeup artist palette with warm neutral tones"
              fill
              sizes="(max-width: 1024px) 92vw, 52vw"
              className="object-cover"
            />
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/* ── E. Best sellers — real review-count grid ──────────────── */
function BestSellers({ products, currency, onSelect }) {
  return (
    <section aria-labelledby="best-sellers-heading" className="py-16 sm:py-20">
      <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }} variants={reveal}>
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="max-w-[54ch]">
            <SectionEyebrow>Across the index</SectionEyebrow>
            <h2
              id="best-sellers-heading"
              className="mt-3 scroll-mt-28 font-serif text-[2.1rem] leading-[1.05] lux-serif-display sm:text-[2.9rem]"
              style={{ color: INK }}
            >
              Formulas the index watches closest
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed" style={{ color: GREY }}>
              Every card below is a real index entry with observed retailer
              offers — ordered by recorded review volume, not invented rankings.
            </p>
          </div>
          <BlackPill onClick={() => scrollToId("search-anchor")} ariaLabel="Jump to the search field">
            Start a comparison <ArrowRight className="h-4 w-4" />
          </BlackPill>
        </div>
      </motion.div>

      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((product, idx) => (
          <motion.div
            key={product.id}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-60px" }}
            variants={{
              hidden: reveal.hidden,
              visible: {
                ...reveal.visible,
                transition: { duration: 0.7, ease: EASE_REVEAL, delay: (idx % 3) * 0.08 },
              },
            }}
          >
            <ProductCard product={product} currency={currency} onSelect={onSelect} wide />
          </motion.div>
        ))}
      </div>
    </section>
  );
}

/* ── F. Support & honesty panels over photography ──────────── */
function SupportPanels({ onOpenWatchlist }) {
  return (
    <section aria-labelledby="support-heading" className="py-16 sm:py-20">
      <div className="relative overflow-hidden" style={{ borderRadius: "2.5rem" }}>
        <Image
          src="https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=1600&h=900&q=65"
          alt=""
          aria-hidden="true"
          fill
          sizes="100vw"
          className="object-cover"
          priority={false}
        />
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{ background: "linear-gradient(180deg, rgba(20,19,17,0.42) 0%, rgba(20,19,17,0.62) 100%)" }}
        />
        <div className="relative px-5 py-14 sm:px-10 lg:px-14">
          <SectionEyebrow>
            <span className="text-white/70">Platform honesty</span>
          </SectionEyebrow>
          <h2
            id="support-heading"
            className="mt-3 max-w-[18ch] font-serif text-[2rem] leading-[1.06] text-white lux-serif-display sm:text-[2.7rem]"
          >
            What you can always count on
          </h2>

          <div className="mt-10 grid gap-5 md:grid-cols-2">
            <div className="rounded-[1.75rem] bg-white p-7 lg:p-9">
              <p className="font-serif text-[1.4rem] leading-tight lux-serif-display" style={{ color: INK }}>
                Verified or labelled
              </p>
              <ul className="mt-5 space-y-3 text-[14.5px] leading-relaxed" style={{ color: GREY }}>
                <li className="flex gap-3">
                  <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: LIME }} />
                  Live snapshots arrive from Google Shopping retail listings through cache-first providers with quota safeguards.
                </li>
                <li className="flex gap-3">
                  <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: LIME }} />
                  When live feeds stand down, the interface says so plainly and serves the curated demonstration baseline.
                </li>
                <li className="flex gap-3">
                  <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: LIME }} />
                  Variant alignment rejects mismatched volumes and formulations before pricing.
                </li>
              </ul>
              <button
                type="button"
                onClick={() => scrollToId("faq-heading")}
                className="lux-underline-reveal mt-6 inline-block text-[14px] font-medium"
                style={{ color: INK }}
              >
                Read the FAQ
              </button>
            </div>

            <div className="rounded-[1.75rem] p-7 lg:p-9" style={{ backgroundColor: CREAM }}>
              <p className="font-serif text-[1.4rem] leading-tight lux-serif-display" style={{ color: INK }}>
                Your watchlist works offline-first
              </p>
              <p className="mt-4 text-[14.5px] leading-relaxed" style={{ color: GREY }}>
                Saved products, target prices and search history stay on this
                device. Alerts trigger the moment an observed price reaches your
                target while you browse.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <BlackPill onClick={onOpenWatchlist} className="min-h-[44px] px-6 text-[14px]">
                  Open watchlist
                </BlackPill>
                <span className="text-[12.5px]" style={{ color: GREY }}>
                  No account required.
                </span>
              </div>
              <div className="mt-7 flex items-center gap-4 rounded-[1.25rem] bg-white p-3">
                <Image
                  src="https://images.unsplash.com/photo-1617825295690-28ae56c56135?auto=format&fit=crop&w=320&h=320&q=70"
                  alt="Laneige lip sleeping mask on a soft backdrop"
                  width={72}
                  height={72}
                  className="h-[72px] w-[72px] rounded-[1rem] object-cover"
                />
                <p className="text-[13px] leading-snug" style={{ color: GREY }}>
                  Track any of the {`9`} curated formulas or search millions of
                  live retail listings.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── G. Capabilities as image-led cards (no fabricated blog) ── */
function CapabilityCards() {
  const cards = [
    {
      title: "Price history you can audit",
      copy: "Every comparison carries its source: live observation or curated baseline, named in the header.",
      img: "https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=1000&h=750&q=70",
      alt: "Serum dropper beside notebook and charts",
    },
    {
      title: "Deal intelligence, not deal theatre",
      copy: "Discounts are computed from recorded MRP against observed offer prices — never from countdown timers.",
      img: "https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?auto=format&fit=crop&w=1000&h=750&q=70",
      alt: "Woman holding a skincare bottle in soft daylight",
    },
  ];

  return (
    <section aria-labelledby="capability-heading" className="py-16 sm:py-20">
      <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }} variants={reveal}>
        <SectionEyebrow>Inside the index</SectionEyebrow>
        <h2
          id="capability-heading"
          className="mt-3 font-serif text-[2.1rem] leading-[1.05] lux-serif-display sm:text-[2.9rem]"
          style={{ color: INK }}
        >
          Built for shoppers who read the footnotes
        </h2>
      </motion.div>

      <div className="mt-10 grid gap-5 md:grid-cols-2">
        {cards.map((card, i) => (
          <motion.a
            key={card.title}
            href="#comparison-workspace"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-60px" }}
            variants={{
              hidden: reveal.hidden,
              visible: { ...reveal.visible, transition: { duration: 0.7, ease: EASE_REVEAL, delay: i * 0.1 } },
            }}
            className="group relative block aspect-[4/3] overflow-hidden focus-visible:outline-2 focus-visible:outline-offset-2"
            style={{ borderRadius: RADIUS_IMG, outlineColor: LIME }}
          >
            <Image
              src={card.img}
              alt={card.alt}
              fill
              sizes="(max-width: 768px) 92vw, 45vw"
              className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
            />
            <div
              aria-hidden="true"
              className="absolute inset-0"
              style={{ background: "linear-gradient(180deg, rgba(20,19,17,0) 42%, rgba(20,19,17,0.68) 100%)" }}
            />
            <div className="absolute bottom-4 left-4 right-4 rounded-[1.25rem] bg-white/12 p-5 backdrop-blur-md">
              <h3 className="font-serif text-[19px] leading-snug text-white lux-serif-display">
                {card.title}
              </h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-white/80">{card.copy}</p>
            </div>
          </motion.a>
        ))}
      </div>
    </section>
  );
}

/* ── H. Before / After — price discipline, not skin claims ─── */
function BeforeAfter({ product, currency }) {
  const offers = product?.offers || [];
  const inStock = offers.filter((o) => o.inStock);
  const pool = inStock.length ? inStock : offers;
  const best = pool.length ? pool.reduce((a, b) => (b.price < a.price ? b : a)) : null;
  const worst = pool.length ? pool.reduce((a, b) => (b.price > a.price ? b : a)) : null;
  const [pos, setPos] = useState(50);
  const frameRef = useRef(null);
  const draggingRef = useRef(false);

  const applyClientX = (clientX) => {
    const el = frameRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setPos(Math.min(97, Math.max(3, pct)));
  };

  if (!best || !worst) return null;
  const spread = formatPrice(
    convertCurrency(worst.price - best.price, "INR", currency),
    currency
  );
  const IMG =
    "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&w=1400&h=800&q=70";

  return (
    <section aria-labelledby="before-after-heading" className="py-16 sm:py-20">
      <motion.div
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-80px" }}
        variants={reveal}
        className="mx-auto max-w-[62ch] text-center"
      >
        <SectionEyebrow>Drag to compare</SectionEyebrow>
        <h2
          id="before-after-heading"
          className="mt-3 font-serif text-[2.1rem] leading-[1.06] lux-serif-display sm:text-[2.9rem]"
          style={{ color: INK }}
        >
          The same bottle. A different retailer.
        </h2>
        <p className="mt-4 text-[15px] leading-relaxed" style={{ color: GREY }}>
          No skin claims — just what {product.shortName || product.name} costs at
          its most and least favourable flagship retailer in today&apos;s index.
          Observed gap: <strong style={{ color: INK }}>{spread}</strong>.
        </p>
      </motion.div>

      <motion.div
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-60px" }}
        variants={reveal}
        ref={frameRef}
        className="relative mx-auto mt-10 aspect-[7/4] max-w-4xl touch-pan-y select-none overflow-hidden cursor-ew-resize"
        style={{ borderRadius: "2.5rem" }}
        onPointerDown={(e) => {
          draggingRef.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          applyClientX(e.clientX);
        }}
        onPointerMove={(e) => {
          if (!draggingRef.current) return;
          applyClientX(e.clientX);
        }}
        onPointerUp={() => {
          draggingRef.current = false;
        }}
        onPointerCancel={() => {
          draggingRef.current = false;
        }}
      >
        <Image src={IMG} alt="" aria-hidden="true" fill priority={false} sizes="(max-width: 1024px) 92vw, 896px" className="object-cover" draggable={false} />

        {/* "Before" half — dimmed, shows highest price */}
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background: "rgba(20,19,17,0.55)",
            clipPath: `inset(0 ${100 - pos}% 0 0)`,
          }}
        />

        <div
          className="absolute top-4 rounded-full px-4 py-1.5 text-[12px] font-semibold"
          style={{ left: "1rem", backgroundColor: "rgba(255,255,255,0.9)", color: INK, maxWidth: "44%" }}
        >
          Paid {worst.retailer}: {formatPrice(convertCurrency(worst.price, "INR", currency), worst.currency || "INR")}
        </div>
        <div
          className="absolute top-4 rounded-full px-4 py-1.5 text-[12px] font-semibold"
          style={{ right: "1rem", backgroundColor: LIME, color: INK, maxWidth: "44%" }}
        >
          Best {best.retailer}: {formatPrice(convertCurrency(best.price, "INR", currency), best.currency || "INR")}
        </div>

        {/* Divider + handle */}
        <div aria-hidden="true" className="absolute inset-y-0 w-[3px] bg-white" style={{ left: `${pos}%`, transform: "translateX(-50%)" }} />
        <div
          role="slider"
          tabIndex={0}
          aria-label="Reveal index best price"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pos)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setPos((p) => Math.max(3, p - 4));
            if (e.key === "ArrowRight") setPos((p) => Math.min(97, p + 4));
          }}
          className="absolute flex h-12 w-12 items-center justify-center rounded-full text-black shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2"
          style={{ left: `${pos}%`, top: "50%", transform: "translate(-50%, -50%)", backgroundColor: LIME, outlineColor: INK }}
        >
          <ArrowLeft className="absolute left-[9px] h-3.5 w-3.5" />
          <ArrowRight className="absolute right-[9px] h-3.5 w-3.5" />
        </div>
      </motion.div>
    </section>
  );
}

/* ── I. FAQ — accordion, first expanded ────────────────────── */
const FAQS = [
  {
    q: "What exactly is LuxeIndex?",
    a: "A beauty discovery and price-comparison index. Search a product to see verified retailer offers aligned by exact variant — volume, formulation and stock — across Sephora, Nykaa, Amazon Luxury, Cult Beauty and Space NK, plus 20+ deeper merchant sources in discovery mode.",
  },
  {
    q: "Where do the prices come from?",
    a: "Live queries run through retail-search providers (SerpApi, Serper, SearchApi) against Google Shopping listings, with results cached briefly to protect quotas. When live feeds are unavailable, the page says so and shows the curated demonstration baseline instead of pretending otherwise.",
  },
  {
    q: "How do watchlist price alerts work?",
    a: "Save a product and set a target price. The alert lives in this browser — nothing leaves your device — and triggers a banner the moment an observed price meets your target while you keep browsing.",
  },
  {
    q: "Which currencies are supported?",
    a: "Prices display in INR or USD with a one-tap toggle. Conversions use a fixed reference rate shown consistently across the matrix, charts and cards.",
  },
  {
    q: "Why does a product show fewer retailers than expected?",
    a: "Offers are only listed when the variant matches exactly. A 50ml jar is never priced against a 30ml one, and unverified merchant listings are separated from confirmed flagship offers rather than blended in.",
  },
];

function Faq() {
  const [open, setOpen] = useState(0);

  return (
    <section aria-labelledby="faq-heading" className="py-16 sm:py-20">
      <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
        <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }} variants={reveal}>
          <SectionEyebrow>Questions</SectionEyebrow>
          <h2
            id="faq-heading"
            className="mt-3 scroll-mt-28 font-serif text-[2.1rem] leading-[1.06] lux-serif-display sm:text-[2.7rem]"
            style={{ color: INK }}
          >
            Everything shoppers ask before they trust an index
          </h2>
          <p className="mt-5 max-w-[40ch] text-[15px] leading-relaxed" style={{ color: GREY }}>
            Straight answers about data sources, alerts and the limits of what
            any comparison tool can promise.
          </p>
        </motion.div>

        <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }} variants={reveal} className="space-y-3">
          {FAQS.map((item, idx) => {
            const isOpen = open === idx;
            return (
              <div
                key={item.q}
                className="overflow-hidden rounded-[1.5rem] transition-colors duration-300"
                style={{ backgroundColor: isOpen ? CREAM : "white", boxShadow: isOpen ? "none" : `inset 0 0 0 1px ${CREAM}` }}
              >
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? -1 : idx)}
                  className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2"
                  style={{ outlineColor: LIME }}
                >
                  <span className="font-serif text-[17px] leading-snug lux-serif-display" style={{ color: INK }}>
                    {item.q}
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`}
                    style={{ color: isOpen ? INK : GREY }}
                  />
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      key="body"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.35, ease: EASE_REVEAL }}
                    >
                      <p className="px-6 pb-6 text-[14.5px] leading-[1.8]" style={{ color: GREY }}>
                        {item.a}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}

/* ── J. Editorial collage ──────────────────────────────────── */
function Collage() {
  const shots = [
    { src: "https://images.unsplash.com/photo-1487412947147-5cebf100ffc2?auto=format&fit=crop&w=800&h=1000&q=70", alt: "Beauty portrait with warm natural light", klass: "aspect-[4/5] lg:mt-0" },
    { src: "https://images.unsplash.com/photo-1571781926291-c477ebfd024b?auto=format&fit=crop&w=800&h=1100&q=70", alt: "Beauty product photography in warm daylight", klass: "aspect-[3/4] lg:mt-16" },
    { src: "https://images.unsplash.com/photo-1522337660859-02fbefca4702?auto=format&fit=crop&w=800&h=950&q=70", alt: "Makeup brushes on a neutral surface", klass: "aspect-[4/5] lg:mt-6" },
  ];

  return (
    <section aria-labelledby="collage-heading" className="py-16 sm:py-20">
      <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }} variants={reveal} className="mx-auto max-w-[46ch] text-center">
        <SectionEyebrow>The mood of the index</SectionEyebrow>
        <h2
          id="collage-heading"
          className="mt-3 font-serif text-[2.1rem] leading-[1.08] lux-serif-display sm:text-[2.7rem]"
          style={{ color: INK }}
        >
          Considered beauty deserves considered pricing
        </h2>
      </motion.div>

      <div className="mt-12 grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-3">
        {shots.map((shot, i) => (
          <motion.div
            key={shot.src}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-40px" }}
            variants={{
              hidden: reveal.hidden,
              visible: { ...reveal.visible, transition: { duration: 0.7, ease: EASE_REVEAL, delay: i * 0.12 } },
            }}
            className={`overflow-hidden ${shot.klass} ${i === 2 ? "col-span-2 lg:col-span-1" : ""}`}
            style={{ borderRadius: RADIUS_IMG }}
          >
            <Image
              src={shot.src}
              alt={shot.alt}
              fill={false}
              width={800}
              height={1000}
              sizes="(max-width: 768px) 46vw, 30vw"
              className="h-full w-full object-cover"
            />
          </motion.div>
        ))}
      </div>
    </section>
  );
}

/* ── K. Shopping banner ────────────────────────────────────── */
function ShoppingBanner() {
  return (
    <section aria-label="Start browsing the beauty index" className="py-10 sm:py-14">
      <motion.div
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-80px" }}
        variants={reveal}
        className="relative overflow-hidden"
        style={{ borderRadius: "2.5rem" }}
      >
        <Image
          src="https://images.unsplash.com/photo-1512207736890-6ffed8a84e8d?auto=format&fit=crop&w=1800&h=800&q=65"
          alt="Campaign photograph of luxury cosmetics on silk"
          fill
          sizes="100vw"
          className="object-cover"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{ background: "linear-gradient(90deg, rgba(20,19,17,0.55) 0%, rgba(20,19,17,0.18) 100%)" }}
        />
        <div className="relative flex flex-col items-start px-6 py-16 sm:px-12 lg:px-16 lg:py-24">
          <div className="flex items-center gap-2 text-white/90">
            <Sparkle className="h-4 w-4" style={{ color: LIME }} />
            <Star className="h-3 w-3 fill-current" />
            <Star className="h-3 w-3 fill-current" />
          </div>
          <h2 className="mt-4 max-w-[16ch] font-serif text-[2.3rem] leading-[1.04] text-white lux-serif-display sm:text-[3.2rem]">
            Search once. Save across five flagship stores.
          </h2>
          <motion.button
            type="button"
            onClick={() => scrollToId("search-anchor")}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.97 }}
            aria-label="Jump to the search field"
            className="mt-8 inline-flex min-h-[52px] items-center gap-2 rounded-full bg-white px-8 text-[15px] font-medium"
            style={{ color: INK }}
          >
            Shop the index <ArrowRight className="h-4 w-4" />
          </motion.button>
        </div>
      </motion.div>
    </section>
  );
}

/* ── Composition ───────────────────────────────────────────── */
export default function EditorialSections({
  catalog,
  currency,
  onSelectProduct,
  onOpenWatchlist,
}) {
  const byReviews = [...catalog].sort((a, b) => (b.reviewCount || 0) - (a.reviewCount || 0));
  const carouselItems = byReviews;
  const gridItems = byReviews;
  const spreadProduct = byReviews[0] || catalog[0];

  return (
    <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-10">
      <MostPopular products={carouselItems} currency={currency} onSelect={onSelectProduct} />
      <EditorialFeature />
      <BestSellers products={gridItems} currency={currency} onSelect={onSelectProduct} />
      <SupportPanels onOpenWatchlist={onOpenWatchlist} />
      <CapabilityCards />
      <BeforeAfter product={spreadProduct} currency={currency} />
      <Faq />
      <Collage />
      <ShoppingBanner />
    </div>
  );
}
