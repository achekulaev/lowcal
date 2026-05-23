import { invoke } from "@tauri-apps/api/core";
import type { ResolvedTheme } from "../../settings/global-settings";
import { tagPillStyle } from "../../utils/tag-pills";

export function TopToolbar(props: {
  allTags: string[];
  tagFilter: string | null;
  setTagFilter: React.Dispatch<React.SetStateAction<string | null>>;
  tagBulkDisabled: boolean;
  run: (fn: () => Promise<void>) => Promise<void>;
  restartProfilesByTag: (tag: string) => Promise<void>;
  resolvedTheme: ResolvedTheme;
}) {
  const {
    allTags,
    tagFilter,
    setTagFilter,
    tagBulkDisabled,
    run,
    restartProfilesByTag,
    resolvedTheme,
  } = props;

  return (
    <header className="toolbar">
      <div className="tag-filter">
        <button
          type="button"
          className={`tag-chip${tagFilter === null ? " active" : ""}`}
          onClick={() => setTagFilter(null)}
        >
          All
        </button>
        {allTags.map((t) => (
          <button
            key={t}
            type="button"
            className={`tag-chip tag-chip--hue${tagFilter === t ? " active" : ""}`}
            style={tagPillStyle(t, tagFilter === t, resolvedTheme)}
            onClick={() => setTagFilter((cur) => (cur === t ? null : t))}
          >
            {t}
          </button>
        ))}
      </div>
      {!tagBulkDisabled && tagFilter ? (
        <>
          <button
            type="button"
            onClick={() => {
              void run(() => invoke("start_tag", { tag: tagFilter }));
            }}
          >
            Start tag
          </button>
          <button
            type="button"
            onClick={() => {
              void run(() => invoke("stop_tag", { tag: tagFilter }));
            }}
          >
            Stop tag
          </button>
          <button
            type="button"
            onClick={() => {
              void run(() => restartProfilesByTag(tagFilter));
            }}
          >
            Restart tag
          </button>
        </>
      ) : null}
      <button type="button" onClick={() => run(() => invoke("stop_all"))}>
        Stop all
      </button>
    </header>
  );
}
