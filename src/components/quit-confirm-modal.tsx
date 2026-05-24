import { useLayoutEffect, useRef } from "react";

/**
 * Custom in-app quit-confirmation dialog. Replaces the native NSAlert that
 * `tauri-plugin-dialog` provides because that dialog auto-sizes to its body
 * and was wrapping the title `"Quit Lowcal Terminal Orchestrator?"` onto two
 * lines.
 *
 * Triggered from Rust via the `confirm-quit` event (see `emit_quit_confirmation`
 * in `src-tauri/src/lib.rs`); on **OK** the caller invokes the
 * `confirm_quit_proceed` Tauri command which sets the one-shot bypass flag
 * and calls `app.exit(0)`. On **Cancel** the modal just closes locally — the
 * three quit handlers in Rust have already prevented their respective
 * close/exit, so nothing else needs to happen.
 *
 * Esc / backdrop click cancel; Enter triggers OK (the focused button).
 */
export function QuitConfirmModal(props: {
  open: boolean;
  runningProfiles: string[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { open, runningProfiles, onCancel, onConfirm } = props;
  const okButtonRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    okButtonRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="modal-dialog quit-confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="quit-confirm-title"
        aria-describedby="quit-confirm-body"
      >
        <header id="quit-confirm-title">Quit Lowcal Terminal Orchestrator?</header>
        <div id="quit-confirm-body" className="modal-body">
          <p className="quit-confirm-lede">These terminals will be stopped:</p>
          <ul className="quit-confirm-list">
            {runningProfiles.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </div>
        <footer className="modal-footer">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            ref={okButtonRef}
            type="button"
            className="primary"
            onClick={onConfirm}
          >
            OK
          </button>
        </footer>
      </div>
    </div>
  );
}
