"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

// Nothing else in the app ever applied the `dark` class, so the whole derived
// dark palette in globals.css was unreachable CSS. next-themes was already a
// dependency (ui/sonner reads useTheme from it) — this is the piece that was
// missing. `class` is the attribute the `dark` variant is defined against.
//
// LIGHT IS FORCED, deliberately. The point of the msgplane restyle is that a
// rep recognizes the screen on their first day; following the OS setting would
// have meant everyone on a dark-mode laptop landing somewhere that looks
// nothing like the system they came from. forcedTheme (rather than a light
// default) also ignores any stored preference, so nobody is stranded on dark
// by a value written before this shipped.
//
// The dark palette stays in globals.css and stays correct — when a Dark
// toggle is wanted (msgplane has one), this is a one-line change back.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" forcedTheme="light">
      {children}
    </NextThemesProvider>
  );
}
