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

  /**
   * Track which profiles have already been auto-initialized on this app session so
   * the effect below doesn't re-fire on subsequent `profiles` or `bridgeReady` updates.
   * `startCommandOnAppOpen` → call `start_profile` once the bridge is live.
   * `warmOnStart`           → call `ensure_shell_session` once the bridge is live
   *                           (the PTY is already mounted; this is a no-op if the
   *                           shell spawned during mount, but ensures it's up).
   *
   * We intentionally don't reset this ref on config-file reload because the watcher
   * destroys all sessions first, then re-emits profiles — the profile rows will
   * disappear briefly and re-appear as new entries, which clears their `bridgeReady`
   * state, so they'll naturally re-trigger the effect when the bridge reconnects.
   */
  const autoInitDoneRef = useRef<Set<string>>(new Set());

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

  /**
   * Auto-init effect: replaces the old Rust-side `apply_startup_profile_actions`.
   *
   * Phase 1 (runs whenever profiles change): add `warmOnStart` and
   * `startCommandOnAppOpen` profiles to the opened set so their xterm layer
   * mounts and the WebSocket bridge connects. Also call `ensure_shell_session`
   * immediately — the PTY needs to exist before the bridge can subscribe.
   *
   * Phase 2 (runs whenever bridgeReady changes): once a profile's WS bridge is
   * live (xterm is subscribed and listening), fire the actual command:
   *   - `startCommandOnAppOpen` → `start_profile` (equivalent to pressing Start)
   *   - `warmOnStart`           → nothing extra; shell is already ensured above
   *
   * Using `bridgeReady` as the gate means the inject only happens after xterm
   * has an active WS subscription, so all PTY output — including the injected
   * command's echo — is seen by xterm from the very first byte.
   */
  useEffect(() => {
    const autoInitProfiles = profiles.filter(
      (p) => p.startCommandOnAppOpen || p.warmOnStart,
    );
    if (autoInitProfiles.length === 0) return;

    // Phase 1: mount xterm + connect WS for auto-init profiles.
    setOpenedProfileIds((prev) => {
      const additions = autoInitProfiles.map((p) => p.id).filter((id) => !prev.includes(id));
      return additions.length === 0 ? prev : [...prev, ...additions];
    });
    for (const p of autoInitProfiles) {
      void invoke("ensure_shell_session", { id: p.id })
        .then(() => {
          setShellEnsured((prev) => ({ ...prev, [p.id]: true }));
        })
        .catch((e) => {
          console.error("auto-init ensure_shell_session failed", p.id, e);
        });
    }

    // Phase 2: once bridge is live, invoke start_profile for startCommandOnAppOpen.
    for (const p of autoInitProfiles) {
      if (!p.startCommandOnAppOpen) continue;
      if (autoInitDoneRef.current.has(p.id)) continue;
      if (!bridgeReady[p.id]) continue;

      autoInitDoneRef.current.add(p.id);
      void invoke("start_profile", { id: p.id }).catch((e) => {
        console.error("auto-init start_profile failed", p.id, e);
      });
    }
  }, [profiles, bridgeReady]);

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
    // When a profile disappears (config reload / delete), clear its auto-init
    // record so it will re-trigger when the profile returns.
    for (const k of [...autoInitDoneRef.current]) {
      if (!valid.has(k)) autoInitDoneRef.current.delete(k);
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
