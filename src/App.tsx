import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { message as dialogMessage, open } from "@tauri-apps/plugin-dialog";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type IDisposable } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

type SessionStatus = "stopped" | "running";

interface ProfileDto {
  id: string;
  displayName: string;
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  tags: string[];
  warmOnStart?: boolean;
  startCommandOnAppOpen?: boolean;
  status: SessionStatus;
}

interface ProfileFormState {
  displayName: string;
  command: string;
  cwd: string;
  tagsStr: string;
  envStr: string;
  warmOnStart: boolean;
  startCommandOnAppOpen: boolean;
}

const emptyForm = (): ProfileFormState => ({
  displayName: "",
  command: "",
  cwd: "",
  tagsStr: "",
  envStr: "",
  warmOnStart: false,
  startCommandOnAppOpen: false,
});

function tagsFromCommaString(s: string): string[] {
  return s
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function envRecordFromLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

function envLinesFromRecord(env?: Record<string, string>): string {
  if (!env) return "";
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .sort(([a], [b]) => a.localeCompare(b))
    .join("\n");
}

function formFromProfile(p: ProfileDto): ProfileFormState {
  const autoStart = p.startCommandOnAppOpen ?? false;
  return {
    displayName: p.displayName,
    command: p.command,
    cwd: p.cwd ?? "",
    tagsStr: p.tags.join(", "),
    envStr: envLinesFromRecord(p.env),
    warmOnStart: autoStart ? false : (p.warmOnStart ?? false),
    startCommandOnAppOpen: autoStart,
  };
}

/**
 * When deleting the focused tab, move selection to an adjacent profile in list order (next, else
 * previous). Otherwise keep the current selection. Caller should pass the profile list **before** deletion.
 */
function nextSelectedIdAfterDelete(
  profilesOrdered: ProfileDto[],
  deletedId: string,
  currentSelected: string | null
): string | null {
  if (currentSelected !== deletedId) return currentSelected;
  const idx = profilesOrdered.findIndex((p) => p.id === deletedId);
  if (idx < 0) return null;
  const nextId = profilesOrdered[idx + 1]?.id;
  if (nextId) return nextId;
  const prevId = profilesOrdered[idx - 1]?.id;
  if (prevId) return prevId;
  return null;
}

/** Tauri often surfaces deserialization failures as jargon; shorten when we recognise the pattern. */
function formatUserFacingError(err: unknown): string {
  const raw =
    typeof err === "string" ? err : err instanceof Error ? err.message : String(err);
  if (/invalid args|missing required key/i.test(raw)) {
    return "The window could not send this action to the app backend (request shape mismatch). Try restarting the app; if it still happens, reinstall or rebuild — this message usually means the UI package is out of sync with the native side.";
  }
  return raw;
}

/** Instant custom tooltip for form hints (native title= is slow). */
function FormFieldHint({ text }: { text: string }) {
  return (
    <span className="form-field-hint" tabIndex={0} aria-label={text}>
      <span className="form-field-hint__glyph" aria-hidden="true">
        ?
      </span>
      <span className="form-field-hint__popup" aria-hidden="true">
        {text}
      </span>
    </span>
  );
}

function splitLeadingShellToken(command: string): { head: string; tail: string } {
  const t = command.trim();
  if (!t) return { head: "", tail: "" };
  const m = /^(\S+)([\s\S]*)?$/.exec(t);
  return m ? { head: m[1], tail: m[2] ?? "" } : { head: "", tail: "" };
}

function SidebarTabRunIcon({ running }: { running: boolean }) {
  if (running) {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
        <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
      <path fill="currentColor" d="M9 6.5v11l8.5-5.5L9 6.5z" />
    </svg>
  );
}

function StartPendingSpinner() {
  return (
    <svg className="start-pending-spinner" viewBox="0 0 24 24" width="20" height="20" aria-hidden>
      <circle
        cx="12"
        cy="12"
        r="8.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="41 14"
      />
    </svg>
  );
}

function NewTerminalIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path fill="currentColor" d="M19 11h-6V5h-2v6H5v2h6v6h2v-6h6v-2z" />
    </svg>
  );
}

function SidebarSearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"
      />
    </svg>
  );
}

function SidebarCloseFilterIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
      />
    </svg>
  );
}

/** Pencil — terminal header edit (grey accent). */
function EditProfileIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
      <path
        fill="currentColor"
        d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1.003 1.003 0 0 0 0-1.41l-2.34-2.34a1.003 1.003 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
      />
    </svg>
  );
}

/** Two arrows on a circle — restart (blue accent in terminal header). */
function RestartLoopIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
      <path
        fill="currentColor"
        d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"
      />
    </svg>
  );
}

function ShellCommandSnippet({ command }: { command: string }) {
  const { head, tail } = splitLeadingShellToken(command);
  return (
    <pre className="terminal-cmd-snippet">
      <code>
        <span className="terminal-cmd-snippet-invoke">{head}</span>
        <span className="terminal-cmd-snippet-tail">{tail}</span>
      </code>
    </pre>
  );
}

async function notifyUserError(source: unknown) {
  const text = formatUserFacingError(source);
  try {
    await dialogMessage(text, {
      title: "Terminal orchestrator",
      kind: "error",
    });
  } catch {
    alert(text);
  }
}

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin);
}

function base64ToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

async function waitWsOrigin(): Promise<string> {
  for (let i = 0; i < 80; i++) {
    try {
      return await invoke<string>("get_ws_origin");
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw new Error("PTY bridge did not become ready");
}

/**
 * One persistent xterm per opened profile: PTY runs an interactive login shell; Start injects the
 * YAML profile command. `wsGeneration` forces a reconnect after the backend replaces the shell.
 */
const PTY_OUTPUT_ACTIVITY_MS = 1000;
/** After Start click: keep spinner at least this long unless the profile becomes running sooner. */
const START_SPIN_HOLD_MS = 3000;

function ProfileTerminalSession({
  profileId,
  isForeground,
  wsGeneration,
  onBridgeOpen,
  onPtyOutput,
}: {
  profileId: string;
  isForeground: boolean;
  wsGeneration: number;
  onBridgeOpen: (profileId: string) => void;
  onPtyOutput: (profileId: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const onDataDisposableRef = useRef<IDisposable | null>(null);
  const onResizeDisposableRef = useRef<IDisposable | null>(null);
  const bridgeOpenRef = useRef(onBridgeOpen);
  bridgeOpenRef.current = onBridgeOpen;
  const onPtyOutputRef = useRef(onPtyOutput);
  onPtyOutputRef.current = onPtyOutput;
  const isForegroundRef = useRef(isForeground);
  isForegroundRef.current = isForeground;

  useLayoutEffect(() => {
    if (!isForeground) return;
    requestAnimationFrame(() => {
      fitRef.current?.fit();
      const t = termRef.current;
      const w = wsRef.current;
      if (t && w?.readyState === WebSocket.OPEN) {
        w.send(JSON.stringify({ type: "resize", cols: t.cols, rows: t.rows }));
      }
    });
  }, [isForeground]);

  /** Move keyboard focus to this xterm when the tab becomes active (input-ready when WS is open). */
  useEffect(() => {
    if (!isForeground) return;
    const term = termRef.current;
    if (!term) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      requestAnimationFrame(() => {
        term.focus();
      });
    }
  }, [isForeground]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "Menlo, Monaco, Consolas, monospace",
      fontSize: 13,
      theme: {
        background: "#0d1117",
        foreground: "#e6edf3",
        cursor: "#58a6ff",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const ro = new ResizeObserver(() => {
      fitRef.current?.fit();
      const t = termRef.current;
      const w = wsRef.current;
      if (t && w?.readyState === WebSocket.OPEN) {
        w.send(JSON.stringify({ type: "resize", cols: t.cols, rows: t.rows }));
      }
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      wsRef.current?.close();
      wsRef.current = null;
      onDataDisposableRef.current?.dispose();
      onDataDisposableRef.current = null;
      onResizeDisposableRef.current?.dispose();
      onResizeDisposableRef.current = null;
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      host.innerHTML = "";
    };
  }, [profileId]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    let cancelled = false;
    let ws: WebSocket | null = null;

    onDataDisposableRef.current?.dispose();
    onDataDisposableRef.current = term.onData((data) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data: utf8ToBase64(data) }));
      }
    });

    onResizeDisposableRef.current?.dispose();
    onResizeDisposableRef.current = term.onResize(({ cols, rows }) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    });

    void (async () => {
      try {
        const origin = await waitWsOrigin();
        if (cancelled) return;
        const sock = new WebSocket(`${origin}/ws/${encodeURIComponent(profileId)}`);
        if (cancelled) {
          sock.close();
          return;
        }
        ws = sock;
        wsRef.current = ws;

        ws.onmessage = (ev: MessageEvent<string>) => {
          try {
            const msg = JSON.parse(ev.data) as { type: string; data?: string; message?: string };
            if (msg.type === "output" && msg.data) {
              term.write(base64ToUint8Array(msg.data));
              onPtyOutputRef.current(profileId);
            }
            if (msg.type === "error" && msg.message) {
              term.writeln(`\r\n\x1b[31m${msg.message}\x1b[0m`);
              onPtyOutputRef.current(profileId);
            }
          } catch {
            /* ignore */
          }
        };

        ws.onopen = () => {
          if (cancelled) return;
          const { cols, rows } = term;
          ws?.send(JSON.stringify({ type: "resize", cols, rows }));
          bridgeOpenRef.current(profileId);
          if (isForegroundRef.current) {
            requestAnimationFrame(() => {
              term.focus();
            });
          }
        };
      } catch (e) {
        if (!cancelled) term.writeln(`\r\n\x1b[31m${String(e)}\x1b[0m`);
      }
    })();

    return () => {
      cancelled = true;
      ws?.close();
      if (wsRef.current === ws) wsRef.current = null;
      onDataDisposableRef.current?.dispose();
      onDataDisposableRef.current = null;
      onResizeDisposableRef.current?.dispose();
      onResizeDisposableRef.current = null;
    };
  }, [profileId, wsGeneration]);

  return <div className="xterm-host" ref={hostRef} />;
}

function TerminalWorkArea({
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
    [profiles, openedProfileIds]
  );

  const mountedShellIds = useMemo(
    () => mountedIds.filter((id) => shellEnsured[id]),
    [mountedIds, shellEnsured]
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

type ModalMode = null | "create" | "edit";

type ProfileContextMenuState = { clientX: number; clientY: number; profileId: string };

export default function App() {
  const [profiles, setProfiles] = useState<ProfileDto[]>([]);
  const [query, setQuery] = useState("");
  const [sidebarFilterOpen, setSidebarFilterOpen] = useState(false);
  const sidebarFilterInputRef = useRef<HTMLInputElement>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<ProfileFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [profileMenu, setProfileMenu] = useState<ProfileContextMenuState | null>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  const [openedProfileIds, setOpenedProfileIds] = useState<string[]>([]);
  const [shellEnsured, setShellEnsured] = useState<Record<string, boolean>>({});
  const [bridgeReady, setBridgeReady] = useState<Record<string, boolean>>({});
  const [wsGenerationByProfile, setWsGenerationByProfile] = useState<Record<string, number>>({});
  const startSpinHoldRef = useRef<Set<string>>(new Set());
  const startSpinTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [startSpinHold, setStartSpinHold] = useState<Record<string, true>>({});
  const lastPtyOutputMsRef = useRef<Record<string, number>>({});
  const [ptyOutputActivityTick, setPtyOutputActivityTick] = useState(0);
  const ptyActivityBumpRafRef = useRef<number | null>(null);

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
    return () => {
      for (const t of Object.values(startSpinTimersRef.current)) {
        clearTimeout(t);
      }
      startSpinTimersRef.current = {};
      startSpinHoldRef.current.clear();
    };
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
    if (!sidebarFilterOpen) return;
    const id = requestAnimationFrame(() => sidebarFilterInputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [sidebarFilterOpen]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      if (e.key !== "f" && e.key !== "F") return;
      if (modalMode) return;
      e.preventDefault();
      setSidebarFilterOpen(true);
      requestAnimationFrame(() => sidebarFilterInputRef.current?.focus());
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [modalMode]);

  const refresh = useCallback(async () => {
    const list = await invoke<ProfileDto[]>("list_profiles");
    setProfiles(list);
  }, []);

  useEffect(() => {
    refresh().catch(console.error);

    let alive = true;
    let unlisten: (() => void) | undefined;

    listen<ProfileDto[]>("profiles-updated", (ev) => {
      setProfiles(ev.payload);
    }).then((u) => {
      if (alive) unlisten = u;
      else u();
    });

    return () => {
      alive = false;
      unlisten?.();
    };
  }, [refresh]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setOpenedProfileIds((prev) =>
      prev.includes(selectedId) ? prev : [...prev, selectedId]
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
   * Mount PTY/WebSocket layers for every profile the backend reports as **running**, not only the
   * selected tab. Otherwise Start (sidebar hover) or **start on app open** never opens a frontend
   * session and the UI cannot observe PTY output (activity ring, scrollback when the tab is opened
   * later).
   */
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

  useLayoutEffect(() => {
    if (!profileMenu || !profileMenuRef.current) return;
    const pad = 8;
    const el = profileMenuRef.current;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rect = el.getBoundingClientRect();
    let left = profileMenu.clientX;
    let top = profileMenu.clientY;
    if (left + rect.width > vw - pad) left = vw - rect.width - pad;
    if (top + rect.height > vh - pad) top = vh - rect.height - pad;
    if (left < pad) left = pad;
    if (top < pad) top = pad;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [profileMenu]);

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
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Working directory",
        defaultPath: trimmed.length > 0 ? trimmed : undefined,
      });
      if (selected !== null) {
        setForm((f) => ({ ...f, cwd: selected }));
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
        `Delete profile "${form.displayName}" (${editId})? This cannot be undone.`
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
        `Delete "${p.displayName}" (${p.id})? Stops the session if running. This cannot be undone.`
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

  return (
    <div className="app-shell">
      <header className="toolbar">
        <div className="tag-filter">
          <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Tags:</span>
          <button
            type="button"
            className={`tag-chip${tagFilter === null ? " active" : ""}`}
            onClick={() => setTagFilter(null)}
          >
            All
          </button>
          {allTags.map((t) => (
            <button
              key={t}
              type="button"
              className={`tag-chip${tagFilter === t ? " active" : ""}`}
              onClick={() => setTagFilter((cur) => (cur === t ? null : t))}
            >
              {t}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={tagBulkDisabled}
          onClick={() => {
            if (!tagFilter) return;
            void run(() => invoke("start_tag", { tag: tagFilter }));
          }}
        >
          Start tag
        </button>
        <button
          type="button"
          disabled={tagBulkDisabled}
          onClick={() => {
            if (!tagFilter) return;
            void run(() => invoke("stop_tag", { tag: tagFilter }));
          }}
        >
          Stop tag
        </button>
        <button
          type="button"
          disabled={tagBulkDisabled}
          onClick={() => {
            if (!tagFilter) return;
            void run(() => invoke("restart_tag", { tag: tagFilter }));
          }}
        >
          Restart tag
        </button>
        <button type="button" onClick={() => run(() => invoke("stop_all"))}>
          Stop all
        </button>
      </header>

      <div className="main">
        <aside className="sidebar" aria-label="Terminal tabs">
          <div className="sidebar-top">
            <div className="sidebar-head">
              <h2>Terminals</h2>
              <div className="sidebar-head-actions">
                <button
                  type="button"
                  className="sidebar-add-icon-btn sidebar-add-icon-btn-sm"
                  onClick={() => {
                    if (sidebarFilterOpen) {
                      setQuery("");
                      setSidebarFilterOpen(false);
                    } else {
                      setSidebarFilterOpen(true);
                    }
                  }}
                  aria-expanded={sidebarFilterOpen}
                  aria-label={
                    sidebarFilterOpen ? "Clear search and hide filter" : "Show profile filter"
                  }
                  title={sidebarFilterOpen ? "Clear and close filter" : "Filter profiles"}
                >
                  {sidebarFilterOpen ? <SidebarCloseFilterIcon /> : <SidebarSearchIcon />}
                </button>
                <button
                  type="button"
                  className="sidebar-add-icon-btn sidebar-add-icon-btn-sm"
                  onClick={openCreateModal}
                  aria-label="New terminal"
                  title="New terminal"
                >
                  <NewTerminalIcon />
                </button>
              </div>
            </div>
            {sidebarFilterOpen ? (
              <div className="sidebar-profile-filter" role="search" aria-label="Filter profiles">
                <input
                  ref={sidebarFilterInputRef}
                  id="search-profiles"
                  type="search"
                  placeholder="Filter profiles…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setQuery("");
                      setSidebarFilterOpen(false);
                    }
                  }}
                />
              </div>
            ) : null}
          </div>
          <div className="profile-list">
            <div role="tablist" aria-label="Open terminal profiles">
              {filtered.map((p) => {
                void ptyOutputActivityTick;
                const tOut = lastPtyOutputMsRef.current[p.id];
                const ptyOutputRecent =
                  tOut != null && Date.now() - tOut < PTY_OUTPUT_ACTIVITY_MS;
                const startBusy = p.status !== "running" && Boolean(startSpinHold[p.id]);
                return (
                <div
                  key={p.id}
                  role="presentation"
                  className={`profile-row-wrap tab-rail-profile${selectedId === p.id ? " selected" : ""}`}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={selectedId === p.id}
                    className="profile-row"
                    onClick={() => setSelectedId(p.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setSelectedId(p.id);
                      setProfileMenu({ clientX: e.clientX, clientY: e.clientY, profileId: p.id });
                    }}
                  >
                    <span
                      className={`status-dot-wrap${ptyOutputRecent ? " status-dot-wrap--activity" : ""}`}
                      title={
                        ptyOutputRecent
                          ? `${p.status} — receiving terminal output`
                          : p.status
                      }
                    >
                      <span
                        className={`status-dot ${p.status === "running" ? "running" : "stopped"}`}
                      />
                      <span className="status-dot-wrap__ring" aria-hidden />
                    </span>
                    <div className="profile-meta">
                      <div className="profile-title">{p.displayName}</div>
                      <div className="profile-sub">{p.command}</div>
                      {p.tags.length > 0 && (
                        <div className="tags-inline">
                          {p.tags.map((t) => (
                            <span key={t}>{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </button>
                  <button
                    type="button"
                    className={`profile-tab-run-btn${p.status === "running" ? " stop" : ""}${startBusy ? " pending" : ""}`}
                    disabled={startBusy}
                    aria-busy={startBusy}
                    title={
                      p.status === "running"
                        ? "Stop"
                        : startBusy
                          ? "Starting…"
                          : "Start saved command"
                    }
                    aria-label={
                      p.status === "running"
                        ? `Stop ${p.displayName}`
                        : startBusy
                          ? `Starting ${p.displayName}`
                          : `Start saved command for ${p.displayName}`
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleProfileRun(p);
                    }}
                  >
                    {p.status === "running" ? (
                      <SidebarTabRunIcon running />
                    ) : startBusy ? (
                      <StartPendingSpinner />
                    ) : (
                      <SidebarTabRunIcon running={false} />
                    )}
                  </button>
                </div>
                );
              })}
            </div>
            <div className="sidebar-add-inline" role="presentation">
              <button
                type="button"
                className="sidebar-add-icon-btn"
                onClick={openCreateModal}
                aria-label="New terminal"
                title="New terminal"
              >
                <NewTerminalIcon />
              </button>
            </div>
          </div>
        </aside>

        <section className="terminal-stage" aria-label="Active terminal session">
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
                        run(() =>
                          invoke("restart_profile", { id: selected.id }),
                        )
                      }
                    >
                      <RestartLoopIcon />
                    </button>
                  </>
                ) : null}
              </div>
            )}
          </header>
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
        <div
          ref={profileMenuRef}
          className="profile-context-menu"
          role="menu"
          aria-label="Profile actions"
          style={{
            position: "fixed",
            left: profileMenu.clientX,
            top: profileMenu.clientY,
            zIndex: 1200,
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            type="button"
            role="menuitem"
            className="profile-context-menu-item"
            onClick={() => profileMenuEdit(menuTargetProfile)}
          >
            Edit…
          </button>
          <button
            type="button"
            role="menuitem"
            className="profile-context-menu-item danger"
            onClick={() => profileMenuDelete(menuTargetProfile)}
          >
            Delete
          </button>
        </div>
      ) : null}

      {modalMode && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="modal-dialog" role="dialog" aria-modal="true">
            <header>{modalMode === "create" ? "New terminal profile" : "Edit terminal profile"}</header>
            {modalMode === "edit" && editId && (
              <div className="modal-id-line">
                Profile id: <code>{editId}</code> (stable — edit display name freely)
              </div>
            )}
            <form
              id="terminal-profile-modal-form"
              className="modal-body"
              onSubmit={(e) => {
                e.preventDefault();
                void saveModal();
              }}
            >
              {modalMode === "edit" && selected?.status === "running" && (
                <p className="modal-hint">
                  This profile&apos;s saved command is running in the shell. Saving updates the config
                  file only; use Stop then Start (or Restart) to run an edited command.
                </p>
              )}
              <div className="modal-field">
                <label htmlFor="pf-name">Display name</label>
                <input
                  ref={profileModalFirstFieldRef}
                  id="pf-name"
                  type="text"
                  value={form.displayName}
                  onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                  autoComplete="off"
                />
              </div>
              <div className="modal-field">
                <label htmlFor="pf-cmd">Command (runs when you press Start)</label>
                <textarea
                  id="pf-cmd"
                  value={form.command}
                  onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))}
                  placeholder={'e.g. npm run dev  or  cargo watch -x run'}
                  spellCheck={false}
                />
              </div>
              <div className="modal-field">
                <label htmlFor="pf-cwd">Working directory (optional)</label>
                <div className="modal-field-cwd-row">
                  <input
                    id="pf-cwd"
                    type="text"
                    value={form.cwd}
                    onChange={(e) => setForm((f) => ({ ...f, cwd: e.target.value }))}
                    placeholder="~/projects/my-app"
                    autoComplete="off"
                  />
                  <button type="button" className="browse-dir" onClick={() => void pickWorkingDirectory()}>
                    Browse…
                  </button>
                </div>
              </div>
              <div className="modal-field">
                <label htmlFor="pf-tags">Tags (comma-separated)</label>
                <input
                  id="pf-tags"
                  type="text"
                  value={form.tagsStr}
                  onChange={(e) => setForm((f) => ({ ...f, tagsStr: e.target.value }))}
                  placeholder="frontend, dev"
                  autoComplete="off"
                />
              </div>
              <div className="modal-field modal-field-checkbox">
                <div className="modal-checkbox-row">
                  <input
                    id="pf-autostart"
                    type="checkbox"
                    checked={form.startCommandOnAppOpen}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setForm((f) => ({
                        ...f,
                        startCommandOnAppOpen: on,
                        warmOnStart: on ? false : f.warmOnStart,
                      }));
                    }}
                  />
                  <label htmlFor="pf-autostart" className="modal-checkbox-label">
                    Run saved command when the app opens
                  </label>
                  <FormFieldHint text="Same as pressing Start — the saved command runs as soon as the app opens." />
                </div>
              </div>
              <div
                className={`modal-field modal-field-checkbox${form.startCommandOnAppOpen ? " modal-field-checkbox--disabled" : ""}`}
                title={
                  form.startCommandOnAppOpen
                    ? "Included automatically when the saved command runs at open."
                    : undefined
                }
              >
                <div className="modal-checkbox-row">
                  <input
                    id="pf-warm"
                    type="checkbox"
                    disabled={form.startCommandOnAppOpen}
                    checked={form.warmOnStart}
                    onChange={(e) => setForm((f) => ({ ...f, warmOnStart: e.target.checked }))}
                  />
                  <label htmlFor="pf-warm" className="modal-checkbox-label">
                    Prepare terminal when the app opens
                  </label>
                  <FormFieldHint text="Opens an idle login shell only (not the saved command). Uses more memory." />
                </div>
              </div>
              <div className="modal-field">
                <label htmlFor="pf-env">Environment (optional, one KEY=value per line)</label>
                <textarea
                  id="pf-env"
                  className="env-field"
                  value={form.envStr}
                  onChange={(e) => setForm((f) => ({ ...f, envStr: e.target.value }))}
                  placeholder={"NODE_ENV=development\nPORT=3000"}
                  spellCheck={false}
                />
              </div>
            </form>
            {modalError && (
              <p className="modal-save-error" role="alert">
                {modalError}
              </p>
            )}
            <footer className="modal-footer">
              {modalMode === "edit" && (
                <button type="button" className="danger" disabled={saving} onClick={() => void deleteProfile()}>
                  Delete profile
                </button>
              )}
              <button type="button" disabled={saving} onClick={closeModal}>
                Cancel
              </button>
              <button type="submit" form="terminal-profile-modal-form" className="primary" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
