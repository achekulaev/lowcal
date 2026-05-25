import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Debounce window for invoking the Rust-side save command. `onResized` and
 * `onMoved` fire on every pixel of an active drag (dozens per second), so a
 * round-trip-per-event would be wasteful. 200 ms is short enough that the
 * last size/position is durable by the time the user reaches for Cmd+Q;
 * the quit-path handlers on the Rust side (`save_current_bounds` invoked
 * from `confirm_quit_proceed` / `CloseRequested` / the Cmd+Q menu) are the
 * belt-and-braces flush for the resize-then-immediately-quit edge case.
 */
const FLUSH_DEBOUNCE_MS = 200;

/**
 * Persistence is **Rust-driven**: the backend reads the current main-window
 * size + outer-frame position via Tauri's window API and writes
 * `<app_config_dir>/window-bounds.json` itself. This is also the file
 * `setup(...)` reads before showing the window, so a frontend that's "just
 * a debounced trigger" stays decoupled from the storage format.
 */
async function saveBoundsViaTauri(): Promise<void> {
  try {
    await invoke("save_window_bounds");
  } catch {
    // Save errors are non-actionable from the UI — the next debounced flush
    // (or the quit-path fallback in Rust) will retry. Don't surface a toast
    // for something the user can't fix.
  }
}

/**
 * Install resize + move listeners that ask Rust to persist the current
 * bounds on a short debounce. Returns an `unsubscribe()`. Safe to call
 * before the native window is fully ready; if any of the underlying IPC
 * calls fail (plain Vite dev with no Tauri context), the returned
 * unsubscribe is a no-op.
 *
 * Restoring on startup is handled entirely on the Rust side in the
 * `setup(...)` hook — `tauri.conf.json` ships the main window with
 * `visible: false` so the user never sees the default 1280×840 flash that
 * frontend-side restore would otherwise cause.
 */
export async function installWindowBoundsPersistence(): Promise<() => void> {
  let timer: ReturnType<typeof setTimeout> | null = null;

  let win: ReturnType<typeof getCurrentWindow>;
  try {
    win = getCurrentWindow();
  } catch {
    // No native window (plain Vite dev) — return a no-op unsubscribe.
    return () => {};
  }

  const flush = () => {
    timer = null;
    void saveBoundsViaTauri();
  };
  const schedule = () => {
    if (timer != null) clearTimeout(timer);
    timer = setTimeout(flush, FLUSH_DEBOUNCE_MS);
  };
  const flushNow = () => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
    void saveBoundsViaTauri();
  };

  let unlistenResize: () => void = () => {};
  let unlistenMove: () => void = () => {};
  try {
    unlistenResize = await win.onResized(() => schedule());
    unlistenMove = await win.onMoved(() => schedule());
  } catch {
    // Event subscription failed — leave the noop unlisteners; the
    // beforeunload/visibility flushers below still work.
  }

  const beforeUnload = () => flushNow();
  const visibilityHandler = () => {
    if (document.visibilityState === "hidden") flushNow();
  };
  window.addEventListener("beforeunload", beforeUnload);
  document.addEventListener("visibilitychange", visibilityHandler);

  return () => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
    unlistenResize();
    unlistenMove();
    window.removeEventListener("beforeunload", beforeUnload);
    document.removeEventListener("visibilitychange", visibilityHandler);
  };
}
