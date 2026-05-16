function unifySeparators(path: string): string {
  return path.replace(/\\/g, "/");
}

function stripTrailingSlashes(path: string): string {
  return path.replace(/\/+$/, "");
}

/** When `displayPathRaw` is an absolute resolved path under `homeAbsolute`, shows `~/…`. */
export function cwdPathForUi(displayPathRaw: string, homeAbsolute: string | null): string {
  const t = displayPathRaw.trim();
  if (!t) return t;
  if (t === "~" || t.startsWith("~/")) return t;

  const homeTrim = homeAbsolute?.trim();
  if (!homeTrim) return t;

  const homeNorm = stripTrailingSlashes(unifySeparators(homeTrim));
  const pathNorm = stripTrailingSlashes(unifySeparators(t));

  if (!homeNorm || !pathNorm) return t;

  if (pathNorm === homeNorm) return "~";

  const prefix = `${homeNorm}/`;
  if (pathNorm.startsWith(prefix)) {
    return `~/${pathNorm.slice(prefix.length)}`;
  }

  return t;
}
