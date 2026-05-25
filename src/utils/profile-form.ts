import type { ProfileDto, ProfileFormState } from "../types/profile";
import { envLinesFromRecord } from "./env-lines";

export function emptyForm(): ProfileFormState {
  return {
    displayName: "",
    command: "",
    cwd: "",
    tagsStr: "",
    envStr: "",
    startCommandOnAppOpen: false,
  };
}

export function tagsFromCommaString(s: string): string[] {
  return s
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export function envRecordFromLines(text: string): Record<string, string> {
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

export function formFromProfile(p: ProfileDto): ProfileFormState {
  return {
    displayName: p.displayName,
    command: p.command,
    cwd: p.cwd ?? "",
    tagsStr: p.tags.join(", "),
    envStr: envLinesFromRecord(p.env),
    startCommandOnAppOpen: p.startCommandOnAppOpen ?? false,
  };
}

/**
 * When deleting the focused tab, move selection to an adjacent profile in list order (next, else
 * previous). Otherwise keep the current selection. Caller should pass the profile list **before** deletion.
 */
export function nextSelectedIdAfterDelete(
  profilesOrdered: ProfileDto[],
  deletedId: string,
  currentSelected: string | null,
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
