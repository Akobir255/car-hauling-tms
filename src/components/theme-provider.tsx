"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

// Nothing else in the app ever applied the `dark` class, so the whole derived
// dark palette in globals.css was unreachable CSS. next-themes was already a
// dependency (ui/sonner reads useTheme from it) — this is the piece that was
// missing. `class` is the attribute the `dark` variant is defined against.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem>
      {children}
    </NextThemesProvider>
  );
}
