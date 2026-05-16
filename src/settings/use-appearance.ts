import { useEffect, useState } from "react";
import type { ResolvedTheme, ThemePreference } from "./global-settings";

const PREFERS_DARK_QUERY = "(prefers-color-scheme: dark)";

function readSystemResolved(): ResolvedTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "dark";
  }
  return window.matchMedia(PREFERS_DARK_QUERY).matches ? "dark" : "light";
}

function resolveThemePreference(
  preference: ThemePreference,
  system: ResolvedTheme,
): ResolvedTheme {
  return preference === "system" ? system : preference;
}

function applyResolvedThemeToDocument(resolved: ResolvedTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", resolved);
  // Browser-level color scheme hints (form controls, scrollbars) follow the resolved theme.
  root.style.colorScheme = resolved;
}

/**
 * Resolve the user's theme preference to a concrete `"dark" | "light"` value and apply it
 * to `<html data-theme=...>` (so CSS can scope tokens with `:root[data-theme="dark|light"]`).
 *
 * When preference is `"system"` the hook subscribes to `prefers-color-scheme` changes so the
 * UI flips live as the OS appearance toggles (no app restart, no reload).
 */
export function useAppearance(preference: ThemePreference): ResolvedTheme {
  const [systemResolved, setSystemResolved] = useState<ResolvedTheme>(() => readSystemResolved());

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(PREFERS_DARK_QUERY);
    const onChange = (e: MediaQueryListEvent) => {
      setSystemResolved(e.matches ? "dark" : "light");
    };
    // Defensive: Safari <14 used `addListener` only; modern WebKit/Chromium have `addEventListener`.
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, []);

  const resolved = resolveThemePreference(preference, systemResolved);

  useEffect(() => {
    applyResolvedThemeToDocument(resolved);
  }, [resolved]);

  return resolved;
}
