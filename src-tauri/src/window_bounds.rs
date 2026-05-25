//! Persisted main-window size + outer-frame position, restored before the
//! window is shown so the user never sees the default-size flash that
//! frontend-side restore caused.
//!
//! Storage: `<app_config_dir>/window-bounds.json` (sits next to
//! `terminals.yaml` and `settings.yaml`; the `LOWCAL_CONFIG_DIR` env-var
//! override applies here too via [`crate::resolved_app_config_dir`]).
//!
//! Lifecycle:
//!  * **Restore** runs once from `lib.rs`'s `setup(...)` hook, after the main
//!    window is created (`visible: false` in `tauri.conf.json`) and before
//!    `window.show()`. Missing / corrupt / out-of-range snapshots silently
//!    fall back to the `tauri.conf.json` default size + OS-default centring.
//!  * **Save** is driven from the frontend via [`save_window_bounds`] on a
//!    short debounce — see `src/utils/window-bounds.ts`. The frontend also
//!    flushes on `beforeunload` / `visibilitychange:hidden`. Belt-and-braces:
//!    [`save_current_bounds`] is invoked from the quit paths in `lib.rs` so a
//!    resize-then-immediately-quit still persists the latest bounds.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager};

const BOUNDS_FILE_NAME: &str = "window-bounds.json";

/// Must match `tauri.conf.json` `windows[0].minWidth` / `minHeight`. Restored
/// bounds smaller than this are treated as corrupt (e.g. snapshot from an
/// older, looser-min build) and ignored so we never paint an unusable window.
const MIN_WIDTH: f64 = 1040.0;
const MIN_HEIGHT: f64 = 520.0;

/// Sanity clamp for x/y. The OS already clamps to a visible monitor at
/// `setPosition` time, but a wildly invalid persisted coord (e.g. 50 000)
/// is more likely "corrupted JSON" than a legitimate multi-monitor layout.
const MAX_ABS_COORD: f64 = 20_000.0;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WindowBounds {
    pub width: f64,
    pub height: f64,
    pub x: f64,
    pub y: f64,
}

impl WindowBounds {
    fn is_sane(&self) -> bool {
        self.width.is_finite()
            && self.height.is_finite()
            && self.x.is_finite()
            && self.y.is_finite()
            && self.width >= MIN_WIDTH
            && self.height >= MIN_HEIGHT
            && self.x.abs() <= MAX_ABS_COORD
            && self.y.abs() <= MAX_ABS_COORD
    }
}

fn bounds_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = crate::resolved_app_config_dir(app)?;
    Ok(dir.join(BOUNDS_FILE_NAME))
}

/// Read the persisted bounds, if any. Missing file, parse errors, or
/// sanity-check failures all return `None` — the caller falls back to the
/// `tauri.conf.json` default. Never errors out: we'd rather paint at default
/// than refuse to start because the bounds file is corrupt.
pub(crate) fn load_bounds(app: &AppHandle) -> Option<WindowBounds> {
    let path = bounds_path(app).ok()?;
    let text = fs::read_to_string(&path).ok()?;
    let parsed: WindowBounds = serde_json::from_str(&text).ok()?;
    if !parsed.is_sane() {
        tracing::warn!(
            "{} contained out-of-range bounds {:?}, ignoring",
            BOUNDS_FILE_NAME,
            parsed
        );
        return None;
    }
    Some(parsed)
}

fn write_bounds(app: &AppHandle, bounds: &WindowBounds) -> Result<(), String> {
    let path = bounds_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string(bounds).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

/// Apply bounds to the **main** window via the Rust-side window API. Called
/// from the `setup(...)` hook in `lib.rs` before `window.show()` so the user
/// only ever sees the window at its final size + position. Errors are logged
/// (and swallowed) — the worst case is the user sees the default-size window,
/// which is what would have happened without any persisted bounds anyway.
pub(crate) fn apply_bounds_to_main_window(app: &AppHandle, bounds: WindowBounds) {
    let Some(window) = app.get_webview_window("main") else {
        tracing::warn!("main window not found when applying persisted bounds");
        return;
    };
    if let Err(e) = window.set_size(LogicalSize::new(bounds.width, bounds.height)) {
        tracing::warn!("set_size for persisted bounds failed: {e}");
    }
    if let Err(e) = window.set_position(LogicalPosition::new(bounds.x, bounds.y)) {
        tracing::warn!("set_position for persisted bounds failed: {e}");
    }
}

/// Read the current main-window size + outer-frame position in **logical**
/// pixels. We round-trip through logical (rather than physical) so a snapshot
/// taken on a 2x monitor still restores correctly when the user re-opens the
/// app on a 1x monitor.
fn current_bounds(app: &AppHandle) -> Result<WindowBounds, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window missing".to_string())?;
    // Inner size for width/height (we restore via `set_size`, which sets the
    // inner client area; round-tripping inner ↔ inner keeps the chrome
    // height from accreting across restarts). Outer position for x/y because
    // `set_position` sets the outer frame top-left.
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let inner = window.inner_size().map_err(|e| e.to_string())?;
    let outer = window.outer_position().map_err(|e| e.to_string())?;
    let bounds = WindowBounds {
        width: (inner.width as f64) / scale,
        height: (inner.height as f64) / scale,
        x: (outer.x as f64) / scale,
        y: (outer.y as f64) / scale,
    };
    if !bounds.is_sane() {
        return Err(format!("computed bounds {bounds:?} out of range"));
    }
    Ok(bounds)
}

/// Best-effort capture-and-save of the current main-window bounds. Called
/// from the quit paths in `lib.rs` so a resize that happens within the
/// frontend's 200 ms debounce of Cmd+Q still gets persisted. Errors are
/// logged and swallowed — the worst case is the user's last few pixels of
/// resize don't survive into the next launch.
pub(crate) fn save_current_bounds(app: &AppHandle) {
    let bounds = match current_bounds(app) {
        Ok(b) => b,
        Err(e) => {
            tracing::warn!("save_current_bounds skipped: {e}");
            return;
        }
    };
    if let Err(e) = write_bounds(app, &bounds) {
        tracing::warn!("save_current_bounds write failed: {e}");
    }
}

/// Frontend → backend save. Takes no parameters — the backend reads the
/// current size/position directly off the main window so the frontend can
/// stay a thin debounced trigger without needing `core:window:allow-outer-
/// position` to query it from JS first.
#[tauri::command]
pub fn save_window_bounds(app: AppHandle) -> Result<(), String> {
    let bounds = current_bounds(&app)?;
    write_bounds(&app, &bounds)
}
