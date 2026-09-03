"use client";

import * as React from "react";
import Silk from "@/components/react-bits/Silk";
import MoltenMetal from "@/components/react-bits/MoltenMetal";
import { useTheme } from "next-themes";
import { useThemeColor } from "@/context/theme-context";

/**
 * Shader backdrop for the authenticated app.
 *
 * Three deliberate differences from the marketing page:
 *
 *   1. A heavier veil, because dense data tables need contrast more than
 *      spectacle - but only heavy enough to keep page-level headings legible,
 *      since the panels themselves are near-opaque and carry their own.
 *   2. An accent wash sits above the veil so the selected theme colour stays
 *      visible even while the shader is in a dark phase.
 *   3. It respects `prefers-reduced-motion` and falls back to a static
 *      gradient, so the WebGL loop never runs for users who asked for stillness
 *      - which also keeps long table scrolls at 60fps on low-end GPUs.
 */
export function AppBackground({ intensity = "dim" }: { intensity?: "dim" | "full" }) {
  const { themeColor, backgroundType, silkConfig, moltenMetalConfig } = useThemeColor();
  // Silk renders a different tonal ramp for light vs dark, so it has to follow
  // whatever the Theme Studio has selected rather than guess.
  const { resolvedTheme } = useTheme();
  const isLight = resolvedTheme === "light";
  const [reducedMotion, setReducedMotion] = React.useState(false);

  React.useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(query.matches);
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  if (reducedMotion) {
    return (
      <div className="pointer-events-none fixed inset-0 z-0" aria-hidden>
        <div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(1200px circle at 20% 0%, ${themeColor}22, transparent 60%), radial-gradient(900px circle at 90% 100%, ${themeColor}14, transparent 60%)`,
          }}
        />
        <div className="absolute inset-0 bg-white/70 dark:bg-black/70" />
      </div>
    );
  }

  // Contrast now comes from the panels themselves, which are near-opaque, so
  // the veil only has to keep page-level headings legible in the gutters.
  // Pushing it to 90% made the shader invisible and took the accent colour
  // with it; this is the level where the backdrop reads as a live surface
  // again without competing with text.
  // Light mode needs a lighter touch than dark: the light shader ramp already
  // sits in the pastel end, so a heavy white veil erases it entirely.
  const veil =
    intensity === "dim"
      ? "absolute inset-0 bg-white/45 dark:bg-black/55"
      : "absolute inset-0 bg-white/30 dark:bg-black/30";

  return (
    <div className="pointer-events-none fixed inset-0 z-0 h-full w-full" aria-hidden>
      {backgroundType === "silk" ? (
        <div className="absolute inset-0 h-full w-full opacity-90">
          <Silk
            color={themeColor}
            speed={silkConfig.speed}
            scale={silkConfig.scale}
            noiseIntensity={silkConfig.noiseIntensity}
            rotation={silkConfig.rotation}
            lightMode={isLight}
          />
        </div>
      ) : (
        <div className="absolute inset-0 h-full w-full">
          <MoltenMetal
            color1={moltenMetalConfig.color1}
            color2={moltenMetalConfig.color2}
            color3={moltenMetalConfig.color3}
            speed={moltenMetalConfig.speed}
            scale={moltenMetalConfig.scale}
            detail={moltenMetalConfig.detail}
            glow={moltenMetalConfig.glow}
            coreSize={moltenMetalConfig.coreSize}
            swirl={moltenMetalConfig.swirl}
            fold={moltenMetalConfig.fold}
            blackPoint={moltenMetalConfig.blackPoint}
            brightness={moltenMetalConfig.brightness}
            colorMode={moltenMetalConfig.colorMode}
            grain={moltenMetalConfig.grain}
            grainIntensity={moltenMetalConfig.grainIntensity}
            mouseInteraction={false}
            mouseStrength={moltenMetalConfig.mouseStrength}
            opacity={moltenMetalConfig.opacity}
          />
        </div>
      )}
      <div className={veil} />

      {/* Accent wash above the veil.
       *
       * Molten Metal spends a lot of each cycle in its dark, near-black phase,
       * so with any veil at all the selected accent can vanish entirely. This
       * keeps the theme colour present at all times and ties the backdrop to
       * whatever the Theme Studio has picked, independently of where the
       * shader happens to be in its animation. */}
      {/* Dark only: a screen blend on an already-light backdrop would just
       * push it toward white, and the light ramp carries the accent on its
       * own anyway. */}
      {!isLight && (
        <div
          className="absolute inset-0 mix-blend-screen"
          style={{
            background: `radial-gradient(1100px circle at 15% 0%, ${themeColor}2e, transparent 62%), radial-gradient(900px circle at 88% 100%, ${themeColor}22, transparent 60%)`,
          }}
        />
      )}
    </div>
  );
}
