import type { CSSProperties } from "react";

/** FNV-1a 32-bit — stable, fast string fingerprint for palette derivation. */
function fnv1a32(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Avalanche bits so nearby raw hashes become distant values (helps hue separation). */
function mix32(x: number): number {
  let z = x >>> 0;
  z ^= z >>> 16;
  z = Math.imul(z, 0x85ebca6b);
  z ^= z >>> 13;
  z = Math.imul(z, 0xc2b2ae35);
  z ^= z >>> 16;
  return z >>> 0;
}

/** Independent dimension seeds — avoids hue/sat/bg sliding together from one word of state. */
function tagWord(trimmedOrSentinel: string, salt: string): number {
  return mix32(fnv1a32(`${salt}\0${trimmedOrSentinel}`));
}

/**
 * Allowed hue bands (degrees). Purples / magentas (260–330) are intentionally
 * excluded; the blue band (200–260) is widened to absorb what would have been
 * purple pills. Total weight = 290°. A band that wraps past 360 (red/warm)
 * is normalised via `% 360` at the end.
 */
const HUE_BANDS: ReadonlyArray<readonly [number, number]> = [
  [350, 390], // red → warm (40°), wraps past 360°
  [30, 60], // orange (30°)
  [60, 95], // yellow / chartreuse (35°)
  [95, 160], // greens (65°)
  [160, 200], // teal / cyan (40°)
  [200, 260], // blues (60°) — widened to replace purples
  [330, 350], // pink / rose (20°)
];

const HUE_BAND_WIDTHS: ReadonlyArray<number> = HUE_BANDS.map(
  ([a, b]) => b - a,
);
const HUE_TOTAL_WIDTH: number = HUE_BAND_WIDTHS.reduce((s, w) => s + w, 0);

/** Map a 32-bit hash into one of the allowed hue bands, preserving spread. */
function hueFromBands(spread: number): number {
  let r = spread % HUE_TOTAL_WIDTH;
  for (let i = 0; i < HUE_BANDS.length; i++) {
    const w = HUE_BAND_WIDTHS[i];
    if (r < w) return (HUE_BANDS[i][0] + r) % 360;
    r -= w;
  }
  return 0;
}

/**
 * Muted pastel pill colors derived from the tag string (same name → same colors).
 * Tuned for dark UI: capped saturation/lightness so hues stay distinguishable but
 * not neon. Roughly 1 in 5 tags renders as a near-neutral grey to break up the
 * coloured row; purples are not used, with their mass shifted into blues.
 */
export function tagPillStyle(tag: string, highlighted: boolean): CSSProperties {
  const key = tag.trim();
  const k = key.length === 0 ? "\0" : key;
  // `u % N` on a single FNV word often clusters similar tags; multiply-spread fixes that.
  const hueSeed = tagWord(k, "hue");
  const hueSpread = Math.imul(hueSeed, 2654435761) >>> 0;
  const hue = hueFromBands(hueSpread);
  // ~1 in 5 tags use a neutral grey palette — derived from a separate hash word
  // so the choice is deterministic per tag and independent of hue selection.
  const isGrey = tagWord(k, "grey") % 5 === 0;
  const sat = isGrey
    ? 3 + (tagWord(k, "sat") % 6) // 3–8%, near-neutral
    : 16 + (tagWord(k, "sat") % 17); // 16–32%, paler chroma
  const bgBase = 22 + (tagWord(k, "bg") % 9); // 22–30%, slightly milkier tint
  const fg = 70 + (tagWord(k, "fg") % 14); // 70–83%, soft label
  const bg = highlighted ? bgBase + 5 : bgBase;
  const borderSat = Math.max(sat - 10, isGrey ? 0 : 9);
  const borderL = bg + (highlighted ? 18 : 10);
  const fgSat = isGrey ? Math.min(sat + 2, 10) : Math.min(sat + 5, 34);
  const highlightBorderSat = highlighted
    ? Math.min(sat + 8, isGrey ? 14 : 36)
    : borderSat;
  return {
    background: `hsl(${hue} ${sat}% ${bg}%)`,
    color: `hsl(${hue} ${fgSat}% ${fg}%)`,
    border: `1px solid hsl(${hue} ${highlightBorderSat}% ${Math.min(borderL, 44)}%)`,
  };
}
