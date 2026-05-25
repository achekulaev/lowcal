import {
  CwdFolderIcon,
  OverflowMenuIcon,
  RestartLoopIcon,
  SidebarTabRunIcon,
  StartPendingSpinner,
} from "../profile-icons";
import { ShellCommandSnippet } from "../shell-command-snippet";
import type { ProfileDto } from "../../types/profile";
import type { ProfileContextMenuState } from "../../types/ui";
import { cwdPathForUi } from "../../utils/cwd-display";
import { onWindowDragMouseDown } from "../../utils/window-drag";

export function TerminalStageHeader(props: {
  selected: ProfileDto | null;
  resolvedCwdAbsolute: string | null;
  /** From `user_home_directory`; used to show `~/…` in the header when the path is under home. */
  homeDirAbsolute: string | null;
  startSpinHold: Record<string, true>;
  stopSpinHold: Record<string, true>;
  /** True when the global profile context menu is open for the currently selected profile. */
  profileMenuOpenForSelected: boolean;
  setProfileMenu: (state: ProfileContextMenuState | null) => void;
  startProfileFromUi: (id: string) => void;
  stopProfileFromUi: (id: string) => void;
  restartRunningProfile: (id: string) => void;
}) {
  const {
    selected,
    resolvedCwdAbsolute,
    homeDirAbsolute,
    startSpinHold,
    stopSpinHold,
    profileMenuOpenForSelected,
    setProfileMenu,
    startProfileFromUi,
    stopProfileFromUi,
    restartRunningProfile,
  } = props;

  const startPending = !!(selected && startSpinHold[selected.id]);
  const stopPending = !!(selected && stopSpinHold[selected.id]);
  // Pending takes precedence over the live status so the spinner is actually
  // visible during the transition (the backend flips `command_running`
  // synchronously, so without this gate the button would unmount immediately).
  const showStopVariant =
    !!selected && (stopPending || (selected.status === "running" && !startPending));

  const cwdRaw = selected?.cwd?.trim() ?? "";
  const cwdUnset = !cwdRaw;
  const pathSource = cwdUnset ? "" : (resolvedCwdAbsolute ?? cwdRaw);
  const cwdDisplay = cwdUnset ? "" : cwdPathForUi(pathSource, homeDirAbsolute);
  const cwdTitle = cwdUnset ? undefined : resolvedCwdAbsolute ?? cwdRaw;

  return (
    <header
      className={`terminal-stage-header${selected ? "" : " terminal-stage-header--empty"}`}
    >
      {/*
       * Coachmark for the empty state — `← Add a new terminal` aligned with
       * the sidebar's `+` button in the same `.sidebar-head` primary row (both
       * use `--main-header-pad-y/x` + `--main-header-primary-row-min-height`,
       * so positioning inside the header padding lines them up across the
       * splitter without absolute magic numbers). Decorative only — the
       * actionable target is the `+` button itself; `pointer-events: none`
       * keeps the surrounding placeholder draggable for window moves, and
       * the body cover's existing "create a new one" copy carries the
       * accessibility load (`aria-hidden` here).
       */}
      {!selected ? (
        <div className="terminal-stage-add-hint" aria-hidden="true">
          <span className="terminal-stage-add-hint__arrow">←</span>
          <span>Add a new terminal</span>
        </div>
      ) : null}
      <div className="terminal-stage-head-main">
        {selected ? (
          <>
            <div
              className="terminal-stage-top-row"
              data-tauri-drag-region
              onMouseDown={onWindowDragMouseDown}
            >
              <div className="terminal-stage-title-line">
                <span className="terminal-stage-name">{selected.displayName}</span>
                {cwdUnset ? (
                  <span className="terminal-stage-cwd terminal-stage-cwd--unset">
                    no working directory set — inherits default from process
                  </span>
                ) : null}
              </div>
              {!cwdUnset ? (
                <span
                  className="terminal-stage-cwd terminal-stage-cwd--with-path terminal-stage-cwd--top-end"
                  title={cwdTitle}
                >
                  <CwdFolderIcon />
                  <span className="terminal-stage-cwd-path">{cwdDisplay}</span>
                </span>
              ) : null}
              <button
                type="button"
                className="terminal-action-icon-btn terminal-action-icon-btn--overflow"
                aria-label="Profile actions"
                aria-haspopup="menu"
                aria-expanded={profileMenuOpenForSelected}
                title="Profile actions"
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  if (profileMenuOpenForSelected) {
                    setProfileMenu(null);
                    return;
                  }
                  const r = e.currentTarget.getBoundingClientRect();
                  setProfileMenu({
                    clientX: r.left,
                    clientY: r.bottom + 6,
                    profileId: selected.id,
                  });
                }}
              >
                <OverflowMenuIcon />
              </button>
            </div>
            <div className="terminal-stage-cmd-line">
              <div className="terminal-actions">
                {!showStopVariant ? (
                  <button
                    type="button"
                    className={`terminal-action-icon-btn terminal-action-icon-btn--start${startPending ? " pending" : ""}`}
                    disabled={startPending}
                    aria-busy={startPending}
                    aria-label={
                      startPending ? "Starting saved command" : "Start saved command"
                    }
                    title={startPending ? "Starting…" : "Start saved command"}
                    onClick={() => startProfileFromUi(selected.id)}
                  >
                    {startPending ? (
                      <StartPendingSpinner />
                    ) : (
                      <SidebarTabRunIcon running={false} />
                    )}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className={`terminal-action-icon-btn terminal-action-icon-btn--stop${stopPending ? " pending" : ""}`}
                      disabled={stopPending}
                      aria-busy={stopPending}
                      aria-label={stopPending ? "Stopping saved command" : `Stop ${selected.displayName}`}
                      title={stopPending ? "Stopping…" : "Stop"}
                      onClick={() => stopProfileFromUi(selected.id)}
                    >
                      {stopPending ? (
                        <StartPendingSpinner />
                      ) : (
                        <SidebarTabRunIcon running />
                      )}
                    </button>
                    <button
                      type="button"
                      className="terminal-action-icon-btn terminal-action-icon-btn--restart"
                      disabled={stopPending}
                      aria-label={`Restart ${selected.displayName}`}
                      title="Restart"
                      onClick={() => restartRunningProfile(selected.id)}
                    >
                      <RestartLoopIcon />
                    </button>
                  </>
                )}
              </div>
              <ShellCommandSnippet command={selected.command} />
            </div>
          </>
        ) : (
          // Empty (no-selection) header: structurally identical to the
          // populated stack so the bottom border under the splitter stays
          // aligned and the drag region fills the full top strip, but with
          // no text content — the canonical empty-state message lives in
          // the body cover (`terminal-work-area.tsx`). aria-hidden because
          // there is nothing meaningful to announce here.
          <span
            className="terminal-stage-placeholder"
            data-tauri-drag-region
            onMouseDown={onWindowDragMouseDown}
            aria-hidden="true"
          />
        )}
      </div>
    </header>
  );
}
