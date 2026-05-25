import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import type { Terminal } from "@xterm/xterm";

/**
 * Snap the native window height so the xterm terminal area contains a whole
 * number of character rows — no partial line visible at the bottom.
 *
 * Strategy: "nearest whole line count".
 *   • If the leftover fractional row is < half a cell: shrink by that amount.
 *   • Otherwise: grow by (cellHeight - leftover) to gain a full extra row.
 *
 * Requires capabilities:
 *   core:window:allow-inner-size
 *   core:window:allow-scale-factor
 *   core:window:allow-set-size
 *
 * Silently no-ops in plain Vite dev (no native window) or when xterm's render
 * service hasn't initialised yet.
 */
export async function snapWindowToTerminalLines(
  term: Terminal,
  host: HTMLElement,
): Promise<void> {
  // Access xterm's internal render-service dimensions (same source FitAddon uses).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cellH: number | undefined = (term as any)._core?._renderService?.dimensions?.css?.cell
    ?.height;
  if (!cellH || cellH <= 0) return;

  // FitAddon measures the host element's bounding rect minus its computed padding.
  const style = window.getComputedStyle(host);
  const padTop = parseFloat(style.paddingTop) || 0;
  const padBottom = parseFloat(style.paddingBottom) || 0;
  const availableH = host.getBoundingClientRect().height - padTop - padBottom;
  if (availableH <= 0) return;

  const remainder = availableH % cellH;
  // Already within half a pixel of a whole number of rows — nothing to do.
  if (remainder < 0.5 || remainder > cellH - 0.5) return;

  const snapDelta = remainder < cellH / 2 ? -remainder : cellH - remainder;

  try {
    const win = getCurrentWindow();
    const [physSize, scale] = await Promise.all([win.innerSize(), win.scaleFactor()]);
    // Convert physical → logical pixels (1 logical px == 1 CSS px).
    const logW = physSize.width / scale;
    const logH = physSize.height / scale;
    await win.setSize(new LogicalSize(logW, logH + snapDelta));
  } catch {
    // No native window in plain Vite dev mode — ignore.
  }
}
