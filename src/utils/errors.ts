import { message as dialogMessage } from "@tauri-apps/plugin-dialog";

/** Tauri often surfaces deserialization failures as jargon; shorten when we recognise the pattern. */
export function formatUserFacingError(err: unknown): string {
  const raw =
    typeof err === "string" ? err : err instanceof Error ? err.message : String(err);
  if (/invalid args|missing required key/i.test(raw)) {
    return "The window could not send this action to the app backend (request shape mismatch). Try restarting the app; if it still happens, reinstall or rebuild — this message usually means the UI package is out of sync with the native side.";
  }
  return raw;
}

export async function notifyUserError(source: unknown) {
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
