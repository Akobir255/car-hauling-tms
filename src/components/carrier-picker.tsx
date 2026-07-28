"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type PickedCarrier = {
  id: string;
  name: string;
  phone: string | null;
  city: string | null;
  state: string | null;
  source: string | null;
};

// Carrier lookup against the ~4.7k directory (via /api/carriers/suggest).
// Free text is allowed — picking a suggestion additionally binds the carrier
// id and contact details; typing after a pick unbinds them.
export function CarrierPicker({
  value,
  onChange,
  onPick,
  placeholder = "Type here carrier name",
  className,
}: {
  value: string;
  onChange: (name: string) => void;
  onPick: (carrier: PickedCarrier | null) => void;
  placeholder?: string;
  className?: string;
}) {
  const [options, setOptions] = useState<PickedCarrier[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    const q = value.trim();
    let alive = true;
    // setState only inside the timer callback — never synchronously in the
    // effect body (react-hooks/set-state-in-effect is a build error here).
    const timer = setTimeout(async () => {
      if (q.length < 2) {
        if (alive) {
          setOptions([]);
          setActive(-1);
        }
        return;
      }
      try {
        const r = await fetch(`/api/carriers/suggest?q=${encodeURIComponent(q)}`);
        const d = r.ok ? await r.json() : { carriers: [] };
        if (alive) {
          setOptions(d.carriers ?? []);
          setActive(-1);
        }
      } catch {
        if (alive) setOptions([]);
      }
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [value]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pick = (c: PickedCarrier) => {
    onChange(c.name);
    onPick(c);
    setOpen(false);
    setActive(-1);
  };

  const showList = open && options.length > 0;

  return (
    <div ref={boxRef} className={cn("relative", className)}>
      <Input
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          onPick(null); // typing unbinds any picked carrier
          setOpen(true);
        }}
        onFocus={() => value.trim().length >= 2 && setOpen(true)}
        onKeyDown={(e) => {
          if (!showList) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => (i + 1) % options.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => (i <= 0 ? options.length - 1 : i - 1));
          } else if (e.key === "Enter" && active >= 0) {
            e.preventDefault();
            pick(options[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
            setActive(-1);
          }
        }}
        placeholder={placeholder}
        autoComplete="off"
        className="h-8 bg-card text-sm text-foreground"
      />
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-56 w-full min-w-64 overflow-auto rounded-md border bg-popover p-1 text-sm text-popover-foreground"
        >
          {options.map((c, i) => (
            <li key={c.id} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                tabIndex={-1}
                className={cn(
                  "block w-full rounded-md px-2 py-1 text-left hover:bg-accent hover:text-accent-foreground",
                  i === active && "bg-accent text-accent-foreground"
                )}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(c)}
              >
                <span className="block truncate">{c.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[c.phone, [c.city, c.state].filter(Boolean).join(", "), c.source?.toUpperCase()]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
