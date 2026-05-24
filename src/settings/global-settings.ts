import type { ITheme, ITerminalOptions } from "@xterm/xterm";

/**
 * Theme preference is a 3-state global setting:
 * - `"system"` — follow the OS / WebView `prefers-color-scheme` and live-update on change.
 * - `"dark"` / `"light"` — force the named theme regardless of system preference.
 *
 * `"system"` is the default. No UI exists yet; the preference is read from
 * `getGlobalSettings()` and persisted defaults until a settings surface lands.
 */
export type ThemePreference = "system" | "dark" | "light";

/** Resolved theme after collapsing `"system"` against the live `prefers-color-scheme` value. */
export type ResolvedTheme = "dark" | "light";

export interface GlobalAppearanceSettings {
  theme: ThemePreference;
}

/**
 * Terminal emulator prefs we plan to expose app-wide (scrollback, typography, palette).
 * Mirrors a subset of xterm.js `ITerminalOptions` so ctor wiring stays typed. The terminal
 * `theme` is resolved per-render from the global appearance preference; callers should not
 * read `theme` from this slice directly — use `xtermOptionsFromGlobalSettings(t, resolved)`.
 */
export type GlobalTerminalEmulatorSettings = Pick<
  ITerminalOptions,
  "scrollback" | "fontFamily" | "fontSize"
>;

export interface GlobalSettings {
  appearance: GlobalAppearanceSettings;
  terminal: GlobalTerminalEmulatorSettings;
}

const darkTerminalTheme: ITheme = {
  background: "#0d1117",
  foreground: "#e6edf3",
  cursor: "#58a6ff",
};

const lightTerminalTheme: ITheme = {
  background: "#ffffff",
  foreground: "#1f2328",
  cursor: "#0969da",
  selectionBackground: "rgba(9, 105, 218, 0.25)",
};

const defaultGlobalTerminalSettings: GlobalTerminalEmulatorSettings = {
  scrollback: 10_000,
  fontFamily: "Menlo, Monaco, Consolas, monospace",
  fontSize: 13,
};

const defaultGlobalAppearanceSettings: GlobalAppearanceSettings = {
  theme: "system",
};

/**
 * Built-in defaults applied when:
 *  - the user has never opened the settings dialog (no `settings.yaml` on disk),
 *  - the on-disk file is unreadable / unparseable,
 *  - the user clicks Reset to defaults in the settings dialog.
 *
 * Mirrors the Rust `AppSettings::default()` shape so the round-trip is loss-free.
 */
export const defaultGlobalSettings: GlobalSettings = {
  appearance: defaultGlobalAppearanceSettings,
  terminal: defaultGlobalTerminalSettings,
};

/**
 * Synchronous fallback for code paths that cannot await the Rust load
 * (currently unused in production — the live store is `useGlobalSettings()`).
 * Kept exported so tests / future call sites can grab a known-good baseline.
 */
export function getGlobalSettings(): GlobalSettings {
  return defaultGlobalSettings;
}

/** xterm.js `ITheme` matching the resolved app theme. Returned objects are fresh copies. */
export function xtermThemeForResolved(resolved: ResolvedTheme): ITheme {
  return { ...(resolved === "light" ? lightTerminalTheme : darkTerminalTheme) };
}

/**
 * Options for `new Terminal(...)` driven by global settings + the resolved theme.
 * The terminal palette is derived from the global appearance preference rather than from
 * `terminal` directly so that flipping the app theme also flips xterm colors live.
 */
export function xtermOptionsFromGlobalSettings(
  terminal: GlobalSettings["terminal"],
  resolved: ResolvedTheme,
): Pick<ITerminalOptions, "scrollback" | "fontFamily" | "fontSize" | "theme"> {
  return {
    scrollback: terminal.scrollback,
    fontFamily: terminal.fontFamily,
    fontSize: terminal.fontSize,
    theme: xtermThemeForResolved(resolved),
  };
}
