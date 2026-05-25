import { useCallback, useEffect, useId, useRef } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { ProfileDto } from "../../types/profile";
import type { ResolvedTheme } from "../../settings/global-settings";
import { tagPillStyle } from "../../utils/tag-pills";
import { FolderChevronIcon, HamburgerMenuIcon, NewTerminalIcon } from "../profile-icons";

/**
 * Sentinel folder id for the "no tag" bucket. Real tags can be any user
 * string; the sentinel uses a leading null byte so it can never collide with
 * a tag the user typed in.
 */
const UNTAGGED_FOLDER_ID = "\0untagged";

/**
 * Reusable folder-membership predicate. Returned together with display info so
 * the tree can derive `searchActive === false` rendering and the
 * auto-expand-on-selection effect from one source of truth.
 */
type FolderDescriptor = {
  id: string;
  label: string;
  isUntagged: boolean;
  member: (p: ProfileDto) => boolean;
};

function buildFolderDescriptors(allTags: string[]): FolderDescriptor[] {
  const tagFolders: FolderDescriptor[] = allTags.map((tag) => ({
    id: tag,
    label: tag,
    isUntagged: false,
    member: (p) => p.tags.includes(tag),
  }));
  const untagged: FolderDescriptor = {
    id: UNTAGGED_FOLDER_ID,
    label: "Untagged",
    isUntagged: true,
    member: (p) => p.tags.length === 0,
  };
  return [...tagFolders, untagged];
}

/** First folder (alphabetical tag order, then Untagged) that contains the profile. */
function firstFolderContaining(folders: FolderDescriptor[], profile: ProfileDto): string | null {
  for (const f of folders) {
    if (f.member(profile)) return f.id;
  }
  return null;
}

/** running / total counts for a folder. */
function folderCounts(profiles: ProfileDto[], member: (p: ProfileDto) => boolean) {
  let running = 0;
  let total = 0;
  for (const p of profiles) {
    if (!member(p)) continue;
    total += 1;
    if (p.status === "running") running += 1;
  }
  return { running, total };
}

export function ProfileTree(props: {
  profiles: ProfileDto[];
  allTags: string[];
  selectedId: string | null;
  resolvedTheme: ResolvedTheme;
  /**
   * Expanded state is owned by the parent (`ProfileSidebar`) so the tree's
   * collapse state survives the search/tree toggle — when the user types into
   * the sidebar filter, this component unmounts and the flat results list
   * takes its place; on clear-search we re-mount with the same `expanded` set.
   */
  expanded: Set<string>;
  setExpanded: Dispatch<SetStateAction<Set<string>>>;
  renderProfileRow: (p: ProfileDto, opts: { showTagPills: boolean }) => ReactNode;
  /**
   * Anchors the bulk-actions popup for a tag-folder row. The actual menu
   * (Start all / Stop all / Restart all) is rendered at the app root by
   * `TagContextMenu` — the tree only knows how to open it. Untagged folders
   * never call this (there's no `start_tag("")` equivalent backend command).
   */
  onOpenTagMenu: (tag: string, clientX: number, clientY: number) => void;
  /**
   * Which tag's menu is currently open, or `null`. Used so the matching
   * overflow button can render `aria-expanded={true}`, matching the
   * right-panel overflow button's behavior.
   */
  tagMenuOpenForTag: string | null;
  /**
   * Opens the profile-editor in create mode with the folder's tag already
   * populated as a chip — invoked by the per-folder `+` button shown next to
   * the tag pill on hover. Untagged folders never call this (the pill is the
   * "no tag" placeholder, so there's nothing meaningful to pre-fill).
   */
  onNewTerminalForTag: (tag: string) => void;
}) {
  const { profiles, allTags, selectedId, resolvedTheme, renderProfileRow, expanded, setExpanded } =
    props;
  const folders = buildFolderDescriptors(allTags);
  const visibleFolders = folders.filter((f) => folderCounts(profiles, f.member).total > 0);

  // Auto-expand the first folder containing the selected profile when selection
  // changes — so selecting from elsewhere (search clear, sidebar key nav,
  // window restore) keeps the row visible. Already-expanded state is preserved;
  // we never *collapse* on selection.
  const lastAutoExpandedFor = useRef<string | null>(null);
  useEffect(() => {
    if (selectedId == null) {
      lastAutoExpandedFor.current = null;
      return;
    }
    if (lastAutoExpandedFor.current === selectedId) return;
    const profile = profiles.find((p) => p.id === selectedId);
    if (!profile) return;
    const containing = folders.filter((f) => f.member(profile)).map((f) => f.id);
    if (containing.length === 0) return;
    const anyExpanded = containing.some((id) => expanded.has(id));
    if (anyExpanded) {
      lastAutoExpandedFor.current = selectedId;
      return;
    }
    const first = firstFolderContaining(folders, profile);
    if (first == null) return;
    setExpanded((prev) => {
      if (prev.has(first)) return prev;
      const next = new Set(prev);
      next.add(first);
      return next;
    });
    lastAutoExpandedFor.current = selectedId;
    // `folders` is recomputed each render; depend on its membership signature.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, profiles, allTags]);

  const toggle = useCallback(
    (id: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [setExpanded],
  );

  return (
    <div className="profile-tree" role="tree" aria-label="Terminal profiles by tag">
      {visibleFolders.map((folder) => (
        <TagFolderRow
          key={folder.id}
          folder={folder}
          profiles={profiles}
          expanded={expanded.has(folder.id)}
          toggle={() => toggle(folder.id)}
          resolvedTheme={resolvedTheme}
          renderProfileRow={renderProfileRow}
          onOpenMenu={
            folder.isUntagged
              ? null
              : (x, y) => props.onOpenTagMenu(folder.id, x, y)
          }
          menuOpen={!folder.isUntagged && props.tagMenuOpenForTag === folder.id}
          onNewTerminal={
            folder.isUntagged ? null : () => props.onNewTerminalForTag(folder.id)
          }
        />
      ))}
    </div>
  );
}

function TagFolderRow(props: {
  folder: FolderDescriptor;
  profiles: ProfileDto[];
  expanded: boolean;
  toggle: () => void;
  resolvedTheme: ResolvedTheme;
  renderProfileRow: (p: ProfileDto, opts: { showTagPills: boolean }) => ReactNode;
  /**
   * `null` for the Untagged folder (no bulk-action backend), otherwise opens
   * the shared `TagContextMenu` at the click position. The actual three
   * actions (Start all / Stop all / Restart all) live in the popup, replacing
   * the previous three inline hover icons (see CHANGELOG entry / decisions).
   */
  onOpenMenu: ((clientX: number, clientY: number) => void) | null;
  menuOpen: boolean;
  /**
   * `null` for the Untagged folder (no tag to pre-fill), otherwise opens the
   * profile-editor in create mode with the folder's tag already populated as
   * a chip. The button sits immediately next to the tag pill — hover-revealed
   * exactly like the overflow button.
   */
  onNewTerminal: (() => void) | null;
}) {
  const { folder, profiles, expanded, toggle, resolvedTheme, renderProfileRow } = props;
  const { running, total } = folderCounts(profiles, folder.member);
  const nestedListId = useId();
  const members = profiles.filter(folder.member);
  // Untagged rows show pills (= "no tag" placeholder); tagged rows hide them
  // since the folder header already names the shared tag.
  const showPillsOnNested = folder.isUntagged;

  const labelPillStyle = folder.isUntagged
    ? undefined
    : tagPillStyle(folder.label, false, resolvedTheme);

  const countLabel = folder.isUntagged
    ? `${running} of ${total} untagged terminals running`
    : `${running} of ${total} running in ${folder.label}`;

  return (
    <div
      className={`tag-folder${expanded ? " tag-folder--expanded" : ""}${folder.isUntagged ? " tag-folder--untagged" : ""}`}
      role="treeitem"
      aria-expanded={expanded}
    >
      {/*
       * Row-level click handler so the empty space between the `+` button
       * and the hamburger overflow button (and the bare row strip in
       * general) toggles the folder, matching the tag-pill behavior. The
       * `+` button, the hamburger button, and the count pill already stop
       * propagation on click; the header button below has no `onClick` of
       * its own so its native click events (mouse + keyboard Enter/Space)
       * bubble up here and reuse the same toggle path — a single source
       * of truth, no risk of double-toggle. The header is kept as a
       * focusable `<button>` so screen readers still get the
       * `aria-expanded` / `aria-controls` semantics.
       */}
      <div
        className="tag-folder-row"
        onClick={toggle}
        role="presentation"
      >
        <button
          type="button"
          className="tag-folder-header"
          aria-expanded={expanded}
          aria-controls={nestedListId}
          title={expanded ? `Collapse ${folder.label}` : `Expand ${folder.label}`}
        >
          <FolderChevronIcon expanded={expanded} />
          {folder.isUntagged ? (
            <span className="tag-folder-label tag-folder-label--untagged">{folder.label}</span>
          ) : (
            <span
              className="tag-folder-label tag-pill tag-pill--hue"
              style={labelPillStyle}
            >
              {folder.label}
            </span>
          )}
        </button>
        {props.onNewTerminal ? (
          <button
            type="button"
            className="tag-folder-new-btn"
            aria-label={`New terminal tagged ${folder.label}`}
            title={`New terminal tagged ${folder.label}`}
            onClick={(e) => {
              e.stopPropagation();
              props.onNewTerminal!();
            }}
          >
            <NewTerminalIcon />
          </button>
        ) : null}
        {props.onOpenMenu ? (
          <button
            type="button"
            className={`tag-folder-overflow-btn${props.menuOpen ? " tag-folder-overflow-btn--open" : ""}`}
            aria-label={`Bulk actions for tag ${folder.label}`}
            aria-haspopup="menu"
            aria-expanded={props.menuOpen}
            title={`Bulk actions for ${folder.label}`}
            onClick={(e) => {
              e.stopPropagation();
              const r = e.currentTarget.getBoundingClientRect();
              // Anchor the popup just below the button's right edge, so the
              // menu's top-right roughly tracks the button — the layout
              // effect in `TagContextMenu` clamps it inside the viewport
              // afterwards. Matches the right-panel overflow's positioning.
              props.onOpenMenu!(r.left, r.bottom + 6);
            }}
          >
            <HamburgerMenuIcon />
          </button>
        ) : null}
        <span
          className={`tag-folder-count-pill${running > 0 ? " tag-folder-count-pill--active" : ""}`}
          aria-label={countLabel}
          title={countLabel}
        >
          {running}/{total}
        </span>
      </div>
      {/*
       * The children wrapper is ALWAYS rendered (instead of `expanded ? … :
       * null`) so the row collapse / expand can be a pure-CSS animation —
       * `grid-template-rows: 0fr ↔ 1fr` on `.tag-folder-children-wrap`
       * smoothly transitions to the children's natural height without ever
       * having to measure it in JS. `aria-hidden` + `inert` keep collapsed
       * content out of screen readers and the focus order even though it
       * stays in the DOM. See `.tag-folder-children-wrap` in `styles.css`.
       */}
      <div
        className="tag-folder-children-wrap"
        aria-hidden={!expanded}
        {...(!expanded ? ({ inert: "" } as Record<string, unknown>) : {})}
      >
        <div
          id={nestedListId}
          role="tablist"
          aria-label={`Profiles tagged ${folder.label}`}
          className="tag-folder-children"
        >
          {members.map((p) => renderProfileRow(p, { showTagPills: showPillsOnNested }))}
        </div>
      </div>
    </div>
  );
}
