import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  defaultGlobalSettings,
  type GlobalSettings,
  type ThemePreference,
} from "../settings/global-settings";

const SCROLLBACK_MIN = 100;
const SCROLLBACK_MAX = 1_000_000;
const FONT_SIZE_MIN = 8;
const FONT_SIZE_MAX = 32;

const THEME_OPTIONS: ReadonlyArray<{ id: ThemePreference; label: string }> = [
  { id: "system", label: "System (follow OS)" },
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
];

function isThemePreference(v: string): v is ThemePreference {
  return v === "system" || v === "dark" || v === "light";
}

function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const n = Math.floor(Number.parseFloat(raw));
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

export function AppSettingsModal(props: {
  open: boolean;
  settings: GlobalSettings;
  saving: boolean;
  saveError: string | null;
  onClose: () => void;
  onSave: (next: GlobalSettings) => Promise<void>;
}) {
  const { open, settings, saving, saveError, onClose, onSave } = props;
  const [draft, setDraft] = useState<GlobalSettings>(settings);
  const firstFieldRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (open) setDraft(settings);
  }, [open, settings]);

  useLayoutEffect(() => {
    if (!open) return;
    firstFieldRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const setTheme = (theme: ThemePreference) =>
    setDraft((d) => ({ ...d, appearance: { ...d.appearance, theme } }));

  const setTerminalField = <K extends keyof GlobalSettings["terminal"]>(
    key: K,
    value: GlobalSettings["terminal"][K],
  ) => setDraft((d) => ({ ...d, terminal: { ...d.terminal, [key]: value } }));

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="app-settings-title">
        <header id="app-settings-title">Settings</header>
        <form
          id="app-settings-modal-form"
          className="modal-body"
          onSubmit={(e) => {
            e.preventDefault();
            void onSave(draft);
          }}
        >
          <div className="modal-section">
            <div className="modal-section-title">Appearance</div>
            <div className="modal-field">
              <label htmlFor="app-settings-theme">Theme</label>
              <select
                ref={firstFieldRef}
                id="app-settings-theme"
                value={draft.appearance.theme}
                onChange={(e) => {
                  const v = e.target.value;
                  if (isThemePreference(v)) setTheme(v);
                }}
              >
                {THEME_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="modal-section">
            <div className="modal-section-title">Terminal</div>
            <div className="modal-field">
              <label htmlFor="app-settings-scrollback">Scrollback (lines)</label>
              <input
                id="app-settings-scrollback"
                type="number"
                min={SCROLLBACK_MIN}
                max={SCROLLBACK_MAX}
                step={100}
                value={draft.terminal.scrollback}
                onChange={(e) =>
                  setTerminalField(
                    "scrollback",
                    clampInt(
                      e.target.value,
                      SCROLLBACK_MIN,
                      SCROLLBACK_MAX,
                      defaultGlobalSettings.terminal.scrollback ?? 10_000,
                    ),
                  )
                }
              />
            </div>
            <div className="modal-field">
              <label htmlFor="app-settings-font-family">Font family</label>
              <input
                id="app-settings-font-family"
                type="text"
                value={draft.terminal.fontFamily ?? ""}
                onChange={(e) => setTerminalField("fontFamily", e.target.value)}
                placeholder={defaultGlobalSettings.terminal.fontFamily}
                spellCheck={false}
                autoComplete="off"
              />
            </div>
            <div className="modal-field">
              <label htmlFor="app-settings-font-size">Font size (px)</label>
              <input
                id="app-settings-font-size"
                type="number"
                min={FONT_SIZE_MIN}
                max={FONT_SIZE_MAX}
                step={1}
                value={draft.terminal.fontSize}
                onChange={(e) =>
                  setTerminalField(
                    "fontSize",
                    clampInt(
                      e.target.value,
                      FONT_SIZE_MIN,
                      FONT_SIZE_MAX,
                      defaultGlobalSettings.terminal.fontSize ?? 13,
                    ),
                  )
                }
              />
            </div>
            <p className="modal-hint">
              Terminal options apply to newly opened terminal tabs. Close and reopen a tab (or
              Restart its profile) to see changes in an existing session.
            </p>
          </div>
        </form>
        {saveError ? (
          <p className="modal-save-error" role="alert">
            {saveError}
          </p>
        ) : null}
        <footer className="modal-footer">
          <button
            type="button"
            className="modal-footer-secondary"
            disabled={saving}
            onClick={() => setDraft(defaultGlobalSettings)}
            title="Reset all fields to built-in defaults (not saved until you click Save)"
          >
            Reset to defaults
          </button>
          <button type="button" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="app-settings-modal-form" className="primary" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </footer>
      </div>
    </div>
  );
}
