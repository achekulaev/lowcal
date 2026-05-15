import type { LegacyRef, RefObject } from "react";
import { FormFieldHint } from "./form-field-hint";
import type { ProfileDto, ProfileFormState } from "../types/profile";
import type { ModalMode } from "../types/ui";
export function ProfileEditorModal(props: {
  modalMode: ModalMode;
  editId: string | null;
  form: ProfileFormState;
  setForm: React.Dispatch<React.SetStateAction<ProfileFormState>>;
  saving: boolean;
  modalError: string | null;
  closeModal: () => void;
  saveModal: () => Promise<void>;
  deleteProfile: () => Promise<void>;
  pickWorkingDirectory: () => Promise<void>;
  profileModalFirstFieldRef: RefObject<HTMLInputElement | null>;
  selectedForHint: ProfileDto | null;
}) {
  const {
    modalMode,
    editId,
    form,
    setForm,
    saving,
    modalError,
    closeModal,
    saveModal,
    deleteProfile,
    pickWorkingDirectory,
    profileModalFirstFieldRef,
    selectedForHint,
  } = props;

  if (!modalMode) return null;

  return (
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
          {modalMode === "edit" && selectedForHint?.status === "running" && (
            <p className="modal-hint">
              This profile&apos;s saved command is running in the shell. Saving updates the config
              file only; use Stop then Start (or Restart) to run an edited command.
            </p>
          )}
          <div className="modal-field">
            <label htmlFor="pf-name">Display name</label>
            <input
              ref={profileModalFirstFieldRef as LegacyRef<HTMLInputElement>}
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
  );
}
