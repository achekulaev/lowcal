import { invoke } from "@tauri-apps/api/core";

export async function waitWsOrigin(): Promise<string> {
  for (let i = 0; i < 80; i++) {
    try {
      return await invoke<string>("get_ws_origin");
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw new Error("PTY bridge did not become ready");
}
