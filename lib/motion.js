/**
 * LuxeIndex shared motion tokens.
 *
 * Single source of truth for spring presets, durations, easings and the
 * `shouldAnimate` flag. Importing from here (instead of hard-coding
 * durations inline) keeps every component on the same editorial rhythm.
 */

export const EASE = [0.22, 1, 0.36, 1];
export const EASE_REVEAL = [0.16, 1, 0.3, 1];

export const DURATIONS = {
  fast: 0.18,
  base: 0.32,
  slow: 0.45,
  slower: 0.6,
  page: 0.7,
};

export const SPRINGS = {
  soft: { type: "spring", stiffness: 220, damping: 28, mass: 0.9 },
  editorial: { type: "spring", stiffness: 260, damping: 30, mass: 0.85 },
  snappy: { type: "spring", stiffness: 380, damping: 32, mass: 0.7 },
  lift: { type: "spring", stiffness: 320, damping: 26, mass: 0.8 },
};

export const STAGGER = {
  tight: 0.04,
  base: 0.06,
  relaxed: 0.09,
};

export const CARD_HOVER = {
  y: -4,
  scale: 1.01,
  transition: { duration: 0.25, ease: [0.22, 1, 0.36, 1] },
};

/**
 * Respects `prefers-reduced-motion` at runtime.
 * Components should gate non-essential animation behind this flag.
 */
export function shouldAnimate() {
  if (typeof window === "undefined") return true;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Build a staggered transition helper for list children.
 */
export function stagger(delay = STAGGER.base, baseDelay = 0.1) {
  return {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: delay,
        delayChildren: baseDelay,
      },
    },
  };
}