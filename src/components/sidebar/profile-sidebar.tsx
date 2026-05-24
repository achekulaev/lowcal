import { useState } from "react";
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
  onStartTag: (tag: string) => void;
  onStopTag: (tag: string) => void;
  onRestartTag: (tag: string) => void;
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
    onStartTag,
    onStopTag,
    onRestartTag,
  } = props;

  // Owned by the sidebar (not the tree) so collapse state survives the
  // search/tree toggle — the tree unmounts while a query is active.
  const [expandedTagFolders, setExpandedTagFolders] = useState<Set<string>>(new Set());

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
          setSelectedId(p.id);
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
              className="sidebar-add-icon-btn sidebar-add-icon-btn-sm"
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
              className="sidebar-add-icon-btn sidebar-add-icon-btn-sm"
              onClick={openCreateModal}
              aria-label="New terminal"
              title="New terminal"
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
            onStartTag={onStartTag}
            onStopTag={onStopTag}
            onRestartTag={onRestartTag}
          />
        )}
        {(searchActive ? searchResults : profiles).length === 0 ? (
          <div className="sidebar-add-inline" role="presentation">
            <button
              type="button"
              className="sidebar-add-icon-btn"
              onClick={openCreateModal}
              aria-label="New terminal"
              title="New terminal"
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
