import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { defaultGlobalSettings, type GlobalSettings } from "./global-settings";
import { notifyUserError } from "../utils/errors";

/**
 * Live app-wide settings store backed by the Rust `get_app_settings` /
 * `set_app_settings` commands (file: `<app_config_dir>/settings.yaml`).
 *
 * - Initial state: built-in defaults; replaced on mount once the Rust read returns.
 * - `updateSettings(next)`: optimistic local update + persist. If the persist
 *   fails, we revert local state and surface the error via `notifyUserError`,
 *   matching the `run` helper pattern in `App.tsx`.
 *
 * `ready` flips to `true` after the first load resolves (success or fallback).
 * Consumers can show defaults during the brief window before — both branches
 * are valid `GlobalSettings` shapes.
 */
export function useGlobalSettings() {
  const [settings, setSettings] = useState<GlobalSettings>(defaultGlobalSettings);
  const [ready, setReady] = useState(false);
  const settingsRef = useRef<GlobalSettings>(settings);
  settingsRef.current = settings;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await invoke<GlobalSettings>("get_app_settings");
        if (!cancelled && loaded) {
          setSettings(loaded);
        }
      } catch (e) {
        console.error("Failed to load app settings; using defaults", e);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateSettings = useCallback(async (next: GlobalSettings) => {
    const prev = settingsRef.current;
    setSettings(next);
    try {
      await invoke("set_app_settings", { settings: next });
    } catch (e) {
      console.error("Failed to persist app settings; reverting", e);
      setSettings(prev);
      void notifyUserError(e);
      throw e;
    }
  }, []);

  return { settings, updateSettings, ready };
}
