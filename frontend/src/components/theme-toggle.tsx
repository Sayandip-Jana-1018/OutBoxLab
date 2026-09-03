"use client"

import * as React from "react"
import {
  Moon,
  Sun,
  Monitor,
  Palette,
  Check,
  RotateCcw,
  Sparkles,
  Layers,
  Flame,
  Waves,
  MousePointer,
  X,
} from "lucide-react"
import { useTheme } from "next-themes"
import { useThemeColor, type MoltenMetalConfig } from "@/context/theme-context"
import { cn } from "@/lib/utils"
import { motion, AnimatePresence } from "framer-motion"

export function ThemeToggle() {
  const { setTheme, theme } = useTheme()
  const {
    themeColor,
    setThemeColor,
    backgroundType,
    setBackgroundType,
    silkConfig,
    setSilkConfig,
    moltenMetalConfig,
    setMoltenMetalConfig,
    resetConfigs,
  } = useThemeColor()

  const [isOpen, setIsOpen] = React.useState(false)
  const [activeTab, setActiveTab] = React.useState<"palette" | "background">("palette")

  // Escape key to close
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  const colors = [
    { name: "Royal Violet", value: "#8b5cf6" },
    { name: "Cyber Magenta", value: "#ec4899" },
    { name: "Electric Cyan", value: "#06b6d4" },
    { name: "Emerald Glow", value: "#10b981" },
    { name: "Golden Amber", value: "#f59e0b" },
    { name: "Neon Rose", value: "#f43f5e" },
    { name: "Hyper Blue", value: "#3b82f6" },
    { name: "Ultra Indigo", value: "#6366f1" },
    { name: "Cyber Lime", value: "#84cc16" },
    { name: "Solar Orange", value: "#f97316" },
    { name: "Pure Quantum", value: "#d946ef" },
    { name: "Luxury Gold", value: "#d4af37" },
    { name: "Monochrome Light", value: "#ffffff" },
    { name: "Obsidian Slate", value: "#64748b" },
    { name: "Deep Amethyst", value: "#581c87" },
  ]

  const handleSilkChange = (key: keyof typeof silkConfig, value: number) => {
    setSilkConfig((prev) => ({ ...prev, [key]: value }))
  }

  const handleMoltenChange = <K extends keyof MoltenMetalConfig>(key: K, value: MoltenMetalConfig[K]) => {
    setMoltenMetalConfig((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <>
      {/* Floating Trigger Button on Top Right */}
      {/* Above the portalled overlays (z-150) so the palette stays reachable
          while a dialog or drawer is open. */}
      <div className="fixed top-6 right-6 z-[200]">
        <button
          onClick={() => setIsOpen(true)}
          className="relative group w-11 h-11 rounded-2xl bg-white/80 dark:bg-black/60 backdrop-blur-2xl border border-black/10 dark:border-white/20 flex items-center justify-center text-zinc-900 dark:text-white hover:scale-105 transition-all shadow-xl hover:shadow-[0_0_25px_rgba(255,255,255,0.2)]"
          style={{
            borderColor: isOpen ? themeColor : undefined,
          }}
          aria-label="Theme & Background Settings"
        >
          <div
            className="absolute inset-0 rounded-2xl opacity-20 group-hover:opacity-40 transition-opacity blur-sm"
            style={{ backgroundColor: themeColor }}
          />
          <Palette
            className="w-5 h-5 relative z-10 transition-transform group-hover:rotate-12"
            style={{ color: themeColor }}
          />
        </button>
      </div>

      {/* CENTER-ALIGNED THEME & DISPLAY STUDIO MODAL */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[210] flex items-center justify-center p-4 sm:p-6 bg-black/60 dark:bg-black/75 backdrop-blur-md"
            onClick={() => setIsOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 16 }}
              transition={{ type: "spring", stiffness: 360, damping: 28 }}
              className="relative w-full max-w-lg p-6 rounded-3xl bg-white/95 dark:bg-zinc-950/90 backdrop-blur-3xl border border-black/10 dark:border-white/15 shadow-[0_25px_70px_rgba(0,0,0,0.5)] max-h-[88vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header with Title, Reset & Close */}
              <div className="flex items-center justify-between pb-4 border-b border-black/10 dark:border-white/10">
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-3 h-3 rounded-full animate-pulse"
                    style={{ backgroundColor: themeColor }}
                  />
                  <div>
                    <h3 className="text-base font-bold tracking-tight text-zinc-950 dark:text-white font-serif">
                      Theme & Display Studio
                    </h3>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 font-sans">
                      Customize background shaders, palettes & modes
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={resetConfigs}
                    title="Reset to Defaults"
                    className="flex items-center gap-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white transition-colors px-2.5 py-1.5 rounded-xl bg-black/5 dark:bg-white/10 font-sans"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Reset</span>
                  </button>

                  <button
                    onClick={() => setIsOpen(false)}
                    aria-label="Close"
                    className="w-8 h-8 rounded-xl bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 flex items-center justify-center text-zinc-600 dark:text-zinc-300 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Sub-Navigation Tabs */}
              <div className="grid grid-cols-2 gap-1.5 p-1.5 my-5 rounded-2xl bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 font-sans">
                <button
                  onClick={() => setActiveTab("palette")}
                  className={cn(
                    "py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all",
                    activeTab === "palette"
                      ? "bg-white dark:bg-white/20 text-zinc-950 dark:text-white shadow-sm"
                      : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white"
                  )}
                  style={{
                    color: activeTab === "palette" ? themeColor : undefined,
                  }}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Colors & Mode</span>
                </button>
                <button
                  onClick={() => setActiveTab("background")}
                  className={cn(
                    "py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all",
                    activeTab === "background"
                      ? "bg-white dark:bg-white/20 text-zinc-950 dark:text-white shadow-sm"
                      : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white"
                  )}
                  style={{
                    color: activeTab === "background" ? themeColor : undefined,
                  }}
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>Live Shader FX</span>
                </button>
              </div>

              {/* TAB 1: Palette & Appearance */}
              {activeTab === "palette" && (
                <div className="space-y-6 font-sans">
                  {/* Background System Switcher */}
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5" /> Background Engine
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => setBackgroundType("silk")}
                        className={cn(
                          "relative p-3.5 rounded-2xl border text-left transition-all group overflow-hidden",
                          backgroundType === "silk"
                            ? "border-primary bg-primary/10 shadow-md"
                            : "border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10"
                        )}
                        style={{
                          borderColor: backgroundType === "silk" ? themeColor : undefined,
                        }}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <Waves className="w-4 h-4" style={{ color: themeColor }} />
                          {backgroundType === "silk" && (
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: themeColor }} />
                          )}
                        </div>
                        <div className="text-xs font-bold text-zinc-950 dark:text-white">Silk Waves</div>
                        <div className="text-[10px] text-zinc-500 dark:text-zinc-400">3D Dynamic Canvas</div>
                      </button>

                      <button
                        onClick={() => setBackgroundType("metal")}
                        className={cn(
                          "relative p-3.5 rounded-2xl border text-left transition-all group overflow-hidden",
                          backgroundType === "metal"
                            ? "border-primary bg-primary/10 shadow-md"
                            : "border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10"
                        )}
                        style={{
                          borderColor: backgroundType === "metal" ? themeColor : undefined,
                        }}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <Flame className="w-4 h-4" style={{ color: themeColor }} />
                          {backgroundType === "metal" && (
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: themeColor }} />
                          )}
                        </div>
                        <div className="text-xs font-bold text-zinc-950 dark:text-white">Molten Metal</div>
                        <div className="text-[10px] text-zinc-500 dark:text-zinc-400">WebGL Ray Shader</div>
                      </button>
                    </div>
                  </div>

                  {/* Mode Toggle */}
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                      Theme Mode
                    </label>
                    <div className="flex items-center justify-between p-1.5 rounded-2xl bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10">
                      {["light", "dark", "system"].map((mode) => (
                        <button
                          key={mode}
                          onClick={() => setTheme(mode)}
                          className={cn(
                            "flex-1 py-2 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1.5",
                            theme === mode
                              ? "bg-white dark:bg-white/20 text-zinc-950 dark:text-white font-bold shadow-md"
                              : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
                          )}
                          style={{
                            color: theme === mode ? themeColor : undefined,
                          }}
                        >
                          {mode === "light" && <Sun className="w-3.5 h-3.5" />}
                          {mode === "dark" && <Moon className="w-3.5 h-3.5" />}
                          {mode === "system" && <Monitor className="w-3.5 h-3.5" />}
                          <span className="capitalize">{mode}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Curated Color Swatches */}
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                        Accent Hue & Background Tint
                      </label>
                      <span className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 uppercase">{themeColor}</span>
                    </div>
                    <div className="grid grid-cols-5 gap-2.5">
                      {colors.map((color) => {
                        const isSelected = themeColor.toLowerCase() === color.value.toLowerCase()
                        return (
                          <button
                            key={color.value}
                            onClick={() => setThemeColor(color.value)}
                            className={cn(
                              "group relative h-9 rounded-xl flex items-center justify-center transition-all hover:scale-110 border border-black/15 dark:border-white/20 shadow-sm",
                              isSelected ? "ring-2 ring-zinc-950 dark:ring-white ring-offset-2 ring-offset-white dark:ring-offset-black scale-105" : ""
                            )}
                            style={{ backgroundColor: color.value }}
                            title={color.name}
                          >
                            {isSelected && (
                              <Check
                                className={cn(
                                  "w-4 h-4 drop-shadow-md stroke-[3]",
                                  color.value === "#ffffff" ? "text-black" : "text-white"
                                )}
                              />
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: Live Background Shader Controls */}
              {activeTab === "background" && (
                <div className="space-y-6 font-sans">
                  {/* Current Active Engine Indicator */}
                  <div className="flex items-center justify-between p-3 rounded-2xl bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10">
                    <div className="flex items-center gap-2">
                      {backgroundType === "silk" ? (
                        <Waves className="w-4 h-4" style={{ color: themeColor }} />
                      ) : (
                        <Flame className="w-4 h-4" style={{ color: themeColor }} />
                      )}
                      <span className="text-xs font-bold text-zinc-950 dark:text-white capitalize">
                        {backgroundType === "silk" ? "Silk Waves Configuration" : "Molten Metal Shader Studio"}
                      </span>
                    </div>
                    <button
                      onClick={() => setBackgroundType(backgroundType === "silk" ? "metal" : "silk")}
                      className="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-black/10 dark:border-white/15 hover:border-black/30 dark:hover:border-white/30 text-zinc-700 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-white transition-all"
                    >
                      Switch Engine
                    </button>
                  </div>

                  {/* CONTROLS FOR SILK */}
                  {backgroundType === "silk" && (
                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-xs text-zinc-950 dark:text-white font-medium">
                          <span className="text-zinc-500 dark:text-zinc-400">Wave Speed</span>
                          <span className="font-mono">{silkConfig.speed}</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="15"
                          step="0.5"
                          value={silkConfig.speed}
                          onChange={(e) => handleSilkChange("speed", parseFloat(e.target.value))}
                          className="w-full h-1.5 bg-black/10 dark:bg-white/15 rounded-lg appearance-none cursor-pointer accent-primary"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex justify-between text-xs text-zinc-950 dark:text-white font-medium">
                          <span className="text-zinc-500 dark:text-zinc-400">Texture Scale</span>
                          <span className="font-mono">{silkConfig.scale}</span>
                        </div>
                        <input
                          type="range"
                          min="0.2"
                          max="5"
                          step="0.1"
                          value={silkConfig.scale}
                          onChange={(e) => handleSilkChange("scale", parseFloat(e.target.value))}
                          className="w-full h-1.5 bg-black/10 dark:bg-white/15 rounded-lg appearance-none cursor-pointer accent-primary"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex justify-between text-xs text-zinc-950 dark:text-white font-medium">
                          <span className="text-zinc-500 dark:text-zinc-400">Noise Turbulence</span>
                          <span className="font-mono">{silkConfig.noiseIntensity}</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="5"
                          step="0.1"
                          value={silkConfig.noiseIntensity}
                          onChange={(e) => handleSilkChange("noiseIntensity", parseFloat(e.target.value))}
                          className="w-full h-1.5 bg-black/10 dark:bg-white/15 rounded-lg appearance-none cursor-pointer accent-primary"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex justify-between text-xs text-zinc-950 dark:text-white font-medium">
                          <span className="text-zinc-500 dark:text-zinc-400">Angle Rotation</span>
                          <span className="font-mono">{silkConfig.rotation}°</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="360"
                          step="5"
                          value={silkConfig.rotation}
                          onChange={(e) => handleSilkChange("rotation", parseFloat(e.target.value))}
                          className="w-full h-1.5 bg-black/10 dark:bg-white/15 rounded-lg appearance-none cursor-pointer accent-primary"
                        />
                      </div>
                    </div>
                  )}

                  {/* CONTROLS FOR MOLTEN METAL */}
                  {backgroundType === "metal" && (
                    <div className="space-y-4">
                      {/* Color Mode Selector */}
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-bold text-zinc-500 dark:text-zinc-400 uppercase">Color Preset Mode</label>
                        <div className="grid grid-cols-3 gap-1.5 p-1 rounded-2xl bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10">
                          {(["molten", "ember", "frost"] as const).map((mode) => (
                            <button
                              key={mode}
                              onClick={() => handleMoltenChange("colorMode", mode)}
                              className={cn(
                                "py-1.5 rounded-xl text-xs font-semibold capitalize transition-all",
                                moltenMetalConfig.colorMode === mode
                                  ? "bg-white dark:bg-white/20 text-zinc-950 dark:text-white shadow-sm font-bold"
                                  : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
                              )}
                              style={{
                                color: moltenMetalConfig.colorMode === mode ? themeColor : undefined,
                              }}
                            >
                              {mode}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Sliders Grid */}
                      <div className="space-y-3.5">
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs text-zinc-950 dark:text-white font-medium">
                            <span className="text-zinc-500 dark:text-zinc-400">Flow Speed</span>
                            <span className="font-mono">{moltenMetalConfig.speed.toFixed(2)}</span>
                          </div>
                          <input
                            type="range"
                            min="0.05"
                            max="2.0"
                            step="0.05"
                            value={moltenMetalConfig.speed}
                            onChange={(e) => handleMoltenChange("speed", parseFloat(e.target.value))}
                            className="w-full h-1.5 bg-black/10 dark:bg-white/15 rounded-lg appearance-none cursor-pointer accent-primary"
                          />
                        </div>

                        <div className="space-y-1">
                          <div className="flex justify-between text-xs text-zinc-950 dark:text-white font-medium">
                            <span className="text-zinc-500 dark:text-zinc-400">Zoom Scale</span>
                            <span className="font-mono">{moltenMetalConfig.scale.toFixed(1)}</span>
                          </div>
                          <input
                            type="range"
                            min="1"
                            max="10"
                            step="0.5"
                            value={moltenMetalConfig.scale}
                            onChange={(e) => handleMoltenChange("scale", parseFloat(e.target.value))}
                            className="w-full h-1.5 bg-black/10 dark:bg-white/15 rounded-lg appearance-none cursor-pointer accent-primary"
                          />
                        </div>

                        <div className="space-y-1">
                          <div className="flex justify-between text-xs text-zinc-950 dark:text-white font-medium">
                            <span className="text-zinc-500 dark:text-zinc-400">Mesh Detail Steps</span>
                            <span className="font-mono">{moltenMetalConfig.detail}</span>
                          </div>
                          <input
                            type="range"
                            min="1"
                            max="8"
                            step="1"
                            value={moltenMetalConfig.detail}
                            onChange={(e) => handleMoltenChange("detail", parseInt(e.target.value))}
                            className="w-full h-1.5 bg-black/10 dark:bg-white/15 rounded-lg appearance-none cursor-pointer accent-primary"
                          />
                        </div>

                        <div className="space-y-1">
                          <div className="flex justify-between text-xs text-zinc-950 dark:text-white font-medium">
                            <span className="text-zinc-500 dark:text-zinc-400">Glow Intensity</span>
                            <span className="font-mono">{moltenMetalConfig.glow.toFixed(1)}</span>
                          </div>
                          <input
                            type="range"
                            min="0.5"
                            max="4.0"
                            step="0.1"
                            value={moltenMetalConfig.glow}
                            onChange={(e) => handleMoltenChange("glow", parseFloat(e.target.value))}
                            className="w-full h-1.5 bg-black/10 dark:bg-white/15 rounded-lg appearance-none cursor-pointer accent-primary"
                          />
                        </div>

                        <div className="space-y-1">
                          <div className="flex justify-between text-xs text-zinc-950 dark:text-white font-medium">
                            <span className="text-zinc-500 dark:text-zinc-400">Core Size</span>
                            <span className="font-mono">{moltenMetalConfig.coreSize.toFixed(2)}</span>
                          </div>
                          <input
                            type="range"
                            min="0.01"
                            max="0.4"
                            step="0.01"
                            value={moltenMetalConfig.coreSize}
                            onChange={(e) => handleMoltenChange("coreSize", parseFloat(e.target.value))}
                            className="w-full h-1.5 bg-black/10 dark:bg-white/15 rounded-lg appearance-none cursor-pointer accent-primary"
                          />
                        </div>

                        <div className="space-y-1">
                          <div className="flex justify-between text-xs text-zinc-950 dark:text-white font-medium">
                            <span className="text-zinc-500 dark:text-zinc-400">Swirl Distortion</span>
                            <span className="font-mono">{moltenMetalConfig.swirl.toFixed(1)}</span>
                          </div>
                          <input
                            type="range"
                            min="-3"
                            max="3"
                            step="0.2"
                            value={moltenMetalConfig.swirl}
                            onChange={(e) => handleMoltenChange("swirl", parseFloat(e.target.value))}
                            className="w-full h-1.5 bg-black/10 dark:bg-white/15 rounded-lg appearance-none cursor-pointer accent-primary"
                          />
                        </div>

                        <div className="space-y-1">
                          <div className="flex justify-between text-xs text-zinc-950 dark:text-white font-medium">
                            <span className="text-zinc-500 dark:text-zinc-400">Fold Curvature</span>
                            <span className="font-mono">{moltenMetalConfig.fold.toFixed(2)}</span>
                          </div>
                          <input
                            type="range"
                            min="-1"
                            max="1"
                            step="0.05"
                            value={moltenMetalConfig.fold}
                            onChange={(e) => handleMoltenChange("fold", parseFloat(e.target.value))}
                            className="w-full h-1.5 bg-black/10 dark:bg-white/15 rounded-lg appearance-none cursor-pointer accent-primary"
                          />
                        </div>

                        <div className="space-y-1">
                          <div className="flex justify-between text-xs text-zinc-950 dark:text-white font-medium">
                            <span className="text-zinc-500 dark:text-zinc-400">Brightness</span>
                            <span className="font-mono">{moltenMetalConfig.brightness.toFixed(1)}</span>
                          </div>
                          <input
                            type="range"
                            min="0.5"
                            max="3.0"
                            step="0.1"
                            value={moltenMetalConfig.brightness}
                            onChange={(e) => handleMoltenChange("brightness", parseFloat(e.target.value))}
                            className="w-full h-1.5 bg-black/10 dark:bg-white/15 rounded-lg appearance-none cursor-pointer accent-primary"
                          />
                        </div>

                        <div className="space-y-1">
                          <div className="flex justify-between text-xs text-zinc-950 dark:text-white font-medium">
                            <span className="text-zinc-500 dark:text-zinc-400">Opacity</span>
                            <span className="font-mono">{moltenMetalConfig.opacity.toFixed(2)}</span>
                          </div>
                          <input
                            type="range"
                            min="0.1"
                            max="1.0"
                            step="0.05"
                            value={moltenMetalConfig.opacity}
                            onChange={(e) => handleMoltenChange("opacity", parseFloat(e.target.value))}
                            className="w-full h-1.5 bg-black/10 dark:bg-white/15 rounded-lg appearance-none cursor-pointer accent-primary"
                          />
                        </div>
                      </div>

                      {/* Toggles */}
                      <div className="pt-3 border-t border-black/10 dark:border-white/10 space-y-2.5">
                        {/* Mouse Interaction Toggle */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                            <MousePointer className="w-3.5 h-3.5" />
                            <span>Mouse Movement Interaction</span>
                          </div>
                          <button
                            onClick={() => handleMoltenChange("mouseInteraction", !moltenMetalConfig.mouseInteraction)}
                            className={cn(
                              "w-10 h-5 rounded-full transition-colors relative p-0.5 border border-black/15 dark:border-white/15",
                              moltenMetalConfig.mouseInteraction ? "bg-primary" : "bg-black/10 dark:bg-white/10"
                            )}
                            style={{
                              backgroundColor: moltenMetalConfig.mouseInteraction ? themeColor : undefined,
                            }}
                          >
                            <div
                              className={cn(
                                "w-3.5 h-3.5 rounded-full bg-white transition-transform shadow-md",
                                moltenMetalConfig.mouseInteraction ? "translate-x-5" : "translate-x-0"
                              )}
                            />
                          </button>
                        </div>

                        {/* Grain Texture Toggle */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                            <Sparkles className="w-3.5 h-3.5" />
                            <span>Film Grain Texture</span>
                          </div>
                          <button
                            onClick={() => handleMoltenChange("grain", !moltenMetalConfig.grain)}
                            className={cn(
                              "w-10 h-5 rounded-full transition-colors relative p-0.5 border border-black/15 dark:border-white/15",
                              moltenMetalConfig.grain ? "bg-primary" : "bg-black/10 dark:bg-white/10"
                            )}
                            style={{
                              backgroundColor: moltenMetalConfig.grain ? themeColor : undefined,
                            }}
                          >
                            <div
                              className={cn(
                                "w-3.5 h-3.5 rounded-full bg-white transition-transform shadow-md",
                                moltenMetalConfig.grain ? "translate-x-5" : "translate-x-0"
                              )}
                            />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}



