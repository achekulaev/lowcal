export function envLinesFromRecord(env?: Record<string, string>): string {
  if (!env) return "";
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .sort(([a], [b]) => a.localeCompare(b))
    .join("\n");
}
