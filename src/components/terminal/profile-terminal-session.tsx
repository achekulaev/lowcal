import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type IDisposable } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useLayoutEffect, useRef } from "react";
import { waitWsOrigin } from "../../tauri/wait-ws-origin";
import { base64ToUint8Array, utf8ToBase64 } from "../../utils/ws-encoding";

/**
 * One persistent xterm per opened profile: PTY runs an interactive login shell; Start injects the
 * YAML profile command. `wsGeneration` forces a reconnect after the backend replaces the shell.
 */
export function ProfileTerminalSession({
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
