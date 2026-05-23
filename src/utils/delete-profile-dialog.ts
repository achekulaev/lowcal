import { confirm as nativeConfirm } from "@tauri-apps/plugin-dialog";

export function deleteProfileConfirmationBody(displayName: string): string {
  return `Delete profile "${displayName}"? Stops the session if running. This cannot be undone.`;
}

/**
 * WKWebView often does not reliably show `window.confirm()`; native Tauri dialogs do.
 */
export async function confirmDeleteProfile(displayName: string): Promise<boolean> {
  const body = deleteProfileConfirmationBody(displayName);
  try {
    return await nativeConfirm(body, {
      title: "Lowcal",
      kind: "warning",
      okLabel: "Delete",
      cancelLabel: "Cancel",
    });
  } catch {
    return window.confirm(body);
  }
}
