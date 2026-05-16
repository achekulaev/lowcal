import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ProfileContextMenu } from "./components/profile-context-menu";
import { ProfileEditorModal } from "./components/profile-editor-modal";
import { ProfileSidebar } from "./components/sidebar/profile-sidebar";
import { TerminalStageHeader } from "./components/terminal/terminal-stage-header";
import { TerminalWorkArea } from "./components/terminal/terminal-work-area";
import { TopToolbar } from "./components/toolbar/top-toolbar";
import {
  START_SPIN_HOLD_MS,
  START_SPIN_MIN_VISIBLE_MS,
  STOP_SPIN_HOLD_MAX_MS,
  STOP_SPIN_MIN_VISIBLE_MS,
} from "./constants/terminal-ui";
import { useProfiles } from "./hooks/use-profiles";
import { useSidebarFilter } from "./hooks/use-sidebar-filter";
import { useTerminalSessionGlue } from "./hooks/use-terminal-session-glue";
import { getGlobalSettings } from "./settings/global-settings";
import { useAppearance } from "./settings/use-appearance";
import type { ProfileDto, ProfileFormState } from "./types/profile";
import type { ModalMode, ProfileContextMenuState } from "./types/ui";
import { confirmDeleteProfile } from "./utils/delete-profile-dialog";
import { formatUserFacingError, notifyUserError } from "./utils/errors";
import {
  emptyForm,
  envRecordFromLines,
  formFromProfile,
  nextSelectedIdAfterDelete,
  tagsFromCommaString,
} from "./utils/profile-form";

/** When no tab is selected; matches startup title in `tauri.conf.json`. */
const MAIN_WINDOW_TITLE_IDLE = "My LowCal Environment";

export default function App() {
  // Read the global appearance preference (3-state: system | dark | light) and resolve it
  // against the live `prefers-color-scheme` value. The hook also writes `data-theme` onto
  // `<html>` so CSS tokens can switch. There is no settings UI yet; the preference comes
  // from `getGlobalSettings()` defaults and is recomputed on every render (cheap).
  const resolvedTheme = useAppearance(getGlobalSettings().appearance.theme);
  const { profiles, refresh } = useProfiles();
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const sidebarFilterApi = useSidebarFilter(modalMode);
  const { query, setQuery, sidebarFilterOpen, setSidebarFilterOpen, sidebarFilterInputRef } =
    sidebarFilterApi;

  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [tagToolbarOpen, setTagToolbarOpen] = useState(false);
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return profiles.filter((p) => {
      if (tagFilter && !p.tags.includes(tagFilter)) return false;
      if (!q) return true;
      const hay = `${p.displayName} ${p.id} ${p.command} ${p.tags.join(" ")}`.toLowerCase();
      return hay.includes(q);
    });
  }, [profiles, query, tagFilter]);

  const menuTargetProfile = useMemo(() => {
    if (!profileMenu) return null;
    return profiles.find((p) => p.id === profileMenu.profileId) ?? null;
  }, [profiles, profileMenu]);

  const selected = profiles.find((p) => p.id === selectedId) ?? null;
  const tagBulkDisabled = !tagFilter;

  useEffect(() => {
    const title = selected ? `LowCal · ${selected.displayName}` : MAIN_WINDOW_TITLE_IDLE;
    document.title = title;
    void getCurrentWindow().setTitle(title).catch(() => {
      /* Plain Vite (`npm run dev`) has no native window */
    });
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

  const openCreateModal = () => {
    setEditId(null);
    setForm(emptyForm());
    setModalError(null);
    setModalMode("create");
  };

  const openEditModal = (p: ProfileDto) => {
    setEditId(p.id);
    setForm(formFromProfile(p));
    setModalError(null);
    setModalMode("edit");
  };

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
    const tags = tagsFromCommaString(form.tagsStr);
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
            warmOnStart: form.warmOnStart,
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
            warmOnStart: form.warmOnStart,
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

  const profileModalFirstFieldRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (!modalMode) return;
    profileModalFirstFieldRef.current?.focus();
  }, [modalMode]);

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

  const toggleTagToolbar = useCallback(() => {
    setTagToolbarOpen((open) => {
      if (open) {
        setTagFilter(null);
        return false;
      }
      return true;
    });
  }, []);

  return (
    <div className="app-shell">
      <div
        className={`toolbar-slide-shell${tagToolbarOpen ? " toolbar-slide-shell--open" : ""}`}
        aria-hidden={!tagToolbarOpen}
      >
        <div className="toolbar-slide-inner">
          <TopToolbar
            allTags={allTags}
            tagFilter={tagFilter}
            setTagFilter={setTagFilter}
            tagBulkDisabled={tagBulkDisabled}
            run={run}
            restartProfilesByTag={(tag) => run(() => restartProfilesByTagFromUi(tag))}
          />
        </div>
      </div>

      <div className="main">
        <ProfileSidebar
          query={query}
          setQuery={setQuery}
          sidebarFilterOpen={sidebarFilterOpen}
          setSidebarFilterOpen={setSidebarFilterOpen}
          sidebarFilterInputRef={sidebarFilterInputRef}
          filtered={filtered}
          selectedId={selectedId}
          setSelectedId={setSelectedId}
          setProfileMenu={setProfileMenu}
          openCreateModal={openCreateModal}
          toggleProfileRun={toggleProfileRun}
          startSpinHold={startSpinHold}
          stopSpinHold={stopSpinHold}
          ptyOutputActivityTick={ptyOutputActivityTick}
          lastPtyOutputMsRef={lastPtyOutputMsRef}
          tagFilter={tagFilter}
          tagToolbarOpen={tagToolbarOpen}
          onToggleTagToolbar={toggleTagToolbar}
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
        profileModalFirstFieldRef={profileModalFirstFieldRef}
        selectedForHint={selectedForModalHint}
      />
    </div>
  );
}
