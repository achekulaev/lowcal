import type { MouseEvent as ReactMouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Mousedown handler that turns the bound element into a window-drag region.
 *
 * Tauri 2's automatic `data-tauri-drag-region` attribute is unreliable across
 * versions and host configurations (timing of the injected listener, CSP
 * interactions, hit-testing under `titleBarStyle: "Overlay"`). Calling
 * `getCurrentWindow().startDragging()` ourselves from a real React mousedown
 * is bulletproof in comparison.
 *
 * Skips clicks that originate on interactive children (button/input/textarea
 * /select/a or any element explicitly opted out via `[data-no-drag]`), and
 * treats a double-click as toggle-maximize so the rebadged titlebar area
 * keeps the native macOS double-click-to-zoom affordance.
 *
 * Requires `core:window:allow-start-dragging` and
 * `core:window:allow-set-maximizable`/`allow-toggle-maximize` in the window
 * capability (see `src-tauri/capabilities/default.json`).
 */
export function onWindowDragMouseDown(e: ReactMouseEvent) {
  if (e.button !== 0) return;
  const target = e.target as HTMLElement | null;
  if (!target) return;
  if (target.closest("button, input, textarea, select, a, [data-no-drag]")) return;

  const win = getCurrentWindow();
  if (e.detail === 2) {
    void win.toggleMaximize().catch(() => {
      /* Plain Vite (`npm run dev`) has no native window */
    });
    return;
  }
  void win.startDragging().catch(() => {
    /* Plain Vite (`npm run dev`) has no native window */
  });
}
