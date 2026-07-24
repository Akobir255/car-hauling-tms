"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// A free-text input with async suggestions. The value is always what's typed —
// suggestions just help fill it (make/model), they don't constrain it.
// Debounced; full keyboard support (arrows/Enter/Escape) and combobox ARIA.
export function Autocomplete({
  value,
  onValueChange,
  fetchOptions,
  placeholder,
  className,
  inputProps,
}: {
  value: string;
  onValueChange: (v: string) => void;
  fetchOptions: (query: string) => Promise<string[]>;
  placeholder?: string;
  className?: string;
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<string[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  // Kept in a ref (updated in an effect, not during render) so parent
  // re-renders with a new fetchOptions closure don't reset the debounce.
  const fetchRef = useRef(fetchOptions);
  useEffect(() => {
    fetchRef.current = fetchOptions;
  }, [fetchOptions]);

  useEffect(() => {
    const q = value.trim();
    let active = true;
    // All state updates happen inside the timer (deferred), not synchronously
    // in the effect body.
    const timer = setTimeout(async () => {
      if (q.length < 2) {
        if (active) {
          setOptions([]);
          setActiveIndex(-1);
        }
        return;
      }
      try {
        const opts = await fetchRef.current(q);
        if (active) {
          setOptions(opts);
          setActiveIndex(-1);
        }
      } catch {
        if (active) {
          setOptions([]);
          setActiveIndex(-1);
        }
      }
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [value]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const select = (opt: string) => {
    onValueChange(opt);
    setOpen(false);
    setActiveIndex(-1);
  };

  const showList = open && options.length > 0;

  return (
    <div ref={boxRef} className="relative">
      <Input
        {...inputProps}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        aria-autocomplete="list"
        value={value}
        onChange={(e) => {
          onValueChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => value.trim().length >= 2 && setOpen(true)}
        onKeyDown={(e) => {
          if (!showList) {
            if (e.key === "ArrowDown" && options.length > 0) {
              e.preventDefault();
              setOpen(true);
              setActiveIndex(0);
            }
            return;
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIndex((i) => (i + 1) % options.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((i) => (i <= 0 ? options.length - 1 : i - 1));
          } else if (e.key === "Enter") {
            // Only intercept Enter while a suggestion is highlighted, so the
            // form's normal Enter behavior is otherwise untouched.
            if (activeIndex >= 0) {
              e.preventDefault();
              select(options[activeIndex]);
            }
          } else if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
            setActiveIndex(-1);
          }
        }}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
      />
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-52 w-full overflow-auto rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10"
        >
          {options.map((opt, i) => (
            <li key={opt} id={`${listId}-${i}`} role="option" aria-selected={i === activeIndex}>
              <button
                type="button"
                tabIndex={-1}
                className={cn(
                  "block w-full truncate rounded px-2 py-1 text-left hover:bg-accent hover:text-accent-foreground",
                  i === activeIndex && "bg-accent text-accent-foreground"
                )}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => select(opt)}
              >
                {opt}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
