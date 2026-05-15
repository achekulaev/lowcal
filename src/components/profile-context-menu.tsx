import { useLayoutEffect, type LegacyRef, type RefObject } from "react";
import type { ProfileContextMenuState } from "../types/ui";

export function ProfileContextMenu(props: {
  state: ProfileContextMenuState | null;
  anchorRef: RefObject<HTMLDivElement | null>;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { state, anchorRef, onEdit, onDelete } = props;

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
      aria-label="Profile actions"
      style={{
        position: "fixed",
        left: state.clientX,
        top: state.clientY,
        zIndex: 1200,
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button type="button" role="menuitem" className="profile-context-menu-item" onClick={onEdit}>
        Edit…
      </button>
      <button type="button" role="menuitem" className="profile-context-menu-item danger" onClick={onDelete}>
        Delete
      </button>
    </div>
  );
}
