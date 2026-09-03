"use client";

import * as React from "react";
import Silk from "@/components/react-bits/Silk";
import MoltenMetal from "@/components/react-bits/MoltenMetal";
import { useThemeColor } from "@/context/theme-context";

/**
 * Shader backdrop for the authenticated app.
 *
 * Two deliberate differences from the marketing page:
 *
 *   1. It is dimmed much harder (a heavier veil), because dense data tables
 *      need contrast far more than they need spectacle.
 *   2. It respects `prefers-reduced-motion` and falls back to a static
 *      gradient, so the WebGL loop never runs for users who asked for stillness
 *      - which also keeps long table scrolls at 60fps on low-end GPUs.
 */
export function AppBackground({ intensity = "dim" }: { intensity?: "dim" | "full" }) {
  const { themeColor, backgroundType, silkConfig, moltenMetalConfig } = useThemeColor();
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

  // The dashboard veil is heavy on purpose. At 78% the shader still bled
  // through the panels and washed out secondary text; dense tables need
  // contrast far more than they need spectacle.
  const veil =
    intensity === "dim"
      ? "absolute inset-0 bg-white/90 dark:bg-black/88"
      : "absolute inset-0 bg-white/45 dark:bg-black/35";

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
    </div>
  );
}
