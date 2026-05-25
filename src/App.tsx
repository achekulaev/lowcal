import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppSettingsModal } from "./components/app-settings-modal";
import { ProfileContextMenu } from "./components/profile-context-menu";
import { ProfileEditorModal } from "./components/profile-editor-modal";
import { QuitConfirmModal } from "./components/quit-confirm-modal";
import { ProfileSidebar } from "./components/sidebar/profile-sidebar";
import { TerminalStageHeader } from "./components/terminal/terminal-stage-header";
import { TerminalWorkArea } from "./components/terminal/terminal-work-area";
import {
  START_SPIN_HOLD_MS,
  START_SPIN_MIN_VISIBLE_MS,
  STOP_SPIN_HOLD_MAX_MS,
  STOP_SPIN_MIN_VISIBLE_MS,
} from "./constants/terminal-ui";
import { useProfiles } from "./hooks/use-profiles";
import { useSidebarFilter } from "./hooks/use-sidebar-filter";
import { useTerminalSessionGlue } from "./hooks/use-terminal-session-glue";
import type { GlobalSettings } from "./settings/global-settings";
import { useAppearance } from "./settings/use-appearance";
import { useGlobalSettings } from "./settings/use-global-settings";
import type { ProfileDto, ProfileFormState } from "./types/profile";
import type { ModalMode, ProfileContextMenuState } from "./types/ui";
import { confirmDeleteProfile } from "./utils/delete-profile-dialog";
import { formatUserFacingError, notifyUserError } from "./utils/errors";
import {
  emptyForm,
  envRecordFromLines,
  formFromProfile,
  nextSelectedIdAfterDelete,
} from "./utils/profile-form";

/** When no tab is selected; matches startup title in `tauri.conf.json`. */
const MAIN_WINDOW_TITLE_IDLE = "Lowcal Terminal Orchestrator";

export default function App() {
  // Live app-wide settings (`<app_config_dir>/settings.yaml`, surfaced by the
  // gear button + Cmd+, hotkey). `appearance.theme` is fed straight into
  // `useAppearance` so flipping it from the settings modal re-themes the app
  // without a remount; `terminal.*` is threaded down to `TerminalWorkArea`.
  const { settings: globalSettings, updateSettings: updateGlobalSettings } = useGlobalSettings();
  const resolvedTheme = useAppearance(globalSettings.appearance.theme);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settingsModalSaving, setSettingsModalSaving] = useState(false);
  const [settingsModalError, setSettingsModalError] = useState<string | null>(null);
  // Running-profile names attached to a pending "quit?" prompt. Non-null
  // while the modal is open. Driven by the `confirm-quit` event from Rust;
  // see `emit_quit_confirmation` in `src-tauri/src/lib.rs`.
  const [quitConfirmRunning, setQuitConfirmRunning] = useState<string[] | null>(null);
  const { profiles, refresh } = useProfiles();
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const sidebarFilterApi = useSidebarFilter(modalMode);
  const { query, setQuery, sidebarFilterOpen, setSidebarFilterOpen, sidebarFilterInputRef } =
    sidebarFilterApi;

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const {
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
  } = useTerminalSessionGlue(profiles, selectedId);

  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<ProfileFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [profileMenu, setProfileMenu] = useState<ProfileContextMenuState | null>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  const startSpinHoldRef = useRef<Set<string>>(new Set());
  const startSpinTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const startSpinDeferTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const startSpinStartedAtRef = useRef<Record<string, number>>({});
  const [startSpinHold, setStartSpinHold] = useState<Record<string, true>>({});

  const stopSpinHoldRef = useRef<Set<string>>(new Set());
  const stopSpinTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const stopSpinDeferTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const stopSpinStartedAtRef = useRef<Record<string, number>>({});
  const [stopSpinHold, setStopSpinHold] = useState<Record<string, true>>({});

  useEffect(() => {
    return () => {
      for (const t of Object.values(startSpinTimersRef.current)) {
        clearTimeout(t);
      }
      for (const t of Object.values(startSpinDeferTimersRef.current)) {
        clearTimeout(t);
      }
      for (const t of Object.values(stopSpinTimersRef.current)) {
        clearTimeout(t);
      }
      for (const t of Object.values(stopSpinDeferTimersRef.current)) {
        clearTimeout(t);
      }
      startSpinTimersRef.current = {};
      startSpinDeferTimersRef.current = {};
      startSpinStartedAtRef.current = {};
      stopSpinTimersRef.current = {};
      stopSpinDeferTimersRef.current = {};
      stopSpinStartedAtRef.current = {};
      startSpinHoldRef.current.clear();
      stopSpinHoldRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (modalMode) setProfileMenu(null);
  }, [modalMode]);

  useEffect(() => {
    if (!profileMenu) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setProfileMenu(null);
    };

    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const el = profileMenuRef.current;
      const target = e.target;
      if (!el || !(target instanceof Node) || el.contains(target)) return;
      setProfileMenu(null);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [profileMenu]);

  useEffect(() => {
    if (profileMenu && !profiles.some((p) => p.id === profileMenu.profileId)) {
      setProfileMenu(null);
    }
  }, [profiles, profileMenu]);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    profiles.forEach((p) => p.tags.forEach((t) => s.add(t)));
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [profiles]);

  // Sidebar text search is now a *flat results mode*: while the query is
  // non-empty, the tag-folder tree is replaced with a deduped flat list (one
  // row per matching profile, even when it carries multiple tags). When the
  // query is empty, the tree renders and `searchResults` is unused. Haystack
  // matches the pre-tree behavior so existing muscle memory keeps working.
  const searchActive = query.trim().length > 0;
  const searchResults = useMemo(() => {
    if (!searchActive) return [];
    const q = query.trim().toLowerCase();
    return profiles.filter((p) => {
      const hay = `${p.displayName} ${p.id} ${p.command} ${p.tags.join(" ")}`.toLowerCase();
      return hay.includes(q);
    });
  }, [profiles, query, searchActive]);

  const menuTargetProfile = useMemo(() => {
    if (!profileMenu) return null;
    return profiles.find((p) => p.id === profileMenu.profileId) ?? null;
  }, [profiles, profileMenu]);

  const selected = profiles.find((p) => p.id === selectedId) ?? null;

  // Only update `document.title` — deliberately *not* `getCurrentWindow().setTitle(...)`.
  // On macOS, calling the native `setTitle` resets `trafficLightPosition` to default
  // (Tauri GitHub issue #13044), making the traffic lights jump out of alignment with the
  // sidebar header every time the user picks a different profile. Trade-off accepted: the
  // OS-level Cmd-Tab / Mission Control / Dock-menu surfaces show the startup window title
  // ("Lowcal Terminal Orchestrator" from `tauri.conf.json`) instead of the active profile
  // name. The in-window UI still displays the selected profile in the right-pane header.
  useEffect(() => {
    const title = selected ? `Lowcal · ${selected.displayName}` : MAIN_WINDOW_TITLE_IDLE;
    document.title = title;
  }, [selected?.displayName, selected?.id]);

  const [resolvedCwdAbsolute, setResolvedCwdAbsolute] = useState<string | null>(null);
  const [homeDirAbsolute, setHomeDirAbsolute] = useState<string | null>(null);

  useEffect(() => {
    void invoke<string | null>("user_home_directory").then(setHomeDirAbsolute).catch(() => {
      setHomeDirAbsolute(null);
    });
  }, []);

  useEffect(() => {
    setResolvedCwdAbsolute(null);
    const raw = selected?.cwd?.trim();
    if (!selected || !raw) return;

    let cancelled = false;
    void (async () => {
      try {
        const abs = await invoke<string | null>("resolve_working_directory", { raw });
        if (!cancelled) setResolvedCwdAbsolute(abs ?? raw);
      } catch {
        if (!cancelled) setResolvedCwdAbsolute(raw);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selected?.cwd, selected?.id]);

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
      await refresh();
    } catch (e) {
      console.error(e);
      void notifyUserError(e);
    }
  };

  const clearStartSpinHold = useCallback((id: string) => {
    const t = startSpinTimersRef.current[id];
    if (t !== undefined) {
      clearTimeout(t);
      delete startSpinTimersRef.current[id];
    }
    const dt = startSpinDeferTimersRef.current[id];
    if (dt !== undefined) {
      clearTimeout(dt);
      delete startSpinDeferTimersRef.current[id];
    }
    delete startSpinStartedAtRef.current[id];
    startSpinHoldRef.current.delete(id);
    setStartSpinHold((s) => {
      if (!s[id]) return s;
      const next = { ...s };
      delete next[id];
      return next;
    });
  }, []);

  // Honor a minimum perceptible window: if elapsed < min, defer the clear so the
  // spinner is actually visible. Idempotent — repeated calls collapse onto the
  // single deferred timer.
  const requestClearStartSpinHold = useCallback(
    (id: string) => {
      if (!startSpinHoldRef.current.has(id)) return;
      const startedAt = startSpinStartedAtRef.current[id];
      const elapsed = startedAt !== undefined ? Date.now() - startedAt : START_SPIN_MIN_VISIBLE_MS;
      if (elapsed >= START_SPIN_MIN_VISIBLE_MS) {
        clearStartSpinHold(id);
        return;
      }
      if (startSpinDeferTimersRef.current[id] !== undefined) return;
      startSpinDeferTimersRef.current[id] = window.setTimeout(() => {
        delete startSpinDeferTimersRef.current[id];
        clearStartSpinHold(id);
      }, START_SPIN_MIN_VISIBLE_MS - elapsed);
    },
    [clearStartSpinHold],
  );

  const beginStartSpinHold = useCallback(
    (id: string): boolean => {
      if (startSpinHoldRef.current.has(id)) return false;
      startSpinHoldRef.current.add(id);
      startSpinStartedAtRef.current[id] = Date.now();
      setStartSpinHold((s) => ({ ...s, [id]: true }));
      startSpinTimersRef.current[id] = window.setTimeout(
        () => clearStartSpinHold(id),
        START_SPIN_HOLD_MS,
      );
      return true;
    },
    [clearStartSpinHold],
  );

  const clearStopSpinHold = useCallback((id: string) => {
    const t = stopSpinTimersRef.current[id];
    if (t !== undefined) {
      clearTimeout(t);
      delete stopSpinTimersRef.current[id];
    }
    const dt = stopSpinDeferTimersRef.current[id];
    if (dt !== undefined) {
      clearTimeout(dt);
      delete stopSpinDeferTimersRef.current[id];
    }
    delete stopSpinStartedAtRef.current[id];
    stopSpinHoldRef.current.delete(id);
    setStopSpinHold((s) => {
      if (!s[id]) return s;
      const next = { ...s };
      delete next[id];
      return next;
    });
  }, []);

  const requestClearStopSpinHold = useCallback(
    (id: string) => {
      if (!stopSpinHoldRef.current.has(id)) return;
      const startedAt = stopSpinStartedAtRef.current[id];
      const elapsed = startedAt !== undefined ? Date.now() - startedAt : STOP_SPIN_MIN_VISIBLE_MS;
      if (elapsed >= STOP_SPIN_MIN_VISIBLE_MS) {
        clearStopSpinHold(id);
        return;
      }
      if (stopSpinDeferTimersRef.current[id] !== undefined) return;
      stopSpinDeferTimersRef.current[id] = window.setTimeout(() => {
        delete stopSpinDeferTimersRef.current[id];
        clearStopSpinHold(id);
      }, STOP_SPIN_MIN_VISIBLE_MS - elapsed);
    },
    [clearStopSpinHold],
  );

  const beginStopSpinHold = useCallback(
    (id: string): boolean => {
      if (stopSpinHoldRef.current.has(id)) return false;
      stopSpinHoldRef.current.add(id);
      stopSpinStartedAtRef.current[id] = Date.now();
      setStopSpinHold((s) => ({ ...s, [id]: true }));
      stopSpinTimersRef.current[id] = window.setTimeout(
        () => clearStopSpinHold(id),
        STOP_SPIN_HOLD_MAX_MS,
      );
      return true;
    },
    [clearStopSpinHold],
  );

  const stopProfileFromUi = useCallback(
    (id: string) => {
      if (!beginStopSpinHold(id)) return;
      void (async () => {
        try {
          await invoke("stop_profile", { id });
          await refresh();
        } catch (e) {
          console.error(e);
          void notifyUserError(e);
        } finally {
          requestClearStopSpinHold(id);
        }
      })();
    },
    [beginStopSpinHold, requestClearStopSpinHold, refresh],
  );

  const startProfileFromUi = useCallback(
    (id: string) => {
      if (!beginStartSpinHold(id)) return;
      void (async () => {
        try {
          await invoke("start_profile", { id });
          await refresh();
        } catch (e) {
          console.error(e);
          void notifyUserError(e);
        }
      })();
    },
    [beginStartSpinHold, refresh],
  );

  const restartRunningProfileFromUi = useCallback(
    (id: string) =>
      run(async () => {
        clearTerminalBuffersForProfiles([id]);
        await invoke("restart_profile", { id });
      }),
    [clearTerminalBuffersForProfiles, run],
  );

  const restartProfilesByTagFromUi = useCallback(
    async (tag: string) => {
      const ids = profiles
        .filter((p) => p.tags.some((t) => t === tag))
        .map((p) => p.id);
      clearTerminalBuffersForProfiles(ids);
      await invoke("restart_tag", { tag });
    },
    [clearTerminalBuffersForProfiles, profiles],
  );

  // Sidebar tag-folder bulk actions. Routed through `run` so refresh +
  // error toasting stay consistent with the per-profile Start/Stop path.
  // `run` is recreated every render (it closes over `refresh`); listing it
  // in deps keeps the captured reference fresh.
  const startTagFromSidebar = useCallback(
    (tag: string) => {
      void run(() => invoke("start_tag", { tag }));
    },
    [run],
  );

  const stopTagFromSidebar = useCallback(
    (tag: string) => {
      void run(() => invoke("stop_tag", { tag }));
    },
    [run],
  );

  const restartTagFromSidebar = useCallback(
    (tag: string) => {
      void run(() => restartProfilesByTagFromUi(tag));
    },
    [run, restartProfilesByTagFromUi],
  );

  const stopAllFromSidebar = useCallback(() => {
    void run(() => invoke("stop_all"));
  }, [run]);

  useEffect(() => {
    for (const p of profiles) {
      if (p.status === "running" && startSpinHoldRef.current.has(p.id)) {
        requestClearStartSpinHold(p.id);
      }
    }
  }, [profiles, requestClearStartSpinHold]);

  useEffect(() => {
    const valid = new Set(profiles.map((p) => p.id));
    for (const id of [...startSpinHoldRef.current]) {
      if (!valid.has(id)) clearStartSpinHold(id);
    }
  }, [profiles, clearStartSpinHold]);

  useEffect(() => {
    for (const p of profiles) {
      if (p.status !== "running" && stopSpinHoldRef.current.has(p.id)) {
        requestClearStopSpinHold(p.id);
      }
    }
  }, [profiles, requestClearStopSpinHold]);

  useEffect(() => {
    const valid = new Set(profiles.map((p) => p.id));
    for (const id of [...stopSpinHoldRef.current]) {
      if (!valid.has(id)) clearStopSpinHold(id);
    }
  }, [profiles, clearStopSpinHold]);

  const openCreateModal = useCallback(() => {
    setEditId(null);
    setForm(emptyForm());
    setModalError(null);
    setModalMode("create");
  }, []);

  const openEditModal = useCallback((p: ProfileDto) => {
    setEditId(p.id);
    setForm(formFromProfile(p));
    setModalError(null);
    setModalMode("edit");
  }, []);

  const openEditModalForSelected = useCallback(() => {
    if (!selectedId) return;
    const p = profiles.find((prof) => prof.id === selectedId);
    if (!p) return;
    openEditModal(p);
  }, [selectedId, profiles, openEditModal]);

  const closeModal = useCallback(() => {
    setModalMode(null);
    setEditId(null);
    setSaving(false);
    setModalError(null);
  }, []);

  const saveModal = async () => {
    setModalError(null);
    const nameTrim = form.displayName.trim();
    const cmdTrim = form.command.trim();
    if (!nameTrim || !cmdTrim) {
      setModalError("Display name and command are required.");
      return;
    }
    const tags = form.tags;
    const env = envRecordFromLines(form.envStr);
    const cwdTrim = form.cwd.trim();
    setSaving(true);
    try {
      if (modalMode === "create") {
        const created = await invoke<ProfileDto>("create_profile", {
          input: {
            displayName: nameTrim,
            command: cmdTrim,
            cwd: cwdTrim || null,
            tags,
            env,
            startCommandOnAppOpen: form.startCommandOnAppOpen,
          },
        });
        await refresh();
        setSelectedId(created.id);
      } else if (modalMode === "edit" && editId) {
        await invoke("update_profile", {
          payload: {
            id: editId,
            displayName: nameTrim,
            command: cmdTrim,
            cwd: cwdTrim || null,
            tags,
            env,
            startCommandOnAppOpen: form.startCommandOnAppOpen,
          },
        });
        await refresh();
      }
      closeModal();
    } catch (e) {
      console.error(e);
      setModalError(formatUserFacingError(e));
    } finally {
      setSaving(false);
    }
  };

  const saveModalRef = useRef(saveModal);
  saveModalRef.current = saveModal;

  useEffect(() => {
    if (!modalMode) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (saving) return;
      if (e.key === "Escape") {
        e.preventDefault();
        closeModal();
        return;
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void saveModalRef.current();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [modalMode, saving, closeModal]);

  const closeSettingsModal = useCallback(() => {
    setSettingsModalOpen(false);
    setSettingsModalSaving(false);
    setSettingsModalError(null);
  }, []);

  const saveAppSettings = useCallback(
    async (next: GlobalSettings) => {
      setSettingsModalError(null);
      setSettingsModalSaving(true);
      try {
        await updateGlobalSettings(next);
        closeSettingsModal();
      } catch (e) {
        setSettingsModalError(formatUserFacingError(e));
      } finally {
        setSettingsModalSaving(false);
      }
    },
    [closeSettingsModal, updateGlobalSettings],
  );

  // Cmd+T / Cmd+= (macOS) / Ctrl+T / Ctrl+= — open the "New terminal" profile
  // editor. Capture phase so it fires even when the xterm canvas has focus.
  // Suppressed while any modal is open.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (modalMode || settingsModalOpen || quitConfirmRunning !== null) return;

      const isNewTerminalKey =
        e.key === "t" ||
        e.key === "T" ||
        ((e.key === "=" || e.code === "Equal") && !e.shiftKey);
      if (!isNewTerminalKey) return;

      e.preventDefault();
      openCreateModal();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [modalMode, settingsModalOpen, quitConfirmRunning, openCreateModal]);

  // Cmd+E (macOS) / Ctrl+E — open the edit-profile modal for the selected
  // sidebar row. Capture phase so it fires even when the xterm canvas has
  // focus. Suppressed while any modal is open or nothing is selected.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key !== "e" && e.key !== "E") return;
      if (modalMode || settingsModalOpen || quitConfirmRunning !== null) return;
      if (!selectedId) return;
      const p = profiles.find((prof) => prof.id === selectedId);
      if (!p) return;

      e.preventDefault();
      openEditModal(p);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    modalMode,
    settingsModalOpen,
    quitConfirmRunning,
    selectedId,
    profiles,
    openEditModal,
  ]);

  // macOS menu — keep File → Edit Terminal disabled until a sidebar profile
  // is selected (and re-disable if the selected id disappears).
  useEffect(() => {
    const enabled =
      selectedId != null && profiles.some((p) => p.id === selectedId);
    void invoke("set_edit_terminal_menu_enabled", { enabled }).catch(() => {});
  }, [selectedId, profiles]);

  // Cmd+, (macOS) / Ctrl+, (other) — global toggle. Suppressed while the
  // profile editor modal is open so we don't pile a second dialog on top.
  // On macOS the native menu accelerator wins (the keystroke never reaches
  // the WebView) and the `open-settings` listener below is the path that
  // fires; this DOM listener is the cross-platform fallback for Linux /
  // Windows where there's no native app menu Preferences entry.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== ",") return;
      if (!(e.metaKey || e.ctrlKey)) return;
      if (modalMode) return;
      e.preventDefault();
      setSettingsModalOpen((prev) => !prev);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [modalMode]);

  // Tauri menu — `File → New Terminal` (or its Cmd+T accelerator) emits
  // `open-new-terminal` from the Rust side. Same semantics as the sidebar +
  // button and the keydown fallback above; suppressed while any modal is open.
  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    listen("open-new-terminal", () => {
      if (!alive) return;
      if (modalMode || settingsModalOpen || quitConfirmRunning !== null) return;
      openCreateModal();
    }).then((u) => {
      if (alive) unlisten = u;
      else u();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, [
    modalMode,
    settingsModalOpen,
    quitConfirmRunning,
    openCreateModal,
  ]);

  // Tauri menu — `File → Edit Terminal` (or its Cmd+E accelerator) emits
  // `open-edit-terminal` from the Rust side. Same semantics as the in-WebView
  // Cmd+E fallback; suppressed while any modal is open or nothing is selected.
  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    listen("open-edit-terminal", () => {
      if (!alive) return;
      if (modalMode || settingsModalOpen || quitConfirmRunning !== null) return;
      openEditModalForSelected();
    }).then((u) => {
      if (alive) unlisten = u;
      else u();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, [
    modalMode,
    settingsModalOpen,
    quitConfirmRunning,
    openEditModalForSelected,
  ]);

  // Tauri menu — `LowCal → Preferences…` (or its accelerator) emits
  // `open-settings` from the Rust side. Same toggle semantics as the gear
  // button + the keydown fallback above; suppressed while the profile editor
  // modal is open to avoid stacking a second dialog on top.
  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    listen("open-settings", () => {
      if (!alive) return;
      if (modalMode) return;
      setSettingsModalOpen((prev) => !prev);
    }).then((u) => {
      if (alive) unlisten = u;
      else u();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, [modalMode]);

  // Rust emits `confirm-quit` from the three quit handlers (red traffic
  // light / Cmd+Q / `RunEvent::ExitRequested`) when at least one profile's
  // Start-injected command is still running. Payload is the list of running
  // display names. The handlers in Rust have already prevented their
  // respective close/exit, so we only need to render the modal and wait for
  // the user to confirm or cancel.
  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    listen<string[]>("confirm-quit", (ev) => {
      if (!alive) return;
      setQuitConfirmRunning(ev.payload);
    }).then((u) => {
      if (alive) unlisten = u;
      else u();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  const cancelQuitConfirm = useCallback(() => {
    setQuitConfirmRunning(null);
  }, []);

  const confirmQuitConfirm = useCallback(() => {
    setQuitConfirmRunning(null);
    void invoke("confirm_quit_proceed").catch((e) => {
      console.error(e);
      void notifyUserError(e);
    });
  }, []);

  // Esc cancels the quit-confirmation modal. Click-outside on the backdrop
  // is handled inside `<QuitConfirmModal>`; Enter is handled by the focused
  // OK button.
  useEffect(() => {
    if (quitConfirmRunning === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelQuitConfirm();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [quitConfirmRunning, cancelQuitConfirm]);

  // Esc closes the settings modal; Cmd+Enter triggers Save by submitting the
  // settings form. Scoped to when the modal is open and not currently saving.
  useEffect(() => {
    if (!settingsModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (settingsModalSaving) return;
      if (e.key === "Escape") {
        e.preventDefault();
        closeSettingsModal();
        return;
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        const form = document.getElementById(
          "app-settings-modal-form",
        ) as HTMLFormElement | null;
        if (!form) return;
        e.preventDefault();
        if (typeof form.requestSubmit === "function") {
          form.requestSubmit();
        } else {
          form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [settingsModalOpen, settingsModalSaving, closeSettingsModal]);

  const pickWorkingDirectory = async () => {
    try {
      const trimmed = form.cwd.trim();
      let defaultPath: string | undefined;
      if (trimmed.length > 0) {
        try {
          const abs = await invoke<string | null>("resolve_working_directory", { raw: trimmed });
          defaultPath = abs ?? trimmed;
        } catch {
          defaultPath = trimmed;
        }
      }
      const picked = await open({
        directory: true,
        multiple: false,
        title: "Working directory",
        defaultPath,
      });
      if (picked !== null) {
        setForm((f) => ({ ...f, cwd: picked }));
      }
    } catch (e) {
      console.error(e);
      void notifyUserError(e);
    }
  };

  const deleteProfile = async () => {
    if (!editId) return;
    if (!(await confirmDeleteProfile(form.displayName))) {
      return;
    }
    setSaving(true);
    try {
      const nextSel = nextSelectedIdAfterDelete(profiles, editId, selectedId);
      await invoke("delete_profile", { id: editId });
      await refresh();
      setSelectedId(nextSel);
      closeModal();
    } catch (e) {
      console.error(e);
      void notifyUserError(e);
    } finally {
      setSaving(false);
    }
  };

  const toggleProfileRun = (p: ProfileDto) => {
    if (p.status === "running") {
      clearStartSpinHold(p.id);
      stopProfileFromUi(p.id);
    } else {
      startProfileFromUi(p.id);
    }
  };

  const profileMenuEdit = (p: ProfileDto) => {
    setProfileMenu(null);
    openEditModal(p);
  };

  const profileMenuDelete = (p: ProfileDto) => {
    setProfileMenu(null);
    void run(async () => {
      if (!(await confirmDeleteProfile(p.displayName))) {
        return;
      }
      const nextSel = nextSelectedIdAfterDelete(profiles, p.id, selectedId);
      await invoke("delete_profile", { id: p.id });
      setSelectedId(nextSel);
    });
  };

  const selectedForModalHint =
    modalMode === "edit" && editId ? profiles.find((p) => p.id === editId) ?? null : null;

  return (
    <div className="app-shell">
      <div className="main">
        <ProfileSidebar
          query={query}
          setQuery={setQuery}
          sidebarFilterOpen={sidebarFilterOpen}
          setSidebarFilterOpen={setSidebarFilterOpen}
          sidebarFilterInputRef={sidebarFilterInputRef}
          profiles={profiles}
          allTags={allTags}
          searchActive={searchActive}
          searchResults={searchResults}
          selectedId={selectedId}
          setSelectedId={setSelectedId}
          setProfileMenu={setProfileMenu}
          openCreateModal={openCreateModal}
          toggleProfileRun={toggleProfileRun}
          startSpinHold={startSpinHold}
          stopSpinHold={stopSpinHold}
          ptyOutputActivityTick={ptyOutputActivityTick}
          lastPtyOutputMsRef={lastPtyOutputMsRef}
          resolvedTheme={resolvedTheme}
          onStopAll={stopAllFromSidebar}
          onOpenSettings={() => setSettingsModalOpen(true)}
          onStartTag={startTagFromSidebar}
          onStopTag={stopTagFromSidebar}
          onRestartTag={restartTagFromSidebar}
        />

        <section className="terminal-stage" aria-label="Active terminal session">
          <TerminalStageHeader
            selected={selected}
            resolvedCwdAbsolute={resolvedCwdAbsolute}
            homeDirAbsolute={homeDirAbsolute}
            startSpinHold={startSpinHold}
            stopSpinHold={stopSpinHold}
            profileMenuOpenForSelected={!!profileMenu && profileMenu.profileId === selected?.id}
            setProfileMenu={setProfileMenu}
            startProfileFromUi={startProfileFromUi}
            stopProfileFromUi={stopProfileFromUi}
            restartRunningProfile={restartRunningProfileFromUi}
          />
          <TerminalWorkArea
            profiles={profiles}
            selectedId={selectedId}
            openedProfileIds={openedProfileIds}
            shellEnsured={shellEnsured}
            bridgeReady={bridgeReady}
            wsGenerationByProfile={wsGenerationByProfile}
            resolvedTheme={resolvedTheme}
            terminalSettings={globalSettings.terminal}
            onTerminalBridgeOpen={onTerminalBridgeOpen}
            onPtyOutput={notePtyOutput}
            registerTerminalClearHandler={registerTerminalClearHandler}
          />
        </section>
      </div>

      {profileMenu && menuTargetProfile ? (
        <ProfileContextMenu
          state={profileMenu}
          anchorRef={profileMenuRef}
          onEdit={() => profileMenuEdit(menuTargetProfile)}
          onDelete={() => profileMenuDelete(menuTargetProfile)}
        />
      ) : null}

      <ProfileEditorModal
        modalMode={modalMode}
        editId={editId}
        form={form}
        setForm={setForm}
        saving={saving}
        modalError={modalError}
        closeModal={closeModal}
        saveModal={saveModal}
        deleteProfile={deleteProfile}
        pickWorkingDirectory={pickWorkingDirectory}
        selectedForHint={selectedForModalHint}
        allTags={allTags}
        resolvedTheme={resolvedTheme}
      />

      <AppSettingsModal
        open={settingsModalOpen}
        settings={globalSettings}
        saving={settingsModalSaving}
        saveError={settingsModalError}
        onClose={closeSettingsModal}
        onSave={saveAppSettings}
      />

      <QuitConfirmModal
        open={quitConfirmRunning !== null}
        runningProfiles={quitConfirmRunning ?? []}
        onCancel={cancelQuitConfirm}
        onConfirm={confirmQuitConfirm}
      />
    </div>
  );
}
