import { useEffect, useRef, useState } from "react";
import type { ModalMode } from "../types/ui";

export function useSidebarFilter(modalMode: ModalMode) {
  const [query, setQuery] = useState("");
  const [sidebarFilterOpen, setSidebarFilterOpen] = useState(false);
  const sidebarFilterInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!sidebarFilterOpen) return;
    const id = requestAnimationFrame(() => sidebarFilterInputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [sidebarFilterOpen]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      if (e.key !== "f" && e.key !== "F") return;
      if (modalMode) return;
      e.preventDefault();
      setSidebarFilterOpen(true);
      requestAnimationFrame(() => sidebarFilterInputRef.current?.focus());
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [modalMode]);

  return {
    query,
    setQuery,
    sidebarFilterOpen,
    setSidebarFilterOpen,
    sidebarFilterInputRef,
  };
}
