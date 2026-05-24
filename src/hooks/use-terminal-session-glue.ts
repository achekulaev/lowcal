import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProfileDto } from "../types/profile";
import { notifyUserError } from "../utils/errors";

/**
 * Shell ensure, opened tabs, WebSocket generations, PTY activity ticks for sidebar ring.
 * Mirrors the effect graph previously inline in App — see `.cursor/decisions/terminal-profile-launch-and-start.md`.
 */
export function useTerminalSessionGlue(profiles: ProfileDto[], selectedId: string | null) {
  const [openedProfileIds, setOpenedProfileIds] = useState<string[]>([]);
  const [shellEnsured, setShellEnsured] = useState<Record<string, boolean>>({});
  const [bridgeReady, setBridgeReady] = useState<Record<string, boolean>>({});
  const [wsGenerationByProfile, setWsGenerationByProfile] = useState<Record<string, number>>({});
  const lastPtyOutputMsRef = useRef<Record<string, number>>({});
  const [ptyOutputActivityTick, setPtyOutputActivityTick] = useState(0);
  const ptyActivityBumpRafRef = useRef<number | null>(null);
  /** Synchronous clears before REST restart — avoids a render behind incoming PTY output. */
  const terminalClearHandlersRef = useRef(new Map<string, () => void>());

  const registerTerminalClearHandler = useCallback(
    (profileId: string, handler: (() => void) | null) => {
      const m = terminalClearHandlersRef.current;
      if (handler === null) {
        m.delete(profileId);
      } else {
        m.set(profileId, handler);
      }
    },
    [],
  );

  const clearTerminalBuffersForProfiles = useCallback((profileIds: readonly string[]) => {
    const m = terminalClearHandlersRef.current;
    for (const id of profileIds) {
      m.get(id)?.();
    }
  }, []);

  const onTerminalBridgeOpen = useCallback((id: string) => {
    setBridgeReady((p) => ({ ...p, [id]: true }));
  }, []);

  const notePtyOutput = useCallback((id: string) => {
    lastPtyOutputMsRef.current[id] = Date.now();
    if (ptyActivityBumpRafRef.current != null) return;
    ptyActivityBumpRafRef.current = requestAnimationFrame(() => {
      ptyActivityBumpRafRef.current = null;
      setPtyOutputActivityTick((n) => n + 1);
    });
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      setPtyOutputActivityTick((n) => n + 1);
    }, 100);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    return () => {
      if (ptyActivityBumpRafRef.current != null) {
        cancelAnimationFrame(ptyActivityBumpRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setOpenedProfileIds((prev) =>
      prev.includes(selectedId) ? prev : [...prev, selectedId],
    );

    void invoke("ensure_shell_session", { id: selectedId })
      .then(() => {
        if (!cancelled) {
          setShellEnsured((p) => ({ ...p, [selectedId]: true }));
        }
      })
      .catch((e) => {
        if (!cancelled) void notifyUserError(e);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => {
    const runningIds = profiles.filter((p) => p.status === "running").map((p) => p.id);
    if (runningIds.length === 0) return;

    setOpenedProfileIds((prev) => {
      const additions = runningIds.filter((id) => !prev.includes(id));
      return additions.length === 0 ? prev : [...prev, ...additions];
    });

    for (const id of runningIds) {
      void invoke("ensure_shell_session", { id })
        .then(() => {
          setShellEnsured((p) => ({ ...p, [id]: true }));
        })
        .catch((e) => {
          console.error(e);
          void notifyUserError(e);
        });
    }
  }, [profiles]);

  useEffect(() => {
    const valid = new Set(profiles.map((p) => p.id));
    setOpenedProfileIds((prev) => prev.filter((id) => valid.has(id)));
    setShellEnsured((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        if (!valid.has(k)) delete next[k];
      }
      return next;
    });
    setBridgeReady((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        if (!valid.has(k)) delete next[k];
      }
      return next;
    });
    setWsGenerationByProfile((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        if (!valid.has(k)) delete next[k];
      }
      return next;
    });
    const outMs = lastPtyOutputMsRef.current;
    for (const k of Object.keys(outMs)) {
      if (!valid.has(k)) delete outMs[k];
    }
  }, [profiles]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<{ profileId: string }>("session-ended", (ev) => {
      const id = ev.payload.profileId;
      setBridgeReady((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      void invoke("ensure_shell_session", { id })
        .then(() => {
          setShellEnsured((p) => ({ ...p, [id]: true }));
          setWsGenerationByProfile((g) => ({ ...g, [id]: (g[id] ?? 0) + 1 }));
        })
        .catch((e) => {
          console.error(e);
          void notifyUserError(e);
        });
    }).then((u) => {
      unlisten = u;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  return {
    openedProfileIds,
    shellEnsured,
    bridgeReady,
    wsGenerationByProfile,
    lastPtyOutputMsRef,
    ptyOutputActivityTick,
    onTerminalBridgeOpen,
    notePtyOutput,
    registerTerminalClearHandler,
    clearTerminalBuffersForProfiles,
  };
}
