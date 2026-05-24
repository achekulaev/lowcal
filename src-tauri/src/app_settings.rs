//! App-wide settings (theme + xterm trio) persisted as `settings.yaml`
//! alongside `terminals.yaml` in the OS app config directory.
//!
//! Stateless on the Rust side: every `get_app_settings` reads the file and every
//! `set_app_settings` writes it. The file is small and the UI only triggers I/O
//! on app start and on Save, so caching would add complexity without measurable
//! benefit. Each field is `#[serde(default)]` so a partial / older YAML still
//! loads — missing fields fall back to the built-in defaults.
//!
//! Intentionally NOT wired into the disk watcher used by `terminals.yaml`:
//! settings are UI-edited; external disk edits take effect on the next launch
//! only, which avoids piling another reload-prompt dialog on top of the
//! existing one.
//!
//! The on-disk directory is resolved via [`crate::resolved_app_config_dir`] so
//! the `LOWCAL_CONFIG_DIR` env-var override is honoured here too — set it
//! before launching the app and `settings.yaml` will live next to the
//! overridden `terminals.yaml` instead of in the OS-standard app config dir.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

const SETTINGS_FILE_NAME: &str = "settings.yaml";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ThemePreference {
    System,
    Dark,
    Light,
}

impl Default for ThemePreference {
    fn default() -> Self {
        ThemePreference::System
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSettings {
    #[serde(default)]
    pub theme: ThemePreference,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalEmulatorSettings {
    #[serde(default = "default_scrollback")]
    pub scrollback: u32,
    #[serde(default = "default_font_family")]
    pub font_family: String,
    #[serde(default = "default_font_size")]
    pub font_size: u32,
}

fn default_scrollback() -> u32 {
    10_000
}

fn default_font_family() -> String {
    "Menlo, Monaco, Consolas, monospace".to_string()
}

fn default_font_size() -> u32 {
    13
}

impl Default for TerminalEmulatorSettings {
    fn default() -> Self {
        Self {
            scrollback: default_scrollback(),
            font_family: default_font_family(),
            font_size: default_font_size(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default)]
    pub appearance: AppearanceSettings,
    #[serde(default)]
    pub terminal: TerminalEmulatorSettings,
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = crate::resolved_app_config_dir(app)?;
    Ok(dir.join(SETTINGS_FILE_NAME))
}

/// Read settings from disk. Missing file or unparseable contents fall back to
/// built-in defaults so the UI never has to reason about file errors.
fn load_settings(app: &AppHandle) -> AppSettings {
    let Ok(path) = settings_path(app) else {
        return AppSettings::default();
    };
    let text = match fs::read_to_string(&path) {
        Ok(t) => t,
        Err(_) => return AppSettings::default(),
    };
    match serde_yaml::from_str::<AppSettings>(&text) {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!("settings.yaml unparseable, falling back to defaults: {e}");
            AppSettings::default()
        }
    }
}

#[tauri::command]
pub fn get_app_settings(app: AppHandle) -> Result<AppSettings, String> {
    Ok(load_settings(&app))
}

#[tauri::command]
pub fn set_app_settings(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    let path = settings_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let yaml = serde_yaml::to_string(&settings).map_err(|e| e.to_string())?;
    fs::write(&path, yaml).map_err(|e| e.to_string())?;
    Ok(())
}
