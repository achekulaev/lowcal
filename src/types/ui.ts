export type ModalMode = null | "create" | "edit";

export type ProfileContextMenuState = {
  clientX: number;
  clientY: number;
  profileId: string;
};

/**
 * Popup-menu state for a sidebar tag-folder row. Mirrors
 * `ProfileContextMenuState`: the menu is rendered at the app root, positioned
 * at `clientX/clientY` via the same fixed-position + viewport-clamp pattern
 * used by `ProfileContextMenu`, and the `tag` field identifies which folder
 * is the bulk-action target (Start all / Stop all / Restart all).
 */
export type TagContextMenuState = {
  clientX: number;
  clientY: number;
  tag: string;
};
