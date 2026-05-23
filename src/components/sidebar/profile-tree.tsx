import { useCallback, useEffect, useId, useRef } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { ProfileDto } from "../../types/profile";
import type { ResolvedTheme } from "../../settings/global-settings";
import { tagPillStyle } from "../../utils/tag-pills";
import {
  FolderChevronIcon,
  PlayTriangleIcon,
  StopSquareIcon,
  RestartLoopIcon,
} from "../profile-icons";

/**
 * Sentinel folder id for the "no tag" bucket. Real tags can be any user
 * string; the sentinel uses a leading null byte so it can never collide with
 * a tag the user typed in.
 */
const UNTAGGED_FOLDER_ID = "\0untagged";

/**
 * Reusable folder-membership predicate. Returned together with display info so
 * the tree can derive `searchActive === false` rendering and the
 * auto-expand-on-selection effect from one source of truth.
 */
type FolderDescriptor = {
  id: string;
  label: string;
  isUntagged: boolean;
  member: (p: ProfileDto) => boolean;
};

function buildFolderDescriptors(allTags: string[]): FolderDescriptor[] {
  const tagFolders: FolderDescriptor[] = allTags.map((tag) => ({
    id: tag,
    label: tag,
    isUntagged: false,
    member: (p) => p.tags.includes(tag),
  }));
  const untagged: FolderDescriptor = {
    id: UNTAGGED_FOLDER_ID,
    label: "Untagged",
    isUntagged: true,
    member: (p) => p.tags.length === 0,
  };
  return [...tagFolders, untagged];
}

/** First folder (alphabetical tag order, then Untagged) that contains the profile. */
function firstFolderContaining(folders: FolderDescriptor[], profile: ProfileDto): string | null {
  for (const f of folders) {
    if (f.member(profile)) return f.id;
  }
  return null;
}

/** running / total counts for a folder. */
function folderCounts(profiles: ProfileDto[], member: (p: ProfileDto) => boolean) {
  let running = 0;
  let total = 0;
  for (const p of profiles) {
    if (!member(p)) continue;
    total += 1;
    if (p.status === "running") running += 1;
  }
  return { running, total };
}

export function ProfileTree(props: {
  profiles: ProfileDto[];
  allTags: string[];
  selectedId: string | null;
  resolvedTheme: ResolvedTheme;
  /**
   * Expanded state is owned by the parent (`ProfileSidebar`) so the tree's
   * collapse state survives the search/tree toggle — when the user types into
   * the sidebar filter, this component unmounts and the flat results list
   * takes its place; on clear-search we re-mount with the same `expanded` set.
   */
  expanded: Set<string>;
  setExpanded: Dispatch<SetStateAction<Set<string>>>;
  renderProfileRow: (p: ProfileDto, opts: { showTagPills: boolean }) => ReactNode;
  onStartTag: (tag: string) => void;
  onStopTag: (tag: string) => void;
  onRestartTag: (tag: string) => void;
}) {
  const { profiles, allTags, selectedId, resolvedTheme, renderProfileRow, expanded, setExpanded } =
    props;
  const folders = buildFolderDescriptors(allTags);
  const visibleFolders = folders.filter((f) => folderCounts(profiles, f.member).total > 0);

  // Auto-expand the first folder containing the selected profile when selection
  // changes — so selecting from elsewhere (search clear, sidebar key nav,
  // window restore) keeps the row visible. Already-expanded state is preserved;
  // we never *collapse* on selection.
  const lastAutoExpandedFor = useRef<string | null>(null);
  useEffect(() => {
    if (selectedId == null) {
      lastAutoExpandedFor.current = null;
      return;
    }
    if (lastAutoExpandedFor.current === selectedId) return;
    const profile = profiles.find((p) => p.id === selectedId);
    if (!profile) return;
    const containing = folders.filter((f) => f.member(profile)).map((f) => f.id);
    if (containing.length === 0) return;
    const anyExpanded = containing.some((id) => expanded.has(id));
    if (anyExpanded) {
      lastAutoExpandedFor.current = selectedId;
      return;
    }
    const first = firstFolderContaining(folders, profile);
    if (first == null) return;
    setExpanded((prev) => {
      if (prev.has(first)) return prev;
      const next = new Set(prev);
      next.add(first);
      return next;
    });
    lastAutoExpandedFor.current = selectedId;
    // `folders` is recomputed each render; depend on its membership signature.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, profiles, allTags]);

  const toggle = useCallback(
    (id: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [setExpanded],
  );

  return (
    <div className="profile-tree" role="tree" aria-label="Terminal profiles by tag">
      {visibleFolders.map((folder) => (
        <TagFolderRow
          key={folder.id}
          folder={folder}
          profiles={profiles}
          expanded={expanded.has(folder.id)}
          toggle={() => toggle(folder.id)}
          resolvedTheme={resolvedTheme}
          renderProfileRow={renderProfileRow}
          onStartTag={folder.isUntagged ? null : () => props.onStartTag(folder.id)}
          onStopTag={folder.isUntagged ? null : () => props.onStopTag(folder.id)}
          onRestartTag={folder.isUntagged ? null : () => props.onRestartTag(folder.id)}
        />
      ))}
    </div>
  );
}

function TagFolderRow(props: {
  folder: FolderDescriptor;
  profiles: ProfileDto[];
  expanded: boolean;
  toggle: () => void;
  resolvedTheme: ResolvedTheme;
  renderProfileRow: (p: ProfileDto, opts: { showTagPills: boolean }) => ReactNode;
  onStartTag: (() => void) | null;
  onStopTag: (() => void) | null;
  onRestartTag: (() => void) | null;
}) {
  const { folder, profiles, expanded, toggle, resolvedTheme, renderProfileRow } = props;
  const { running, total } = folderCounts(profiles, folder.member);
  const nestedListId = useId();
  const members = profiles.filter(folder.member);
  // Untagged rows show pills (= "no tag" placeholder); tagged rows hide them
  // since the folder header already names the shared tag.
  const showPillsOnNested = folder.isUntagged;

  const labelPillStyle = folder.isUntagged
    ? undefined
    : tagPillStyle(folder.label, false, resolvedTheme);

  const countLabel = folder.isUntagged
    ? `${running} of ${total} untagged terminals running`
    : `${running} of ${total} running in ${folder.label}`;

  return (
    <div
      className={`tag-folder${expanded ? " tag-folder--expanded" : ""}${folder.isUntagged ? " tag-folder--untagged" : ""}`}
      role="treeitem"
      aria-expanded={expanded}
    >
      <div className="tag-folder-row">
        <button
          type="button"
          className="tag-folder-header"
          aria-expanded={expanded}
          aria-controls={nestedListId}
          onClick={toggle}
          title={expanded ? `Collapse ${folder.label}` : `Expand ${folder.label}`}
        >
          <FolderChevronIcon expanded={expanded} />
          {folder.isUntagged ? (
            <span className="tag-folder-label tag-folder-label--untagged">{folder.label}</span>
          ) : (
            <span
              className="tag-folder-label tag-pill tag-pill--hue"
              style={labelPillStyle}
            >
              {folder.label}
            </span>
          )}
          <span
            className={`tag-folder-count-pill${running > 0 ? " tag-folder-count-pill--active" : ""}`}
            aria-label={countLabel}
            title={countLabel}
          >
            {running}/{total}
          </span>
        </button>
        {props.onStartTag || props.onStopTag || props.onRestartTag ? (
          <div className="tag-folder-actions" role="group" aria-label={`Bulk actions for ${folder.label}`}>
            {props.onStartTag ? (
              <button
                type="button"
                className="tag-folder-action tag-folder-action--start"
                onClick={props.onStartTag}
                aria-label={`Start all in tag ${folder.label}`}
                title={`Start all in ${folder.label}`}
              >
                <PlayTriangleIcon />
              </button>
            ) : null}
            {props.onStopTag ? (
              <button
                type="button"
                className="tag-folder-action tag-folder-action--stop"
                onClick={props.onStopTag}
                aria-label={`Stop all in tag ${folder.label}`}
                title={`Stop all in ${folder.label}`}
              >
                <StopSquareIcon />
              </button>
            ) : null}
            {props.onRestartTag ? (
              <button
                type="button"
                className="tag-folder-action tag-folder-action--restart"
                onClick={props.onRestartTag}
                aria-label={`Restart all in tag ${folder.label}`}
                title={`Restart all in ${folder.label}`}
              >
                <RestartLoopIcon />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {expanded ? (
        <div
          id={nestedListId}
          role="tablist"
          aria-label={`Profiles tagged ${folder.label}`}
          className="tag-folder-children"
        >
          {members.map((p) => renderProfileRow(p, { showTagPills: showPillsOnNested }))}
        </div>
      ) : null}
    </div>
  );
}
