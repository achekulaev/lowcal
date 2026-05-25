import { useEffect, useRef, useState } from "react";
import { tagPillStyle } from "../../utils/tag-pills";
import { onWindowDragMouseDown } from "../../utils/window-drag";
import {
  SidebarTabRunIcon,
  StartPendingSpinner,
  NewTerminalIcon,
  SettingsGearIcon,
  SidebarSearchIcon,
  SidebarCloseFilterIcon,
  StopSquareIcon,
} from "../profile-icons";
import type { ProfileDto } from "../../types/profile";
import type { ResolvedTheme } from "../../settings/global-settings";
import { PTY_OUTPUT_ACTIVITY_MS } from "../../constants/terminal-ui";
import { ProfileTree } from "./profile-tree";
import type { LegacyRef, MutableRefObject, RefObject } from "react";

/**
 * localStorage key for the expanded tag-folder set. Stored as a JSON array of
 * folder ids (real tag strings plus the `UNTAGGED_FOLDER_ID` sentinel from
 * `profile-tree.tsx`). Bumping this key effectively resets everyone's saved
 * tree state, so leave it alone unless the shape changes.
 */
const EXPANDED_TAG_FOLDERS_STORAGE_KEY = "terminal-orchestrator:expanded-tag-folders";

function loadExpandedTagFolders(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_TAG_FOLDERS_STORAGE_KEY);
    if (raw == null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    // Corrupt JSON, disabled storage, or quota errors — fall back to empty.
    return new Set();
  }
}

function saveExpandedTagFolders(set: Set<string>) {
  try {
    localStorage.setItem(EXPANDED_TAG_FOLDERS_STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    // Storage disabled / quota exceeded — degrade silently; the in-memory set
    // still drives the UI for this session.
  }
}

/**
 * Single sidebar row for one profile. Rendered both by the tag tree (nested
 * under expanded folders) and by the flat search-results list. `showTagPills`
 * controls whether the row paints its `.tags-inline` chip strip:
 *  - `false` under tag folders — folder already names the tag, repeating pills
 *    on every nested row creates noise.
 *  - `true` in flat search results and inside the Untagged folder — the user
 *    is looking at profiles without a single shared tag context, so the pills
 *    (or "no tag" placeholder) are the only on-row hint of categorisation.
 */
export function ProfileTabRow(props: {
  profile: ProfileDto;
  selected: boolean;
  showTagPills: boolean;
  resolvedTheme: ResolvedTheme;
  ptyOutputRecent: boolean;
  startBusy: boolean;
  stopBusy: boolean;
  onSelect: () => void;
  onOpenContextMenu: (e: React.MouseEvent) => void;
  onToggleRun: () => void;
}) {
  const p = props.profile;
  // Red dot only when:
  //   1) the saved command is no longer running (`stopped`),
  //   2) it was started via **Start** / `startCommandOnAppOpen` and **Stop** hasn't been
  //      pressed since (`startedViaUi`),
  //   3) and the captured exit code is non-zero.
  // Manual typing in the PTY never sets `startedViaUi`, so user-typed commands that exit
  // non-zero do not turn the dot red.
  const failed =
    p.status === "stopped" &&
    p.startedViaUi &&
    p.lastExitCode != null &&
    p.lastExitCode !== 0;
  const dotVariant = p.status === "running" ? "running" : failed ? "error" : "stopped";
  const dotTitle = props.ptyOutputRecent
    ? `${p.status} — receiving terminal output`
    : failed
      ? `Start command failed (exit code ${p.lastExitCode})`
      : p.status;
  return (
    <div
      role="presentation"
      className={`profile-row-wrap tab-rail-profile${props.selected ? " selected" : ""}`}
    >
      <button
        type="button"
        role="tab"
        aria-selected={props.selected}
        className="profile-row"
        onClick={props.onSelect}
        onContextMenu={props.onOpenContextMenu}
      >
        <span
          className={`status-dot-wrap${props.ptyOutputRecent ? " status-dot-wrap--activity" : ""}`}
          title={dotTitle}
        >
          <span className={`status-dot ${dotVariant}`} />
          <span className="status-dot-wrap__ring" aria-hidden />
        </span>
        <div className="profile-meta">
          <div className="profile-title">{p.displayName}</div>
          {props.showTagPills ? (
            <div className="tags-inline">
              {p.tags.length > 0 ? (
                p.tags.map((t) => (
                  <span
                    key={t}
                    className="tag-pill tag-pill--hue"
                    style={tagPillStyle(t, false, props.resolvedTheme)}
                  >
                    {t}
                  </span>
                ))
              ) : (
                <span className="tag-pill tag-pill--placeholder">no tag</span>
              )}
            </div>
          ) : null}
        </div>
      </button>
      <button
        type="button"
        className={`profile-tab-run-btn${
          props.startBusy || props.stopBusy
            ? " pending"
            : p.status === "running"
              ? " stop"
              : ""
        }`}
        disabled={props.startBusy || props.stopBusy}
        aria-busy={props.startBusy || props.stopBusy}
        title={
          props.startBusy
            ? "Starting…"
            : props.stopBusy
              ? "Stopping…"
              : p.status === "running"
                ? "Stop"
                : "Start saved command"
        }
        aria-label={
          props.startBusy
            ? `Starting ${p.displayName}`
            : props.stopBusy
              ? `Stopping ${p.displayName}`
              : p.status === "running"
                ? `Stop ${p.displayName}`
                : `Start saved command for ${p.displayName}`
        }
        onClick={(e) => {
          e.stopPropagation();
          props.onToggleRun();
        }}
      >
        {props.startBusy || props.stopBusy ? (
          <StartPendingSpinner />
        ) : p.status === "running" ? (
          <SidebarTabRunIcon running />
        ) : (
          <SidebarTabRunIcon running={false} />
        )}
      </button>
    </div>
  );
}

export function ProfileSidebar(props: {
  query: string;
  setQuery: (q: string) => void;
  sidebarFilterOpen: boolean;
  setSidebarFilterOpen: (v: boolean) => void;
  sidebarFilterInputRef: RefObject<HTMLInputElement | null>;
  profiles: ProfileDto[];
  allTags: string[];
  searchActive: boolean;
  searchResults: ProfileDto[];
  selectedId: string | null;
  setSelectedId: (id: string) => void;
  setProfileMenu: (s: { clientX: number; clientY: number; profileId: string }) => void;
  openCreateModal: () => void;
  toggleProfileRun: (p: ProfileDto) => void;
  startSpinHold: Record<string, true>;
  stopSpinHold: Record<string, true>;
  ptyOutputActivityTick: number;
  lastPtyOutputMsRef: MutableRefObject<Record<string, number>>;
  resolvedTheme: ResolvedTheme;
  onStopAll: () => void;
  onOpenSettings: () => void;
  /**
   * Opens the shared `TagContextMenu` from a tag-folder row's overflow
   * button. The menu surface and its actions (Start all / Stop all / Restart
   * all) live at the app root — sidebar only knows the click coordinates and
   * the target tag.
   */
  onOpenTagMenu: (tag: string, clientX: number, clientY: number) => void;
  /** Which tag's menu is currently open (for `aria-expanded` on the row). */
  tagMenuOpenForTag: string | null;
}) {
  const {
    query,
    setQuery,
    sidebarFilterOpen,
    setSidebarFilterOpen,
    sidebarFilterInputRef,
    profiles,
    allTags,
    searchActive,
    searchResults,
    selectedId,
    setSelectedId,
    setProfileMenu,
    openCreateModal,
    toggleProfileRun,
    startSpinHold,
    stopSpinHold,
    ptyOutputActivityTick,
    lastPtyOutputMsRef,
    resolvedTheme,
    onStopAll,
    onOpenSettings,
    onOpenTagMenu,
    tagMenuOpenForTag,
  } = props;

  // Owned by the sidebar (not the tree) so collapse state survives the
  // search/tree toggle — the tree unmounts while a query is active.
  // Hydrated from `localStorage` so a restart restores the user's last
  // expanded/collapsed shape; see `loadExpandedTagFolders` above.
  const [expandedTagFolders, setExpandedTagFolders] = useState<Set<string>>(
    loadExpandedTagFolders,
  );

  // Mirror every change back to `localStorage`. Cheap (small string, single
  // write per user toggle / new-tag expansion); no debounce needed.
  useEffect(() => {
    saveExpandedTagFolders(expandedTagFolders);
  }, [expandedTagFolders]);

  // Auto-expand any tag that's *newly created* during this session so the
  // user immediately sees the row they just added inside its folder. We must
  // be careful about *when* to capture the baseline: `profiles` from
  // `useProfiles` starts as `[]` and is replaced asynchronously once the
  // backend's `list_profiles` call resolves (and again on every
  // `profiles-updated` event). Snapshotting on the very first effect run
  // would therefore record an empty set and then treat every pre-existing
  // tag arriving on the next render as "new", clobbering the restored
  // expanded state. Wait for the first non-empty `allTags` instead — at
  // that point profiles have been loaded and the snapshot represents the
  // workspace's actual starting tag set.
  const knownTagsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (knownTagsRef.current === null) {
      if (allTags.length === 0) return;
      knownTagsRef.current = new Set(allTags);
      return;
    }
    const known = knownTagsRef.current;
    const newlyAdded: string[] = [];
    for (const t of allTags) {
      if (!known.has(t)) {
        newlyAdded.push(t);
        known.add(t);
      }
    }
    if (newlyAdded.length === 0) return;
    setExpandedTagFolders((prev) => {
      let next: Set<string> | null = null;
      for (const t of newlyAdded) {
        if (prev.has(t)) continue;
        if (next === null) next = new Set(prev);
        next.add(t);
      }
      return next ?? prev;
    });
  }, [allTags]);

  // Bottom-of-row hover/focus controls call `onToggleRun(p)` — wrap to keep
  // the signature compatible with the tree's per-row `ProfileTabRow`.
  const renderProfileRow = (p: ProfileDto, opts: { showTagPills: boolean }) => {
    void ptyOutputActivityTick;
    const tOut = lastPtyOutputMsRef.current[p.id];
    const ptyOutputRecent = tOut != null && Date.now() - tOut < PTY_OUTPUT_ACTIVITY_MS;
    const startBusy = Boolean(startSpinHold[p.id]);
    const stopBusy = Boolean(stopSpinHold[p.id]);
    return (
      <ProfileTabRow
        key={p.id}
        profile={p}
        selected={selectedId === p.id}
        showTagPills={opts.showTagPills}
        resolvedTheme={resolvedTheme}
        ptyOutputRecent={ptyOutputRecent}
        startBusy={startBusy}
        stopBusy={stopBusy}
        onSelect={() => setSelectedId(p.id)}
        onOpenContextMenu={(e) => {
          e.preventDefault();
          setProfileMenu({
            clientX: e.clientX,
            clientY: e.clientY,
            profileId: p.id,
          });
        }}
        onToggleRun={() => toggleProfileRun(p)}
      />
    );
  };

  return (
    <aside className="sidebar" aria-label="Terminal tabs">
      <div className="sidebar-top">
        <div
          className="sidebar-head"
          data-tauri-drag-region
          onMouseDown={onWindowDragMouseDown}
        >
          <h2>Terminals</h2>
          <div className="sidebar-head-actions">
            <button
              type="button"
              className="sidebar-add-icon-btn sidebar-add-icon-btn-sm sidebar-search-btn"
              onClick={() => {
                if (sidebarFilterOpen) {
                  setQuery("");
                  setSidebarFilterOpen(false);
                } else {
                  setSidebarFilterOpen(true);
                }
              }}
              aria-expanded={sidebarFilterOpen}
              aria-label={
                sidebarFilterOpen ? "Clear search and hide filter" : "Show profile filter"
              }
              title={sidebarFilterOpen ? "Clear and close filter" : "Filter profiles"}
            >
              {sidebarFilterOpen ? <SidebarCloseFilterIcon /> : <SidebarSearchIcon />}
            </button>
            <button
              type="button"
              className="sidebar-add-icon-btn sidebar-add-icon-btn-sm sidebar-stop-all-btn"
              onClick={onStopAll}
              aria-label="Stop all running terminals"
              title="Stop all"
            >
              <StopSquareIcon />
            </button>
            <button
              type="button"
              className="sidebar-add-icon-btn sidebar-add-icon-btn-sm sidebar-new-terminal-btn"
              onClick={openCreateModal}
              aria-label="New terminal"
              title="New terminal (⌘T, ⌘=)"
            >
              <NewTerminalIcon />
            </button>
          </div>
        </div>
        <div className="sidebar-chip-slot">
          {sidebarFilterOpen ? (
            <div className="sidebar-profile-filter" role="search" aria-label="Filter profiles">
              <input
                ref={sidebarFilterInputRef as LegacyRef<HTMLInputElement>}
                id="search-profiles"
                type="search"
                placeholder="Filter profiles…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setQuery("");
                    setSidebarFilterOpen(false);
                  }
                }}
                data-tauri-drag-region="false"
              />
            </div>
          ) : null}
        </div>
      </div>
      <div className="profile-list">
        {searchActive ? (
          // Flat deduped result list. Pills are always shown here so the row
          // still tells the user which tag contexts each match belongs to.
          <div role="tablist" aria-label="Search results">
            {searchResults.map((p) => renderProfileRow(p, { showTagPills: true }))}
          </div>
        ) : (
          <ProfileTree
            profiles={profiles}
            allTags={allTags}
            selectedId={selectedId}
            resolvedTheme={resolvedTheme}
            expanded={expandedTagFolders}
            setExpanded={setExpandedTagFolders}
            renderProfileRow={renderProfileRow}
            onOpenTagMenu={onOpenTagMenu}
            tagMenuOpenForTag={tagMenuOpenForTag}
          />
        )}
        {(searchActive ? searchResults : profiles).length === 0 ? (
          <div className="sidebar-add-inline" role="presentation">
            <button
              type="button"
              className="sidebar-add-icon-btn"
              onClick={openCreateModal}
              aria-label="New terminal"
              title="New terminal (⌘T, ⌘=)"
            >
              <NewTerminalIcon />
            </button>
          </div>
        ) : null}
      </div>
      {/*
       * App-level controls live here — separate from the top header which
       * carries list operations (filter / Stop all / New). Mirrors the
       * VSCode / Slack / Discord / Mail.app pattern: settings always at the
       * bottom-left of the sidebar.
       */}
      <div className="sidebar-foot">
        <button
          type="button"
          className="sidebar-foot-btn"
          onClick={onOpenSettings}
          aria-label="Open settings"
          title="Settings (⌘,)"
        >
          <SettingsGearIcon />
        </button>
      </div>
    </aside>
  );
}
