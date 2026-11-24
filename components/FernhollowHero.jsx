"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowDown, Volume2, VolumeX, X } from "lucide-react";
import { createFernhollowAudio } from "@/lib/fernhollowAudio";

const FernhollowCanvas = dynamic(
  () => import("@/components/FernhollowCanvas"),
  {
    ssr: false,
    loading: () => null,
  }
);

export default function FernhollowHero() {
  const canvasRef = useRef(null);
  const audioRef = useRef(null);

  const [isSceneReady, setIsSceneReady] = useState(false);
  const [useFallback, setUseFallback] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [activeModal, setActiveModal] = useState(null); // "about" | "contact" | null
  const [copiedEmail, setCopiedEmail] = useState(false);

  useEffect(() => {
    audioRef.current = createFernhollowAudio();

    return () => {
      audioRef.current?.dispose();
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === "Escape" && activeModal) {
        setActiveModal(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeModal]);

  const handleSceneReady = useCallback(() => {
    setIsSceneReady(true);
  }, []);

  const handleSceneFallback = useCallback(() => {
    setUseFallback(true);
    setIsSceneReady(true);
  }, []);

  const handleToggleSound = useCallback(async () => {
    const engine = audioRef.current;
    if (!engine) return;

    if (soundEnabled) {
      engine.mute();
      setSoundEnabled(false);
    } else {
      const started = await engine.unmute();
      setSoundEnabled(Boolean(started));
    }
  }, [soundEnabled]);

  const scrollToTarget = useCallback((elementId) => {
    const el = document.getElementById(elementId);
    if (!el) return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    el.scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
  }, []);

  async function handleCopyContact() {
    try {
      await navigator.clipboard.writeText("editorial@luxeindex.com");
      setCopiedEmail(true);
      setTimeout(() => setCopiedEmail(false), 2000);
    } catch {
      setCopiedEmail(false);
    }
  }

  return (
    <>
      <section
        id="top"
        aria-label="Fernhollow nocturnal botanical opening"
        className="relative flex min-h-[100svh] w-full flex-col justify-between overflow-hidden bg-black text-[#f5efe2]"
      >
        {/* WebGL 3D Valley or Graceful Static Fallback */}
        {!useFallback ? (
          <FernhollowCanvas
            ref={canvasRef}
            onReady={handleSceneReady}
            onFallback={handleSceneFallback}
          />
        ) : (
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_72%,rgba(28,42,74,0.45)_0%,rgba(6,9,18,0.88)_48%,#000000_100%)]"
          >
            <svg
              viewBox="0 0 1200 420"
              preserveAspectRatio="xMidYMax slice"
              className="absolute inset-x-0 bottom-0 h-64 w-full text-[#f5efe2]/[0.08]"
              fill="none"
            >
              <path
                d="M0 420C180 340 340 310 600 355C860 400 1020 330 1200 365V420H0Z"
                fill="currentColor"
              />
              <path
                d="M240 390C240 310 275 260 310 230M310 230C295 250 280 258 265 258M310 230C318 254 332 264 348 268M880 390C875 315 845 268 815 240M815 240C830 258 844 266 860 266"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </div>
        )}

      {/* Subtle top and bottom atmospheric legibility scrims */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-black/70 to-transparent"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black via-black/45 to-transparent"
      />

      {/* Minimal Transparent Navigation */}
      <header className="relative z-20 mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-5 py-6 sm:px-8 lg:px-12">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          className="inline-flex items-center gap-2.5 text-[#f5efe2] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#f5efe2]"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4 text-[#f5efe2]/85"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M12 21V9M12 9C12 5.5 9.5 3.5 6 3.5C6 7 8 9 12 9ZM12 13C12 9.5 14.5 7.5 18 7.5C18 11 16 13 12 13Z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="font-[family-name:var(--font-manrope)] text-sm font-medium tracking-[0.06em] uppercase sm:text-[15px]">
            Fernhollow
          </span>
        </a>

        <nav
          aria-label="Fernhollow primary navigation"
          className="hidden items-center gap-8 md:flex"
        >
          <button
            type="button"
            onClick={() => scrollToTarget("luxe-index")}
            className="font-[family-name:var(--font-manrope)] text-xs font-medium tracking-[0.12em] uppercase text-[#f5efe2]/80 transition-colors duration-150 hover:text-[#f5efe2] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#f5efe2]"
          >
            Work
          </button>
          <button
            type="button"
            onClick={() => setActiveModal("about")}
            className="font-[family-name:var(--font-manrope)] text-xs font-medium tracking-[0.12em] uppercase text-[#f5efe2]/80 transition-colors duration-150 hover:text-[#f5efe2] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#f5efe2]"
          >
            About
          </button>
          <button
            type="button"
            onClick={() => scrollToTarget("price-matrix-anchor")}
            className="font-[family-name:var(--font-manrope)] text-xs font-medium tracking-[0.12em] uppercase text-[#f5efe2]/80 transition-colors duration-150 hover:text-[#f5efe2] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#f5efe2]"
          >
            Journal
          </button>
        </nav>

        <div className="flex items-center gap-2.5 sm:gap-3">
          <button
            type="button"
            onClick={() => setActiveModal("contact")}
            className="min-h-[38px] rounded-full border border-[#f5efe2]/35 bg-black/30 px-4 py-1.5 font-[family-name:var(--font-manrope)] text-xs font-medium tracking-[0.06em] text-[#f5efe2] transition-colors duration-150 hover:border-[#f5efe2] hover:bg-[#f5efe2] hover:text-black active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f5efe2]"
          >
            Let&apos;s talk
          </button>
        </div>
      </header>

      {/* Mobile Compact Secondary Links */}
      <nav
        aria-label="Mobile quick links"
        className="relative z-20 flex items-center justify-center gap-6 px-5 md:hidden"
      >
        <button
          type="button"
          onClick={() => scrollToTarget("luxe-index")}
          className="font-[family-name:var(--font-manrope)] text-[11px] font-medium tracking-[0.14em] uppercase text-[#f5efe2]/75 hover:text-[#f5efe2]"
        >
          Work
        </button>
        <button
          type="button"
          onClick={() => setActiveModal("about")}
          className="font-[family-name:var(--font-manrope)] text-[11px] font-medium tracking-[0.14em] uppercase text-[#f5efe2]/75 hover:text-[#f5efe2]"
        >
          About
        </button>
        <button
          type="button"
          onClick={() => scrollToTarget("price-matrix-anchor")}
          className="font-[family-name:var(--font-manrope)] text-[11px] font-medium tracking-[0.14em] uppercase text-[#f5efe2]/75 hover:text-[#f5efe2]"
        >
          Journal
        </button>
      </nav>

      {/* Centerpiece Editorial Headline, Caption & Circular Arrow CTA */}
      <div className="relative z-20 mx-auto flex max-w-4xl flex-col items-center px-5 py-10 text-center sm:px-8">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -inset-x-10 -inset-y-8 -z-10 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.58)_0%,rgba(0,0,0,0.22)_46%,transparent_76%)]"
        />
        <h1 className="font-[family-name:var(--font-antonio)] text-[clamp(3.35rem,11vw,7.5rem)] font-medium uppercase leading-[0.93] tracking-[-0.02em] text-[#f5efe2] drop-shadow-[0_6px_28px_rgba(0,0,0,0.75)]">
          Grown, not built.
        </h1>

        <p className="mt-5 font-[family-name:var(--font-manrope)] text-sm leading-relaxed tracking-[0.02em] text-[#f5efe2]/85 drop-shadow-[0_2px_12px_rgba(0,0,0,0.8)] sm:mt-6 sm:text-base">
          Rooted in nature.
          <br />
          Built for what&apos;s next.
        </p>

        <button
          type="button"
          onClick={() => scrollToTarget("luxe-index")}
          onMouseEnter={() => canvasRef.current?.startHoverTransition()}
          onMouseLeave={() => canvasRef.current?.stopHoverTransition()}
          onFocus={() => canvasRef.current?.startHoverTransition()}
          onBlur={() => canvasRef.current?.stopHoverTransition()}
          aria-label="Enter LuxeIndex price comparison"
          className="group mt-8 flex h-14 w-14 items-center justify-center rounded-full bg-[#f5efe2] text-black shadow-[0_0_0_1px_rgba(245,239,226,0.2)] transition-transform duration-200 ease-out hover:scale-105 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#f5efe2] sm:mt-10 sm:h-16 sm:w-16"
        >
          <ArrowDown
            className="h-5 w-5 stroke-[1.75] transition-transform duration-200 ease-out group-hover:translate-y-0.5"
            aria-hidden="true"
          />
        </button>
      </div>

      {/* Bottom Controls: Sound Toggle, Minimal Loading Indicator & Scroll Cue */}
      <div className="relative z-20 mx-auto flex w-full max-w-7xl items-end justify-between gap-4 px-5 pb-7 pt-4 sm:px-8 sm:pb-10 lg:px-12">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={handleToggleSound}
            aria-pressed={soundEnabled}
            aria-label={soundEnabled
              ? "Sound On — mute ambient sound"
              : "Sound Off — enable ambient sound"}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-[#f5efe2]/25 bg-black/45 px-3.5 py-1.5 font-[family-name:var(--font-manrope)] text-xs font-medium tracking-[0.05em] text-[#f5efe2]/85 transition-colors duration-150 hover:border-[#f5efe2]/65 hover:text-[#f5efe2] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f5efe2]"
          >
            {soundEnabled ? (
              <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <VolumeX className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>{soundEnabled ? "Sound On" : "Sound Off"}</span>
          </button>

          <div
            aria-live="polite"
            className={`hidden items-center gap-2 font-[family-name:var(--font-manrope)] text-[11px] tracking-[0.08em] text-[#f5efe2]/60 transition-opacity duration-500 sm:inline-flex ${
              isSceneReady ? "pointer-events-none opacity-0" : "opacity-100"
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-[#f5efe2]/70" />
            <span>Growing valley...</span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => scrollToTarget("luxe-index")}
          className="group flex items-center gap-3 font-[family-name:var(--font-manrope)] text-[11px] font-medium uppercase tracking-[0.18em] text-[#f5efe2]/75 transition-colors duration-150 hover:text-[#f5efe2] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#f5efe2]"
        >
          <span>Scroll</span>
          <span
            aria-hidden="true"
            className="block h-7 w-px bg-[#f5efe2]/60 fernhollow-scroll-line"
          />
        </button>
      </div>

      {/* Minimal Editorial Dialog for About / Let's talk */}
      {activeModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="fernhollow-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-xs"
          onClick={() => setActiveModal(null)}
        >
          <div
            className="w-full max-w-md border border-[#f5efe2]/20 bg-[#090b10] p-6 text-[#f5efe2] shadow-xl sm:p-7"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-[family-name:var(--font-manrope)] text-[11px] uppercase tracking-[0.14em] text-[#f5efe2]/60">
                  {activeModal === "about" ? "Fernhollow × LuxeIndex" : "Editorial Desk"}
                </p>
                <h2
                  id="fernhollow-modal-title"
                  className="mt-1.5 font-[family-name:var(--font-antonio)] text-2xl uppercase tracking-tight text-[#f5efe2]"
                >
                  {activeModal === "about"
                    ? "Botanical Origin, Price Clarity."
                    : "Let's Talk."}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                aria-label="Close modal"
                className="flex h-9 w-9 items-center justify-center border border-[#f5efe2]/20 text-[#f5efe2]/75 transition-colors hover:border-[#f5efe2] hover:text-[#f5efe2]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {activeModal === "about" ? (
              <p className="mt-4 font-[family-name:var(--font-manrope)] text-sm leading-relaxed text-[#f5efe2]/80">
                Fernhollow opens LuxeIndex with a quiet nocturnal study in organic form, pairing real-time WebGL botany with transparent luxury beauty price parity across Sephora, Nykaa, Amazon Luxury, Cult Beauty, and Space NK.
              </p>
            ) : (
              <div className="mt-4 space-y-4">
                <p className="font-[family-name:var(--font-manrope)] text-sm leading-relaxed text-[#f5efe2]/80">
                  For brand partnerships, stockist onboarding, or editorial press inquiries, reach our curation desk directly.
                </p>
                <div className="flex items-center justify-between gap-2 border border-[#f5efe2]/20 bg-black/50 px-3.5 py-2.5">
                  <span className="font-mono text-xs text-[#f5efe2]">
                    editorial@luxeindex.com
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyContact}
                    className="border border-[#f5efe2]/30 px-2.5 py-1 font-[family-name:var(--font-manrope)] text-[11px] font-medium text-[#f5efe2] transition-colors hover:bg-[#f5efe2] hover:text-black"
                  >
                    {copiedEmail ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            )}

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setActiveModal(null);
                  if (activeModal === "about") {
                    scrollToTarget("luxe-index");
                  }
                }}
                className="rounded-full bg-[#f5efe2] px-5 py-2 font-[family-name:var(--font-manrope)] text-xs font-semibold text-black transition-transform active:scale-95"
              >
                {activeModal === "about" ? "Explore Index" : "Close"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>

      {/* Smooth Editorial Transition Bridge into LuxeIndex (#FAF8F5) */}
      <div
        aria-hidden="true"
        className="w-full bg-gradient-to-b from-black via-[#11110F] to-[#11110F] pt-10"
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between border-t border-[#f5efe2]/15 px-4 py-4 font-mono text-[11px] uppercase tracking-[0.16em] text-[#f5efe2]/65 sm:px-6 lg:px-8">
          <span>I &middot; Fernhollow Valley</span>
          <span>II &middot; LuxeIndex Parity Engine</span>
        </div>
        <div className="h-16 w-full bg-gradient-to-b from-[#11110F] via-[#27221d] to-[#FAF8F5] sm:h-24" />
      </div>
    </>
  );
}
