import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type IDisposable } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useLayoutEffect, useRef } from "react";
import {
  xtermOptionsFromGlobalSettings,
  xtermThemeForResolved,
  type GlobalSettings,
  type ResolvedTheme,
} from "../../settings/global-settings";
import { waitWsOrigin } from "../../tauri/wait-ws-origin";
import { base64ToUint8Array, utf8ToBase64 } from "../../utils/ws-encoding";
import { snapWindowToTerminalLines } from "../../utils/window-snap";

/**
 * One persistent xterm per opened profile: PTY runs an interactive login shell; Start injects the
 * YAML profile command. `wsGeneration` forces a reconnect after the backend replaces the shell.
 * `resolvedTheme` is the live `dark | light` value from `useAppearance`; the xterm palette is
 * swapped via `term.options.theme = ...` so the running terminal flips colors without remount.
 *
 * `terminalSettings` (scrollback / fontFamily / fontSize) is read **once at construction**:
 * changing settings only affects newly opened tabs by design — see
 * `.cursor/decisions/app-settings-persistence.md`. The value is captured in a ref so the
 * mount effect's dep list stays stable.
 */
export function ProfileTerminalSession({
  profileId,
  isForeground,
  wsGeneration,
  resolvedTheme,
  terminalSettings,
  onBridgeOpen,
  onPtyOutput,
  registerTerminalClearHandler,
}: {
  profileId: string;
  isForeground: boolean;
  wsGeneration: number;
  resolvedTheme: ResolvedTheme;
  terminalSettings: GlobalSettings["terminal"];
  onBridgeOpen: (profileId: string) => void;
  onPtyOutput: (profileId: string) => void;
  registerTerminalClearHandler: (profileId: string, handler: (() => void) | null) => void;
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
  // Capture terminal options at first render. Subsequent updates are ignored
  // by design — see the file-level comment + decision doc.
  const terminalSettingsAtMountRef = useRef(terminalSettings);
  // Snap-to-whole-lines state: debounce timer + in-flight guard to avoid
  // infinite ResizeObserver ↔ setSize loops.
  const snapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSnappingRef = useRef(false);

  useLayoutEffect(() => {
    if (!isForeground) return;
    requestAnimationFrame(() => {
      fitRef.current?.fit();
      const t = termRef.current;
      const w = wsRef.current;
      if (t && w?.readyState === WebSocket.OPEN) {
        w.send(JSON.stringify({ type: "resize", cols: t.cols, rows: t.rows }));
      }
      // Snap the window so this tab's rows fill a whole number of lines.
      const host = hostRef.current;
      if (t && host) void snapWindowToTerminalLines(t, host);
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
      ...xtermOptionsFromGlobalSettings(terminalSettingsAtMountRef.current, resolvedTheme),
      cursorBlink: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    // Fit once more after layout so scrollBarWidth / column count match the visible gutter
    // (overlay scrollbars on macOS WKWebView otherwise leave the canvas one column too wide).
    // Also snap the window height to a whole number of terminal rows on startup.
    requestAnimationFrame(() => {
      fitRef.current?.fit();
      if (isForegroundRef.current) void snapWindowToTerminalLines(term, host);
    });
    termRef.current = term;
    fitRef.current = fit;
    registerTerminalClearHandler(profileId, () => {
      term.clear();
    });

    const ro = new ResizeObserver(() => {
      fitRef.current?.fit();
      const t = termRef.current;
      const w = wsRef.current;
      if (t && w?.readyState === WebSocket.OPEN) {
        w.send(JSON.stringify({ type: "resize", cols: t.cols, rows: t.rows }));
      }
      // Debounced window snap: wait for the user to finish dragging the resize
      // handle, then nudge the window to the nearest whole line boundary.
      // The isSnappingRef guard prevents an infinite ResizeObserver ↔ setSize loop.
      if (isForegroundRef.current && !isSnappingRef.current && t) {
        if (snapTimerRef.current !== null) clearTimeout(snapTimerRef.current);
        snapTimerRef.current = setTimeout(() => {
          snapTimerRef.current = null;
          if (!isSnappingRef.current && isForegroundRef.current && termRef.current) {
            isSnappingRef.current = true;
            void snapWindowToTerminalLines(termRef.current, host).finally(() => {
              isSnappingRef.current = false;
            });
          }
        }, 150);
      }
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      if (snapTimerRef.current !== null) {
        clearTimeout(snapTimerRef.current);
        snapTimerRef.current = null;
      }
      wsRef.current?.close();
      wsRef.current = null;
      onDataDisposableRef.current?.dispose();
      onDataDisposableRef.current = null;
      onResizeDisposableRef.current?.dispose();
      onResizeDisposableRef.current = null;
      registerTerminalClearHandler(profileId, null);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      host.innerHTML = "";
    };
    // `resolvedTheme` is read at construction only; live updates are handled by the
    // dedicated theme effect below so the terminal does not remount (which would wipe
    // scrollback) every time the app theme flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, registerTerminalClearHandler]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = xtermThemeForResolved(resolvedTheme);
  }, [resolvedTheme]);

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
