import { useMemo } from "react";
import type { ReactNode } from "react";
import type { GlobalSettings, ResolvedTheme } from "../../settings/global-settings";
import type { ProfileDto } from "../../types/profile";
import { EmptyStateTerminalIcon } from "../profile-icons";
import { ProfileTerminalSession } from "./profile-terminal-session";

export function TerminalWorkArea({
  profiles,
  selectedId,
  openedProfileIds,
  shellEnsured,
  bridgeReady,
  wsGenerationByProfile,
  resolvedTheme,
  terminalSettings,
  onTerminalBridgeOpen,
  onPtyOutput,
  registerTerminalClearHandler,
}: {
  profiles: ProfileDto[];
  selectedId: string | null;
  openedProfileIds: string[];
  shellEnsured: Record<string, boolean>;
  bridgeReady: Record<string, boolean>;
  wsGenerationByProfile: Record<string, number>;
  resolvedTheme: ResolvedTheme;
  terminalSettings: GlobalSettings["terminal"];
  onTerminalBridgeOpen: (profileId: string) => void;
  onPtyOutput: (profileId: string) => void;
  registerTerminalClearHandler: (profileId: string, handler: (() => void) | null) => void;
}) {
  const mountedIds = useMemo(
    () => openedProfileIds.filter((id) => profiles.some((p) => p.id === id)),
    [profiles, openedProfileIds],
  );

  const mountedShellIds = useMemo(
    () => mountedIds.filter((id) => shellEnsured[id]),
    [mountedIds, shellEnsured],
  );

  // When `coverMessage` is a ReactNode the cover is rendered. The
  // no-selection branch returns a layered empty-state (glyph + headline +
  // body + hint); transient state branches stay as plain strings so they
  // keep the original short-message look.
  const coverMessage: ReactNode | null = useMemo(() => {
    if (!selectedId) {
      return (
        <div className="terminal-empty-state">
          <div className="terminal-empty-state__glyph" aria-hidden="true">
            <EmptyStateTerminalIcon />
          </div>
          <div className="terminal-empty-state__headline">No terminal selected</div>
          <div className="terminal-empty-state__body">
            Pick a tab on the left, or create a new one.
          </div>
          <div className="terminal-empty-state__hint">
            Each profile is an interactive shell — press Start to run its saved command.
          </div>
        </div>
      );
    }
    const sel = profiles.find((p) => p.id === selectedId);
    if (!sel) {
      return "This profile is no longer in the list (for example after reloading terminals.yaml from disk). Pick another tab or create a new terminal.";
    }
    if (!shellEnsured[selectedId]) {
      return "Starting shell…";
    }
    if (!bridgeReady[selectedId]) {
      return "Connecting…";
    }
    return null;
  }, [profiles, selectedId, shellEnsured, bridgeReady]);

  const foregroundLayerId = useMemo(() => {
    if (!selectedId || !mountedShellIds.includes(selectedId)) return null;
    return selectedId;
  }, [mountedShellIds, selectedId]);

  return (
    <div className="terminal-stack">
      <div className="terminal-stack-layers">
        {mountedShellIds.map((id) => (
          <div
            key={id}
            className={`terminal-layer${foregroundLayerId === id ? "" : " terminal-layer-back"}`}
          >
            <ProfileTerminalSession
              profileId={id}
              isForeground={foregroundLayerId === id}
              wsGeneration={wsGenerationByProfile[id] ?? 0}
              resolvedTheme={resolvedTheme}
              terminalSettings={terminalSettings}
              onBridgeOpen={onTerminalBridgeOpen}
              onPtyOutput={onPtyOutput}
              registerTerminalClearHandler={registerTerminalClearHandler}
            />
          </div>
        ))}
      </div>
      {coverMessage !== null ? (
        <div className="terminal-cover" role="status">
          <div className="empty-terminal terminal-cover-msg">{coverMessage}</div>
        </div>
      ) : null}
    </div>
  );
}
