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
 * Muted pastel pill colors derived from the tag string (same name → same colors).
 * Tuned for dark UI: capped saturation/lightness so hues stay distinguishable but not neon.
 */
export function tagPillStyle(tag: string, highlighted: boolean): CSSProperties {
  const key = tag.trim();
  const k = key.length === 0 ? "\0" : key;
  // `u % 360` on a single FNV word often clusters similar tags; multiply-spread fixes that.
  const hueSeed = tagWord(k, "hue");
  const hue = (Math.imul(hueSeed, 2654435761) >>> 0) % 360;
  const sat = 16 + (tagWord(k, "sat") % 17); // 16–32%, paler chroma
  const bgBase = 22 + (tagWord(k, "bg") % 9); // 22–30%, slightly milkier tint
  const fg = 70 + (tagWord(k, "fg") % 14); // 70–83%, soft label
  const bg = highlighted ? bgBase + 5 : bgBase;
  const borderSat = Math.max(sat - 10, 9);
  const borderL = bg + (highlighted ? 18 : 10);
  const fgSat = Math.min(sat + 5, 34);
  return {
    background: `hsl(${hue} ${sat}% ${bg}%)`,
    color: `hsl(${hue} ${fgSat}% ${fg}%)`,
    border: `1px solid hsl(${hue} ${highlighted ? Math.min(sat + 8, 36) : borderSat}% ${Math.min(borderL, 44)}%)`,
  };
}
