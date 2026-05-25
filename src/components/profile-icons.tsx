export function SidebarTabRunIcon({ running }: { running: boolean }) {
  if (running) {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
        <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
      <path fill="currentColor" d="M9 6.5v11l8.5-5.5L9 6.5z" />
    </svg>
  );
}

export function StartPendingSpinner() {
  return (
    <svg className="start-pending-spinner" viewBox="0 0 24 24" width="20" height="20" aria-hidden>
      <circle
        cx="12"
        cy="12"
        r="8.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="41 14"
      />
    </svg>
  );
}

/**
 * Soft empty-state glyph for the right-pane empty cover (no profile selected).
 * Rounded terminal frame with a `>_` prompt — anchors the eye centrally
 * without competing with the headline below. Stroke + fill both use
 * `currentColor` so the muted token from the cover takes effect.
 */
export function EmptyStateTerminalIcon() {
  return (
    <svg
      className="terminal-empty-glyph"
      width="40"
      height="40"
      viewBox="0 0 32 32"
      aria-hidden
    >
      <rect
        x="3.5"
        y="6.5"
        width="25"
        height="19"
        rx="3.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M9.5 13.25l3.25 2.75-3.25 2.75"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="15" y="18.5" width="6.5" height="1.6" rx="0.7" fill="currentColor" />
    </svg>
  );
}

export function NewTerminalIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path fill="currentColor" d="M19 11h-6V5h-2v6H5v2h6v6h2v-6h6v-2z" />
    </svg>
  );
}

export function SidebarSearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"
      />
    </svg>
  );
}

export function SidebarCloseFilterIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
      />
    </svg>
  );
}

/** Chevron used on tag folder rows; rotates 90° via CSS when `expanded`. */
export function FolderChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`tag-folder-chevron${expanded ? " tag-folder-chevron--expanded" : ""}`}
      width="10"
      height="10"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path fill="currentColor" d="M9 6l6 6-6 6V6z" />
    </svg>
  );
}

/** Filled square — bulk Stop / Stop all (red accent in sidebar header / folder rows). */
export function StopSquareIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden>
      <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" />
    </svg>
  );
}

/** Filled play triangle — bulk Start (green accent on folder rows). */
export function PlayTriangleIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden>
      <path fill="currentColor" d="M8 5.5v13l11-6.5L8 5.5z" />
    </svg>
  );
}

/** Small folder glyph — cwd line in terminal stage header */
export function CwdFolderIcon() {
  return (
    <svg
      className="terminal-stage-cwd-folder-icon"
      viewBox="0 0 24 24"
      width="14"
      height="14"
      aria-hidden
    >
      <path
        fill="currentColor"
        d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"
      />
    </svg>
  );
}

/** Vertical ellipsis — profile overflow (terminal header). */
export function OverflowMenuIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
      <circle cx="12" cy="6" r="1.75" fill="currentColor" />
      <circle cx="12" cy="12" r="1.75" fill="currentColor" />
      <circle cx="12" cy="18" r="1.75" fill="currentColor" />
    </svg>
  );
}

/**
 * Three horizontal lines — bulk-action overflow trigger on sidebar tag-folder
 * rows. Distinct from `OverflowMenuIcon` (vertical dots) used in the right-pane
 * terminal-stage header, so the two surfaces are visually distinguishable at a
 * glance even though both open a context menu.
 */
export function HamburgerMenuIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
      <rect x="4" y="6" width="16" height="2" rx="1" fill="currentColor" />
      <rect x="4" y="11" width="16" height="2" rx="1" fill="currentColor" />
      <rect x="4" y="16" width="16" height="2" rx="1" fill="currentColor" />
    </svg>
  );
}

/** Cog wheel — sidebar header settings entry point. Sized to match other 10px sidebar glyphs. */
export function SettingsGearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="10" height="10" aria-hidden>
      <path
        fill="currentColor"
        d="M19.14 12.94c.04-.31.06-.62.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.5.5 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94 0 .31.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"
      />
    </svg>
  );
}

/** Pencil glyph — Edit action in the profile context menu (sidebar right-click
 *  and right-panel overflow). Material-style 24×24 viewBox so it pairs cleanly
 *  with the other menu glyphs at the shared 14×14 gutter size. */
export function PencilEditIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
      <path
        fill="currentColor"
        d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1.003 1.003 0 0 0 0-1.42l-2.34-2.34a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z"
      />
    </svg>
  );
}

/** Trash-can glyph — Delete action in the profile context menu. Inherits
 *  `currentColor`, so the `.danger` row colour automatically tints it red. */
export function TrashDeleteIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
      <path
        fill="currentColor"
        d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"
      />
    </svg>
  );
}

/** Two arrows on a circle — restart (blue accent in terminal header). */
export function RestartLoopIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
      <path
        fill="currentColor"
        d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"
      />
    </svg>
  );
}
