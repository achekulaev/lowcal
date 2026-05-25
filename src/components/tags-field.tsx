import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ClipboardEvent, KeyboardEvent } from "react";
import type { ResolvedTheme } from "../settings/global-settings";
import { tagPillStyle } from "../utils/tag-pills";
import { tagsFromCommaString } from "../utils/profile-form";

/**
 * Chip-based tag editor. Selected tags render as coloured pills (using the
 * same `tagPillStyle` as the sidebar) inside a single bordered field, with a
 * `+ New tag` typing input and a filtered autocomplete dropdown of `allTags`
 * the user hasn't already added.
 *
 * Typing accepts brand-new tags via Enter / comma / blur — the dropdown is a
 * convenience for reusing tags that already exist on other profiles.
 */
export function TagsField(props: {
  id: string;
  value: string[];
  onChange: (next: string[]) => void;
  allTags: string[];
  theme: ResolvedTheme;
}) {
  const { id, value, onChange, allTags, theme } = props;

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();

  const selectedSet = useMemo(() => new Set(value), [value]);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allTags.filter((t) => {
      if (selectedSet.has(t)) return false;
      if (q.length === 0) return true;
      return t.toLowerCase().startsWith(q);
    });
  }, [allTags, selectedSet, query]);

  useEffect(() => {
    if (activeIndex >= suggestions.length) setActiveIndex(suggestions.length - 1);
  }, [suggestions.length, activeIndex]);

  const addTags = useCallback(
    (incoming: string[]) => {
      if (incoming.length === 0) return;
      const seen = new Set(value);
      const next = [...value];
      for (const raw of incoming) {
        const t = raw.trim();
        if (!t) continue;
        if (seen.has(t)) continue;
        seen.add(t);
        next.push(t);
      }
      if (next.length !== value.length) onChange(next);
    },
    [value, onChange],
  );

  const removeAt = useCallback(
    (index: number) => {
      if (index < 0 || index >= value.length) return;
      const next = value.slice(0, index).concat(value.slice(index + 1));
      onChange(next);
    },
    [value, onChange],
  );

  const commitDraft = useCallback(() => {
    const draft = query;
    setQuery("");
    setActiveIndex(-1);
    if (draft.includes(",")) {
      addTags(tagsFromCommaString(draft));
    } else {
      addTags([draft]);
    }
  }, [query, addTags]);

  const pickSuggestion = useCallback(
    (tag: string) => {
      addTags([tag]);
      setQuery("");
      setActiveIndex(-1);
      inputRef.current?.focus();
    },
    [addTags],
  );

  useEffect(() => {
    if (!open) return;
    function handleDocMouseDown(e: MouseEvent) {
      const wrap = wrapRef.current;
      if (!wrap) return;
      if (e.target instanceof Node && wrap.contains(e.target)) return;
      setOpen(false);
      setActiveIndex(-1);
    }
    document.addEventListener("mousedown", handleDocMouseDown);
    return () => document.removeEventListener("mousedown", handleDocMouseDown);
  }, [open]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      if (open && activeIndex >= 0 && activeIndex < suggestions.length) {
        e.preventDefault();
        pickSuggestion(suggestions[activeIndex]);
        return;
      }
      if (query.trim().length > 0) {
        e.preventDefault();
        commitDraft();
      }
      return;
    }
    if (e.key === ",") {
      if (query.trim().length > 0) {
        e.preventDefault();
        commitDraft();
      }
      return;
    }
    if (e.key === "Backspace") {
      if (query.length === 0 && value.length > 0) {
        e.preventDefault();
        removeAt(value.length - 1);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      if (suggestions.length === 0) return;
      e.preventDefault();
      setOpen(true);
      setActiveIndex((idx) => (idx + 1) % suggestions.length);
      return;
    }
    if (e.key === "ArrowUp") {
      if (suggestions.length === 0) return;
      e.preventDefault();
      setOpen(true);
      setActiveIndex((idx) =>
        idx <= 0 ? suggestions.length - 1 : idx - 1,
      );
      return;
    }
    if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
        setActiveIndex(-1);
      }
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (!text.includes(",") && !text.includes("\n")) return;
    e.preventDefault();
    const parsed = tagsFromCommaString(text.replace(/\n+/g, ","));
    if (parsed.length > 0) {
      addTags(parsed);
      setQuery("");
      setActiveIndex(-1);
    }
  };

  const onBlur = () => {
    if (query.trim().length > 0) commitDraft();
  };

  return (
    <div className="tags-field-wrap" ref={wrapRef}>
      <div className="tags-field-input-row">
        <input
          ref={inputRef}
          id={id}
          type="text"
          className="tags-field__input"
          value={query}
          placeholder="+ New tag"
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={open && suggestions.length > 0}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && activeIndex >= 0 && activeIndex < suggestions.length
              ? `${listboxId}-opt-${activeIndex}`
              : undefined
          }
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
        {open && suggestions.length > 0 && (
          <ul
            id={listboxId}
            role="listbox"
            className="tags-field__suggestions"
            onMouseDown={(e) => e.preventDefault()}
          >
            {suggestions.map((t, i) => (
              <li
                key={t}
                id={`${listboxId}-opt-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                className={
                  "tags-field__suggestion" +
                  (i === activeIndex ? " tags-field__suggestion--active" : "")
                }
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => pickSuggestion(t)}
              >
                <span
                  className="tag-pill tag-pill--hue"
                  style={tagPillStyle(t, false, theme)}
                >
                  {t}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {value.length > 0 && (
        <div className="tags-field__chips">
          {value.map((t, i) => (
            <span
              key={`${t}\u0000${i}`}
              className="tags-field__chip tag-pill tag-pill--hue"
              style={tagPillStyle(t, false, theme)}
            >
              <span className="tags-field__chip-label">{t}</span>
              <button
                type="button"
                className="tags-field__chip-remove"
                aria-label={`Remove tag ${t}`}
                onClick={() => {
                  removeAt(i);
                  inputRef.current?.focus();
                }}
                onMouseDown={(e) => e.preventDefault()}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
