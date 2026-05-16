/** Sidebar activity pulse: recent PTY output within this window lights the status ring. */
export const PTY_OUTPUT_ACTIVITY_MS = 1000;
/** Upper bound after Start click: hard-clear the Start spinner if nothing else cleared it sooner. */
export const START_SPIN_HOLD_MS = 3000;

/** Upper bound after Stop click: hard-clear the Stop spinner if the invoke never settles. */
export const STOP_SPIN_HOLD_MAX_MS = 2200;

/**
 * Minimum perceptible window for the Start/Stop spinner. The backend flips
 * `command_running` synchronously inside `start_profile` / `stop_profile`, so
 * without this floor the spinner would only be visible for a single frame.
 *
 * When backend resolution beats this window, we defer clearing the spin-hold
 * until the floor elapses so the user can actually see the transition.
 */
export const START_SPIN_MIN_VISIBLE_MS = 600;
export const STOP_SPIN_MIN_VISIBLE_MS = 600;

/** After WS connect on a freshly mounted xterm tab, hide the viewport cover only after this many ms from PTY-shell mount — avoids flashing a resizing / partly painted terminal on first tab focus. Re-shows briefly when revisiting tabs that stayed mounted behind the stack — see TerminalWorkArea. */
export const TERMINAL_FIRST_REVEAL_HOLD_MS = 1000;
