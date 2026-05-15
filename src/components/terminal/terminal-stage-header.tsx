import { invoke } from "@tauri-apps/api/core";
import { ShellCommandSnippet } from "../shell-command-snippet";
import {
  EditProfileIcon,
  RestartLoopIcon,
  SidebarTabRunIcon,
  StartPendingSpinner,
} from "../profile-icons";
import type { ProfileDto } from "../../types/profile";

export function TerminalStageHeader(props: {
  selected: ProfileDto | null;
  resolvedCwdAbsolute: string | null;
  startSpinHold: Record<string, true>;
  openEditModal: (p: ProfileDto) => void;
  startProfileFromUi: (id: string) => void;
  run: (fn: () => Promise<void>) => Promise<void>;
}) {
  const {
    selected,
    resolvedCwdAbsolute,
    startSpinHold,
    openEditModal,
    startProfileFromUi,
    run,
  } = props;

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
          {selected.status !== "running" ? (
            <button
              type="button"
              className={`terminal-action-icon-btn terminal-action-icon-btn--start${startSpinHold[selected.id] ? " pending" : ""}`}
              disabled={!!startSpinHold[selected.id]}
              aria-busy={!!startSpinHold[selected.id]}
              aria-label={
                startSpinHold[selected.id]
                  ? "Starting saved command"
                  : "Start saved command"
              }
              title={startSpinHold[selected.id] ? "Starting…" : "Start saved command"}
              onClick={() => startProfileFromUi(selected.id)}
            >
              {startSpinHold[selected.id] ? (
                <StartPendingSpinner />
              ) : (
                <SidebarTabRunIcon running={false} />
              )}
            </button>
          ) : null}
          {selected.status === "running" ? (
            <>
              <button
                type="button"
                className="terminal-action-icon-btn terminal-action-icon-btn--stop"
                aria-label={`Stop ${selected.displayName}`}
                title="Stop"
                onClick={() =>
                  run(() => invoke("stop_profile", { id: selected.id }))
                }
              >
                <SidebarTabRunIcon running />
              </button>
              <button
                type="button"
                className="terminal-action-icon-btn terminal-action-icon-btn--restart"
                aria-label={`Restart ${selected.displayName}`}
                title="Restart"
                onClick={() =>
                  run(() => invoke("restart_profile", { id: selected.id }))
                }
              >
                <RestartLoopIcon />
              </button>
            </>
          ) : null}
        </div>
      )}
    </header>
  );
}
