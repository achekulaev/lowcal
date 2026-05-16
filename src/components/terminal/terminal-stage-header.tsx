import {
  EditProfileIcon,
  RestartLoopIcon,
  SidebarTabRunIcon,
  StartPendingSpinner,
} from "../profile-icons";
import { ShellCommandSnippet } from "../shell-command-snippet";
import type { ProfileDto } from "../../types/profile";

export function TerminalStageHeader(props: {
  selected: ProfileDto | null;
  resolvedCwdAbsolute: string | null;
  startSpinHold: Record<string, true>;
  stopSpinHold: Record<string, true>;
  openEditModal: (p: ProfileDto) => void;
  startProfileFromUi: (id: string) => void;
  stopProfileFromUi: (id: string) => void;
  restartRunningProfile: (id: string) => void;
}) {
  const {
    selected,
    resolvedCwdAbsolute,
    startSpinHold,
    stopSpinHold,
    openEditModal,
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

  return (
    <header className="terminal-stage-header">
      <div className="terminal-stage-head-main">
        {selected ? (
          <>
            <div className="terminal-stage-title-line">
              <span className="terminal-stage-name">{selected.displayName}</span>
              <span className="terminal-stage-cwd" title="Resolved working directory for this profile">
                (
                {!selected.cwd?.trim()
                  ? "no working directory set — inherits default from process"
                  : resolvedCwdAbsolute ?? selected.cwd.trim()}
                )
              </span>
            </div>
            <ShellCommandSnippet command={selected.command} />
          </>
        ) : (
          <span className="terminal-stage-placeholder">No profile selected</span>
        )}
      </div>
      {selected && (
        <div className="terminal-actions">
          <button
            type="button"
            className="terminal-action-icon-btn terminal-action-icon-btn--edit"
            onClick={() => openEditModal(selected)}
            aria-label="Edit profile"
            title="Edit profile"
          >
            <EditProfileIcon />
          </button>
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
      )}
    </header>
  );
}
