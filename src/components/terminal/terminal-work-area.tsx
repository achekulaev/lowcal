import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { TERMINAL_FIRST_REVEAL_HOLD_MS } from "../../constants/terminal-ui";
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

  /**
   * First time a PTY-backed layer mounts (`mountedShellIds`) for a profile — wall-clock horizon for
   * the post-bridge **Initializing terminal…** cover. Returning to an old tab skips once `now` has
   * passed that horizon (deadline keyed on PTY-shell mount).
   *
   * **Skip the hold** when (a) WS became ready while that tab was hidden (inactive bridge), e.g.
   * another tab foreground; or when (b) the profile has **Prepare terminal when the app opens**
   * (`warmOnStart` / `warm_on_start`) so the shell was warmed at launch rather than lazily when first
   * focused.
   */
  const firstRevealHoldUntilMsRef = useRef<Record<string, number>>({});
  /** Bridge flipped to ready while `selectedId` was another profile → xterm is already live before first focus → skip Initializing overlay. */
  const bridgeReadyWhileInactiveProfileIdsRef = useRef<Set<string>>(new Set());
  const prevBridgeReadyRef = useRef<Record<string, boolean>>({});
  const [revealHoldTick, setRevealHoldTick] = useState(0);
  const mountedShellFingerprint = useMemo(
    () => mountedShellIds.slice().sort().join("\0"),
    [mountedShellIds],
  );

  useEffect(() => {
    const valid = new Set(mountedShellIds);
    const map = firstRevealHoldUntilMsRef.current;
    for (const k of Object.keys(map)) {
      if (!valid.has(k)) delete map[k];
    }
    const prewarmed = bridgeReadyWhileInactiveProfileIdsRef.current;
    for (const k of [...prewarmed]) {
      if (!valid.has(k)) prewarmed.delete(k);
    }
  }, [mountedShellFingerprint]);

  useEffect(() => {
    const prev = prevBridgeReadyRef.current;
    const sel = selectedId;
    for (const id of mountedShellIds) {
      const was = !!prev[id];
      const now = !!bridgeReady[id];
      if (now && !was && sel !== id) {
        bridgeReadyWhileInactiveProfileIdsRef.current.add(id);
      }
    }
    prevBridgeReadyRef.current = { ...bridgeReady };
  }, [bridgeReady, selectedId, mountedShellFingerprint]);

  useEffect(() => {
    const now = Date.now();
    for (const id of mountedShellIds) {
      if (firstRevealHoldUntilMsRef.current[id] != null) continue;
      const until = now + TERMINAL_FIRST_REVEAL_HOLD_MS;
      firstRevealHoldUntilMsRef.current[id] = until;
      window.setTimeout(
        () => setRevealHoldTick((t) => t + 1),
        Math.max(0, until - Date.now()) + 10,
      );
    }
  }, [mountedShellFingerprint]);

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
    /** Profile checkbox: Prepare terminal when the app opens (`warm_on_start`). */
    if (sel.warmOnStart) {
      return null;
    }
    if (bridgeReadyWhileInactiveProfileIdsRef.current.has(selectedId)) {
      return null;
    }
    const holdUntil = firstRevealHoldUntilMsRef.current[selectedId];
    if (holdUntil != null && Date.now() < holdUntil) {
      return "Initializing terminal…";
    }
    return null;
  }, [profiles, selectedId, shellEnsured, bridgeReady, revealHoldTick]);

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
