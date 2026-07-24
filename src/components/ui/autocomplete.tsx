"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

// A free-text input with async suggestions. The value is always what's typed —
// suggestions just help fill it (make/model), they don't constrain it. Debounced;
// fetchOptions is read through a ref so parent re-renders don't reset the timer.
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
  const boxRef = useRef<HTMLDivElement>(null);
  const fetchRef = useRef(fetchOptions);
  fetchRef.current = fetchOptions;

  useEffect(() => {
    const q = value.trim();
    let active = true;
    // All state updates happen inside the timer (deferred), not synchronously
    // in the effect body.
    const timer = setTimeout(async () => {
      if (q.length < 2) {
        if (active) setOptions([]);
        return;
      }
      try {
        const opts = await fetchRef.current(q);
        if (active) setOptions(opts);
      } catch {
        if (active) setOptions([]);
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

  return (
    <div ref={boxRef} className="relative">
      <Input
        {...inputProps}
        value={value}
        onChange={(e) => {
          onValueChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => value.trim().length >= 2 && setOpen(true)}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
      />
      {open && options.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-52 w-full overflow-auto rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10">
          {options.map((opt) => (
            <li key={opt}>
              <button
                type="button"
                className="block w-full truncate rounded px-2 py-1 text-left hover:bg-accent hover:text-accent-foreground"
                onClick={() => {
                  onValueChange(opt);
                  setOpen(false);
                }}
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
