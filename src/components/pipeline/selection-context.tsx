"use client";

import { createContext, useCallback, useContext, useState } from "react";

type SelectionCtx = {
  selected: Set<string>;
  toggle: (id: string) => void;
  setMany: (ids: string[], on: boolean) => void;
  clear: () => void;
};

const Ctx = createContext<SelectionCtx | null>(null);

// Wraps the pipeline table + bulk bar so the row checkboxes and the action
// bar share one selection set. Client provider; the server-rendered table
// passes straight through as children.
export function SelectionProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setMany = useCallback((ids: string[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  return <Ctx.Provider value={{ selected, toggle, setMany, clear }}>{children}</Ctx.Provider>;
}

export function useSelection(): SelectionCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSelection must be used inside <SelectionProvider>");
  return ctx;
}
