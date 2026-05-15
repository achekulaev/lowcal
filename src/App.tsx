import { invoke } from "@tauri-apps/api/core";
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
import { START_SPIN_HOLD_MS } from "./constants/terminal-ui";
import { useProfiles } from "./hooks/use-profiles";
import { useSidebarFilter } from "./hooks/use-sidebar-filter";
import { useTerminalSessionGlue } from "./hooks/use-terminal-session-glue";
import type { ProfileDto, ProfileFormState } from "./types/profile";
import type { ModalMode, ProfileContextMenuState } from "./types/ui";
import { formatUserFacingError, notifyUserError } from "./utils/errors";
import {
  emptyForm,
  envRecordFromLines,
  formFromProfile,
  nextSelectedIdAfterDelete,
  tagsFromCommaString,
} from "./utils/profile-form";

export default function App() {
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
  } = useTerminalSessionGlue(profiles, selectedId);

  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<ProfileFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [profileMenu, setProfileMenu] = useState<ProfileContextMenuState | null>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  const startSpinHoldRef = useRef<Set<string>>(new Set());
  const startSpinTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [startSpinHold, setStartSpinHold] = useState<Record<string, true>>({});

  useEffect(() => {
    return () => {
      for (const t of Object.values(startSpinTimersRef.current)) {
        clearTimeout(t);
      }
      startSpinTimersRef.current = {};
      startSpinHoldRef.current.clear();
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

  const [resolvedCwdAbsolute, setResolvedCwdAbsolute] = useState<string | null>(null);

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
    startSpinHoldRef.current.delete(id);
    setStartSpinHold((s) => {
      if (!s[id]) return s;
      const next = { ...s };
      delete next[id];
      return next;
    });
  }, []);

  const beginStartSpinHold = useCallback(
    (id: string): boolean => {
      if (startSpinHoldRef.current.has(id)) return false;
      startSpinHoldRef.current.add(id);
      setStartSpinHold((s) => ({ ...s, [id]: true }));
      startSpinTimersRef.current[id] = window.setTimeout(
        () => clearStartSpinHold(id),
        START_SPIN_HOLD_MS,
      );
      return true;
    },
    [clearStartSpinHold],
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

  useEffect(() => {
    for (const p of profiles) {
      if (p.status === "running" && startSpinHoldRef.current.has(p.id)) {
        clearStartSpinHold(p.id);
      }
    }
  }, [profiles, clearStartSpinHold]);

  useEffect(() => {
    const valid = new Set(profiles.map((p) => p.id));
    for (const id of [...startSpinHoldRef.current]) {
      if (!valid.has(id)) clearStartSpinHold(id);
    }
  }, [profiles, clearStartSpinHold]);

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
      const picked = await open({
        directory: true,
        multiple: false,
        title: "Working directory",
        defaultPath: trimmed.length > 0 ? trimmed : undefined,
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
    if (
      !confirm(
        `Delete profile "${form.displayName}" (${editId})? This cannot be undone.`,
      )
    ) {
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
      void run(async () => {
        await invoke("stop_profile", { id: p.id });
      });
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
    if (
      !confirm(
        `Delete "${p.displayName}" (${p.id})? Stops the session if running. This cannot be undone.`,
      )
    ) {
      return;
    }
    void run(async () => {
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
            startSpinHold={startSpinHold}
            openEditModal={openEditModal}
            startProfileFromUi={startProfileFromUi}
            run={run}
          />
          <TerminalWorkArea
            profiles={profiles}
            selectedId={selectedId}
            openedProfileIds={openedProfileIds}
            shellEnsured={shellEnsured}
            bridgeReady={bridgeReady}
            wsGenerationByProfile={wsGenerationByProfile}
            onTerminalBridgeOpen={onTerminalBridgeOpen}
            onPtyOutput={notePtyOutput}
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
