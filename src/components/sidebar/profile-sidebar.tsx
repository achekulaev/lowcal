import { tagPillStyle } from "../../utils/tag-pills";
import {
  SidebarTabRunIcon,
  StartPendingSpinner,
  NewTerminalIcon,
  SidebarSearchIcon,
  SidebarCloseFilterIcon,
  SidebarTagFilterIcon,
} from "../profile-icons";
import type { ProfileDto } from "../../types/profile";
import { PTY_OUTPUT_ACTIVITY_MS } from "../../constants/terminal-ui";
import type { LegacyRef, MutableRefObject, RefObject } from "react";

function ProfileTabRow(props: {
  profile: ProfileDto;
  selected: boolean;
  tagFilter: string | null;
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
          <div className="tags-inline">
            {p.tags.length > 0 ? (
              p.tags.map((t) => (
                <span
                  key={t}
                  className="tag-pill tag-pill--hue"
                  style={tagPillStyle(t, props.tagFilter !== null && props.tagFilter === t)}
                >
                  {t}
                </span>
              ))
            ) : (
              <span className="tag-pill tag-pill--placeholder">no tag</span>
            )}
          </div>
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
  filtered: ProfileDto[];
  selectedId: string | null;
  setSelectedId: (id: string) => void;
  setProfileMenu: (s: { clientX: number; clientY: number; profileId: string }) => void;
  openCreateModal: () => void;
  toggleProfileRun: (p: ProfileDto) => void;
  startSpinHold: Record<string, true>;
  stopSpinHold: Record<string, true>;
  ptyOutputActivityTick: number;
  lastPtyOutputMsRef: MutableRefObject<Record<string, number>>;
  tagFilter: string | null;
  tagToolbarOpen: boolean;
  onToggleTagToolbar: () => void;
}) {
  const {
    query,
    setQuery,
    sidebarFilterOpen,
    setSidebarFilterOpen,
    sidebarFilterInputRef,
    filtered,
    selectedId,
    setSelectedId,
    setProfileMenu,
    openCreateModal,
    toggleProfileRun,
    startSpinHold,
    stopSpinHold,
    ptyOutputActivityTick,
    lastPtyOutputMsRef,
    tagFilter,
    tagToolbarOpen,
    onToggleTagToolbar,
  } = props;

  return (
    <aside className="sidebar" aria-label="Terminal tabs">
      <div className="sidebar-top">
        <div className="sidebar-head">
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
              className={`sidebar-add-icon-btn sidebar-add-icon-btn-sm${tagToolbarOpen ? " sidebar-tag-toolbar-active" : ""}`}
              onClick={onToggleTagToolbar}
              aria-pressed={tagToolbarOpen}
              aria-label={
                tagToolbarOpen ? "Close tag toolbar and reset tag filter" : "Tag filter and bulk actions"
              }
              title={tagToolbarOpen ? "Close tag toolbar" : "Filter by tag"}
            >
              <SidebarTagFilterIcon />
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
              />
            </div>
          ) : null}
        </div>
      </div>
      <div className="profile-list">
        <div role="tablist" aria-label="Open terminal profiles">
          {filtered.map((p) => {
            void ptyOutputActivityTick;
            const tOut = lastPtyOutputMsRef.current[p.id];
            const ptyOutputRecent =
              tOut != null && Date.now() - tOut < PTY_OUTPUT_ACTIVITY_MS;
            const startBusy = Boolean(startSpinHold[p.id]);
            const stopBusy = Boolean(stopSpinHold[p.id]);
            return (
              <ProfileTabRow
                key={p.id}
                profile={p}
                selected={selectedId === p.id}
                tagFilter={tagFilter}
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
          })}
        </div>
        {filtered.length === 0 ? (
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
    </aside>
  );
}
