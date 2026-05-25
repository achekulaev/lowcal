import { useLayoutEffect, type LegacyRef, type RefObject } from "react";
import type { TagContextMenuState } from "../types/ui";
import { PlayTriangleIcon, RestartLoopIcon, StopSquareIcon } from "./profile-icons";

/**
 * Popup menu for the sidebar tag-folder row's three-dots overflow button.
 * Mirrors `ProfileContextMenu`'s implementation (positioned-fixed surface,
 * viewport-clamp in a `useLayoutEffect`, parent owns the open/close state
 * + outside-click + Escape handling) so the two menus look and behave the
 * same way. Items are plain labels — visual parity with Edit/Delete —
 * with the "Stop all" item flagged `danger` so a destructive bulk action
 * still reads as a stronger signal than Start/Restart, matching the
 * existing pattern from `profile-context-menu.tsx`.
 */
export function TagContextMenu(props: {
  state: TagContextMenuState | null;
  anchorRef: RefObject<HTMLDivElement | null>;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
}) {
  const { state, anchorRef, onStart, onStop, onRestart } = props;

  useLayoutEffect(() => {
    if (!state || !anchorRef.current) return;
    const pad = 8;
    const el = anchorRef.current;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rect = el.getBoundingClientRect();
    let left = state.clientX;
    let top = state.clientY;
    if (left + rect.width > vw - pad) left = vw - rect.width - pad;
    if (top + rect.height > vh - pad) top = vh - rect.height - pad;
    if (left < pad) left = pad;
    if (top < pad) top = pad;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [state, anchorRef]);

  if (!state) return null;

  return (
    <div
      ref={anchorRef as LegacyRef<HTMLDivElement>}
      className="profile-context-menu"
      role="menu"
      aria-label={`Bulk actions for tag ${state.tag}`}
      style={{
        position: "fixed",
        left: state.clientX,
        top: state.clientY,
        zIndex: 1200,
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        type="button"
        role="menuitem"
        className="profile-context-menu-item profile-context-menu-item--with-icon"
        onClick={onStart}
      >
        <span className="profile-context-menu-item__icon profile-context-menu-item__icon--start" aria-hidden>
          <PlayTriangleIcon />
        </span>
        Start all
      </button>
      <button
        type="button"
        role="menuitem"
        className="profile-context-menu-item profile-context-menu-item--with-icon danger"
        onClick={onStop}
      >
        <span className="profile-context-menu-item__icon profile-context-menu-item__icon--stop" aria-hidden>
          <StopSquareIcon />
        </span>
        Stop all
      </button>
      <button
        type="button"
        role="menuitem"
        className="profile-context-menu-item profile-context-menu-item--with-icon"
        onClick={onRestart}
      >
        <span className="profile-context-menu-item__icon profile-context-menu-item__icon--restart" aria-hidden>
          <RestartLoopIcon />
        </span>
        Restart all
      </button>
    </div>
  );
}
