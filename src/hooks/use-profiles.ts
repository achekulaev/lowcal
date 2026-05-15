import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import type { ProfileDto } from "../types/profile";

export function useProfiles() {
  const [profiles, setProfiles] = useState<ProfileDto[]>([]);

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

  return { profiles, refresh };
}
