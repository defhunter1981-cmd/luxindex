"use client";

import { memo, useState, useEffect, useRef } from "react";
import {
  X,
  Bell,
  Trash2,
  ArrowRight,
  History,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { formatPrice, convertCurrency, cn } from "@/lib/utils";
import { EASE, DURATIONS, SPRINGS } from "@/lib/motion";

const drawerVariants = {
  hidden: { x: "100%" },
  visible: {
    x: 0,
    transition: { type: "spring", stiffness: 300, damping: 32, mass: 0.85 },
  },
  exit: { x: "100%", transition: { duration: 0.24, ease: EASE } },
};

const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: DURATIONS.base } },
  exit: { opacity: 0, transition: { duration: 0.18 } },
};

function WatchlistDrawer({
  isOpen,
  onClose,
  activeProduct,
  activeBestPrice,
  activeBestStore,
  currency = "INR",
  isLive = false,
  watchlist = [],
  comparisonHistory = [],
  onSaveTarget,
  onRemoveWatch,
  onSelectQuery,
}) {
  const defaultSuggestedTarget =
    typeof activeBestPrice === "number" && activeBestPrice > 0
      ? currency === "USD"
        ? Math.round(activeBestPrice * 0.9 * 100) / 100
        : Math.round(activeBestPrice * 0.9)
      : "";

  const existingActiveWatch = activeProduct
    ? watchlist.find((w) => w.id === activeProduct.id)
    : null;

  const [targetInput, setTargetInput] = useState(
    existingActiveWatch?.targetPrice != null
      ? String(existingActiveWatch.targetPrice)
      : String(defaultSuggestedTarget)
  );
  const [formError, setFormError] = useState("");
  const [savedNotice, setSavedNotice] = useState(false);
  const closeButtonRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  // Focus the drawer on open and restore focus to the trigger on close.
  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement;
    const focusTimer = setTimeout(() => closeButtonRef.current?.focus(), 30);
    return () => {
      clearTimeout(focusTimer);
      if (
        previouslyFocused &&
        previouslyFocused instanceof HTMLElement &&
        document.contains(previouslyFocused)
      ) {
        previouslyFocused.focus();
      }
    };
  }, [isOpen]);

  // Lock background scroll while the drawer is open.
  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  function handleSubmit(e) {
    e.preventDefault();
    const numeric = parseFloat(targetInput);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      setFormError(
        `Enter a valid target price greater than ${formatPrice(0, currency)}.`
      );
      return;
    }
    setFormError("");
    onSaveTarget({
      id: activeProduct.id,
      name: activeProduct.name,
      brand: activeProduct.brand,
      image: activeProduct.image,
      targetPrice: numeric,
      currency,
      lastObservedPrice: activeBestPrice ?? null,
      bestRetailer: activeBestStore ?? null,
      isLive,
    });
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2000);
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            variants={overlayVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="fixed inset-0 z-40 bg-[#141311]/45 backdrop-blur-[3px]"
            onClick={onClose}
          />

          {/* Drawer panel */}
          <motion.aside
            variants={drawerVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            role="dialog"
            aria-modal="true"
            aria-labelledby="luxe-watchlist-title"
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-[#E4DFCF]/80 bg-[#F0EDE4] shadow-[0_0_120px_-24px_rgba(26,24,21,0.5)] sm:rounded-l-[24px]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="relative flex items-start justify-between gap-3 overflow-hidden border-b border-[#EFEDE2]/80 bg-[linear-gradient(170deg,#FFFFFF_0%,#FDFAF6_100%)] px-5 py-5">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -right-10 -top-16 h-36 w-36 rounded-full bg-[radial-gradient(circle,rgba(201,242,77,0.16)_0%,rgba(255,255,255,0)_70%)]"
              />
              <div className="relative">
                <p className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.22em] text-[#141311]">
                  <Sparkles className="h-3 w-3" aria-hidden="true" />
                  Browser-persisted alerts
                </p>
                <h2
                  id="luxe-watchlist-title"
                  className="mt-1.5 font-serif text-[1.55rem] font-normal leading-tight tracking-[-0.02em] text-[#141311] lux-serif-display"
                >
                  Watchlist &amp; History
                </h2>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={onClose}
                aria-label="Close Watchlist Drawer"
                className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#E4DFCF]/90 bg-white text-[#75716B] transition-colors hover:border-[#141311] hover:text-[#141311] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3A3733]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 space-y-7 overflow-y-auto p-5">
              {/* Active Product Alert Form */}
              {activeProduct && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.12, duration: DURATIONS.slow, ease: EASE }}
                  className="relative overflow-hidden rounded-[18px] border border-[#E4DFCF]/80 bg-white p-4 shadow-[0_16px_44px_-40px_rgba(26,24,21,0.6)]"
                >
                  <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.18em] text-[#141311]">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#F0EDE4]">
                      <Bell className="h-3 w-3" aria-hidden="true" />
                    </span>
                    <span>Set price-drop alert</span>
                  </div>
                  <p className="mt-2.5 font-serif text-[15px] font-medium leading-snug text-[#141311]">
                    {activeProduct.name}
                  </p>
                  {activeBestPrice != null && (
                    <p className="mt-1 font-mono text-[10px] text-[#75716B]">
                      Current lowest{" "}
                      <strong className="text-[#141311]">
                        {formatPrice(activeBestPrice, currency)}
                      </strong>{" "}
                      <span className="text-[#8B8780]">({activeBestStore})</span>
                    </p>
                  )}

                  <form onSubmit={handleSubmit} className="mt-3.5 space-y-2.5">
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min="1"
                        step="any"
                        value={targetInput}
                        onChange={(e) => setTargetInput(e.target.value)}
                        placeholder={`Target in ${currency}`}
                        className="min-h-[40px] flex-1 rounded-lg border border-[#D8D4C6] bg-[#F0EDE4] px-3 font-mono text-xs text-[#141311] transition-all duration-200 placeholder:text-[#B4B2A4] focus:border-[#3A3733] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#3A3733]/8"
                      />
                      <motion.button
                        type="submit"
                        whileTap={{ scale: 0.97 }}
                        className="min-h-[40px] rounded-full border border-[#141311] bg-[#141311] px-4 font-mono text-[9.5px] uppercase tracking-[0.12em] text-[#FFFFFF] transition-colors hover:border-[#000000] hover:bg-[#000000]"
                      >
                        {existingActiveWatch ? "Update" : "Save"}
                      </motion.button>
                    </div>
                    {formError && (
                      <p className="font-mono text-[10px] text-[#141311]">
                        {formError}
                      </p>
                    )}
                    <AnimatePresence mode="wait">
                      {savedNotice && (
                        <motion.p
                          key="saved"
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          className="inline-flex items-center gap-1 font-mono text-[10px] text-[#4A5527]"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Saved locally in your browser.
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </form>
                </motion.div>
              )}

              {/* Tracked Watchlist */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.18 }}
              >
                <h3 className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#6B5D33]">
                  Saved watchlist ({watchlist.length})
                </h3>
                {watchlist.length === 0 ? (
                  <p className="mt-2.5 rounded-xl border border-dashed border-[#DAD6C8] bg-white/70 p-4 text-[11px] leading-relaxed text-[#8B8780]">
                    Nothing saved yet. Track any formulation to monitor price
                    drops against your target threshold.
                  </p>
                ) : (
                  <ul className="mt-2.5 divide-y divide-[#F0EDE4]/80 overflow-hidden rounded-xl border border-[#E4DFCF]/80 bg-white">
                    <AnimatePresence>
                      {watchlist.map((item) => {
                        const targetDisplay = convertCurrency(
                          item.targetPrice,
                          item.currency || "INR",
                          currency
                        );
                        const observedDisplay =
                          item.lastObservedPrice != null
                            ? convertCurrency(
                                item.lastObservedPrice,
                                item.currency || "INR",
                                currency
                              )
                            : null;
                        const alertTriggered =
                          observedDisplay != null &&
                          observedDisplay <= targetDisplay;

                        return (
                          <motion.li
                            key={item.id}
                            layout
                            initial={{ opacity: 0, x: -12 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{
                              opacity: 0,
                              x: 12,
                              transition: { duration: 0.15 },
                            }}
                            transition={{ duration: DURATIONS.base, ease: EASE }}
                            className="p-4"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-[13px] font-medium text-[#141311]">
                                  {item.name}
                                </p>
                                <div className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-[9px] tabular-nums">
                                  <span className="text-[#75716B]">
                                    Target {formatPrice(targetDisplay, currency)}
                                  </span>
                                  {observedDisplay != null && (
                                    <span
                                      className={cn(
                                        "rounded-full border px-2 py-0.5 text-[8.5px]",
                                        alertTriggered
                                          ? "border-[#DCE5C0] bg-[#F6F8EA] font-semibold text-[#4A5527]"
                                          : "border-[#EFEDE2] bg-[#F0EDE4] text-[#75716B]"
                                      )}
                                    >
                                      {alertTriggered
                                        ? `Target met · ${formatPrice(observedDisplay, currency)}`
                                        : `Last ${formatPrice(observedDisplay, currency)}`}
                                    </span>
                                  )}
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={() => onRemoveWatch(item.id)}
                                aria-label={`Remove ${item.name} from watchlist`}
                                className="rounded-full p-1.5 text-[#8B8780] transition-colors hover:bg-[#F0EDE4] hover:text-[#141311]"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>

                            <button
                              type="button"
                              onClick={() => {
                                onSelectQuery(item.name);
                                onClose();
                              }}
                              className="mt-2.5 inline-flex items-center gap-1 font-mono text-[9px] font-medium uppercase tracking-[0.08em] text-[#141311] transition-colors hover:text-[#141311]"
                            >
                              <span>Re-run comparison</span>
                              <ArrowRight className="h-3 w-3" />
                            </button>
                          </motion.li>
                        );
                      })}
                    </AnimatePresence>
                  </ul>
                )}
              </motion.div>

              {/* Comparison History */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.26 }}
              >
                <h3 className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-[#6B5D33]">
                  <History className="h-3.5 w-3.5" aria-hidden="true" />
                  Recent comparisons ({comparisonHistory.length})
                </h3>
                {comparisonHistory.length === 0 ? (
                  <p className="mt-2.5 rounded-xl border border-dashed border-[#DAD6C8] bg-white/70 p-4 text-[11px] leading-relaxed text-[#8B8780]">
                    Searches you compare will appear here for one-click revisit.
                  </p>
                ) : (
                  <ul className="mt-2.5 divide-y divide-[#F0EDE4]/80 overflow-hidden rounded-xl border border-[#E4DFCF]/80 bg-white">
                    {comparisonHistory.map((entry) => {
                      const convertedBest =
                        entry.bestPrice != null
                          ? convertCurrency(
                              entry.bestPrice,
                              entry.currency || "INR",
                              currency
                            )
                          : null;
                      return (
                        <li key={entry.name}>
                          <button
                            type="button"
                            onClick={() => {
                              onSelectQuery(entry.name);
                              onClose();
                            }}
                            className="flex w-full items-center justify-between gap-2 p-3.5 text-left transition-colors hover:bg-[#F0EDE4]"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-[11.5px] font-medium text-[#141311]">
                                {entry.name}
                              </p>
                              <p className="mt-0.5 font-mono text-[8.5px] text-[#8B8780]">
                                {entry.bestStore || `${entry.offerCount} stores`}{" "}
                                &middot;{" "}
                                {entry.isLive ? "Live Observed" : "Curated Demo"}
                              </p>
                            </div>
                            {convertedBest != null && (
                              <span className="shrink-0 font-mono text-[11px] font-semibold text-[#141311] tabular-nums">
                                {formatPrice(convertedBest, currency)}
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </motion.div>
            </div>

            {/* Footer note */}
            <div className="border-t border-[#EFEDE2]/80 bg-white/85 px-5 py-3.5 font-mono text-[8.5px] leading-relaxed text-[#8B8780] backdrop-blur-sm">
              Alerts and comparison history are persisted locally in your browser
              — no account or external database required.
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

export default memo(WatchlistDrawer);
