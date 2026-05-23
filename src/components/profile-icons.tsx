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
