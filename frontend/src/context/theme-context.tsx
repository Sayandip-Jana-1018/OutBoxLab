"use client"

import * as React from "react"
import type { MoltenMetalColorMode } from "@/components/react-bits/MoltenMetal"

export type ThemeColor = string
export type BackgroundType = "silk" | "metal"

export interface SilkConfig {
  speed: number
  scale: number
  noiseIntensity: number
  rotation: number
}

export interface MoltenMetalConfig {
  color1: string
  color2: string
  color3: string
  speed: number
  scale: number
  detail: number
  glow: number
  coreSize: number
  swirl: number
  fold: number
  blackPoint: number
  brightness: number
  colorMode: MoltenMetalColorMode
  grain: boolean
  grainIntensity: number
  mouseInteraction: boolean
  mouseStrength: number
  opacity: number
}

interface ThemeContextType {
  themeColor: ThemeColor
  setThemeColor: (color: ThemeColor) => void
  backgroundType: BackgroundType
  setBackgroundType: (type: BackgroundType) => void
  silkConfig: SilkConfig
  setSilkConfig: React.Dispatch<React.SetStateAction<SilkConfig>>
  moltenMetalConfig: MoltenMetalConfig
  setMoltenMetalConfig: React.Dispatch<React.SetStateAction<MoltenMetalConfig>>
  resetConfigs: () => void
}

const ThemeContext = React.createContext<ThemeContextType | undefined>(undefined)

// Helper to convert Hex to HSL
function hexToHSL(hex: string): { h: number; s: number; l: number } {
  let r = 0,
    g = 0,
    b = 0
  if (hex.length === 4) {
    r = parseInt("0x" + hex[1] + hex[1])
    g = parseInt("0x" + hex[2] + hex[2])
    b = parseInt("0x" + hex[3] + hex[3])
  } else if (hex.length === 7) {
    r = parseInt("0x" + hex[1] + hex[2])
    g = parseInt("0x" + hex[3] + hex[4])
    b = parseInt("0x" + hex[5] + hex[6])
  }
  r /= 255
  g /= 255
  b /= 255
  const cmin = Math.min(r, g, b),
    cmax = Math.max(r, g, b),
    delta = cmax - cmin
  let h = 0,
    s = 0,
    l = 0

  if (delta === 0) h = 0
  else if (cmax === r) h = ((g - b) / delta) % 6
  else if (cmax === g) h = (b - r) / delta + 2
  else h = (r - g) / delta + 4

  h = Math.round(h * 60)
  if (h < 0) h += 360

  l = (cmax + cmin) / 2
  s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1))
  s = +(s * 100).toFixed(1)
  l = +(l * 100).toFixed(1)

  return { h, s, l }
}

// Convert HSL to Hex
function hslToHex(h: number, s: number, l: number): string {
  l /= 100
  const a = (s * Math.min(l, 1 - l)) / 100
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0")
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

// Generate harmonic gradient palette for Molten Metal from base theme color
function generateMoltenHarmonies(hex: string): { color1: string; color2: string; color3: string } {
  if (hex.toLowerCase() === "#ffffff") {
    return { color1: "#3b82f6", color2: "#ec4899", color3: "#ffffff" }
  }
  const { h, s, l } = hexToHSL(hex)
  // Shift hue by +45 degrees for analogous secondary accent
  const color2Hex = hslToHex((h + 45) % 360, Math.min(100, s + 10), Math.min(85, Math.max(45, l + 15)))
  return {
    color1: hex,
    color2: color2Hex,
    color3: "#ffffff",
  }
}

const DEFAULT_SILK_CONFIG: SilkConfig = {
  speed: 4,
  scale: 1.2,
  noiseIntensity: 1.2,
  rotation: 25,
}

const DEFAULT_MOLTEN_CONFIG: MoltenMetalConfig = {
  color1: "#5227FF",
  color2: "#FF9FFC",
  color3: "#FFFFFF",
  speed: 0.4,
  scale: 3.8,
  detail: 4,
  glow: 2.2,
  coreSize: 0.14,
  swirl: 1.2,
  fold: -0.25,
  blackPoint: 0.03,
  brightness: 1.45,
  colorMode: "molten",
  grain: true,
  grainIntensity: 0.04,
  mouseInteraction: false, // Stopped by default as requested
  mouseStrength: 0.3,
  opacity: 1.0,
}

export function ThemeColorProvider({ children }: { children: React.ReactNode }) {
  const [themeColor, setThemeColorState] = React.useState<ThemeColor>("#8b5cf6")
  const [backgroundType, setBackgroundType] = React.useState<BackgroundType>("metal")
  const [silkConfig, setSilkConfig] = React.useState<SilkConfig>(DEFAULT_SILK_CONFIG)
  const [moltenMetalConfig, setMoltenMetalConfig] = React.useState<MoltenMetalConfig>(() => {
    const harmonies = generateMoltenHarmonies("#8b5cf6")
    return {
      ...DEFAULT_MOLTEN_CONFIG,
      color1: harmonies.color1,
      color2: harmonies.color2,
      color3: harmonies.color3,
    }
  })

  // Theme color updater that automatically syncs background palette harmonies
  const setThemeColor = React.useCallback((newColor: ThemeColor) => {
    setThemeColorState(newColor)
    const harmonies = generateMoltenHarmonies(newColor)
    setMoltenMetalConfig((prev) => ({
      ...prev,
      color1: harmonies.color1,
      color2: harmonies.color2,
      color3: harmonies.color3,
    }))
  }, [])

  const resetConfigs = React.useCallback(() => {
    setSilkConfig(DEFAULT_SILK_CONFIG)
    const harmonies = generateMoltenHarmonies(themeColor)
    setMoltenMetalConfig({
      ...DEFAULT_MOLTEN_CONFIG,
      color1: harmonies.color1,
      color2: harmonies.color2,
      color3: harmonies.color3,
    })
  }, [themeColor])

  React.useEffect(() => {
    const root = document.documentElement
    const { h, s, l } = hexToHSL(themeColor)

    // Set the primary brand color CSS variables
    root.style.setProperty("--primary", `${h} ${s}% ${l}%`)
    root.style.setProperty("--ring", `${h} ${s}% ${l}%`)

    // Calculate foreground color based on lightness
    if (l > 65) {
      root.style.setProperty("--primary-foreground", "0 0% 0%")
    } else {
      root.style.setProperty("--primary-foreground", "0 0% 100%")
    }
  }, [themeColor])

  return (
    <ThemeContext.Provider
      value={{
        themeColor,
        setThemeColor,
        backgroundType,
        setBackgroundType,
        silkConfig,
        setSilkConfig,
        moltenMetalConfig,
        setMoltenMetalConfig,
        resetConfigs,
      }}
    >
      {children}
    </ThemeContext.Provider>
  )
}

export function useThemeColor() {
  const context = React.useContext(ThemeContext)
  if (context === undefined) {
    throw new Error("useThemeColor must be used within a ThemeColorProvider")
  }
  return context
}

