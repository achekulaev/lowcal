import { useMemo } from "react";
import type { ProfileDto } from "../../types/profile";
import { ProfileTerminalSession } from "./profile-terminal-session";

export function TerminalWorkArea({
  profiles,
  selectedId,
  openedProfileIds,
  shellEnsured,
  bridgeReady,
  wsGenerationByProfile,
  onTerminalBridgeOpen,
  onPtyOutput,
}: {
  profiles: ProfileDto[];
  selectedId: string | null;
  openedProfileIds: string[];
  shellEnsured: Record<string, boolean>;
  bridgeReady: Record<string, boolean>;
  wsGenerationByProfile: Record<string, number>;
  onTerminalBridgeOpen: (profileId: string) => void;
  onPtyOutput: (profileId: string) => void;
}) {
  const mountedIds = useMemo(
    () => openedProfileIds.filter((id) => profiles.some((p) => p.id === id)),
    [profiles, openedProfileIds],
  );

  const mountedShellIds = useMemo(
    () => mountedIds.filter((id) => shellEnsured[id]),
    [mountedIds, shellEnsured],
  );

  const coverMessage = useMemo(() => {
    if (!selectedId) {
      return "Pick a terminal tab on the left, or use New terminal. Each profile is an interactive shell; use Start to run the saved command.";
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
              onBridgeOpen={onTerminalBridgeOpen}
              onPtyOutput={onPtyOutput}
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
