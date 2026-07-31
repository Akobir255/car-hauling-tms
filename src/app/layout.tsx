import type { Metadata } from "next";
import localFont from "next/font/local";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

// msgplane's face, which it serves as "LatoWeb". Lato has no variable build, so
// the weights have to be named: 400 carries the whole app and 700 is used by a
// single label ("Notes from Shipper").
//
// SELF-HOSTED, not next/font/google. The Google loader fetches the font at BUILD
// time, which makes every deploy depend on fonts.googleapis.com answering — it
// failed three separate times on 2026-07-31 and succeeded on retry each time,
// with a build error ("Error while requesting resource") that says nothing about
// fonts. The two files in ./fonts are the latin subsets of the exact same face,
// so nothing changes visually and a deploy no longer has a third party in it.
//
// Lato is SIL Open Font License 1.1; redistributing the files is permitted.
// To refresh: fetch the css2 URL for Lato 400/700, take the two `/* latin */`
// woff2 URLs, and replace these files.
const lato = localFont({
  variable: "--font-lato",
  display: "swap",
  src: [
    { path: "./fonts/lato-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/lato-700.woff2", weight: "700", style: "normal" },
  ],
});

// Every page names itself, and the app name trails behind it. Tabs and browser
// history truncate from the RIGHT, so what identifies the page — an order
// number, a shipper — has to come first or five open orders all read
// "Broker TMS" and you have to click each one to find out which is which.
export const metadata: Metadata = {
  title: { default: "Broker TMS", template: "%s · Broker TMS" },
  description: "Internal load, carrier, customer, and billing management.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: next-themes stamps the theme class on <html>
    // before hydration, so the server markup deliberately differs.
    <html
      lang="en"
      // No `antialiased` — see the font-smoothing note in globals.css. On
      // Windows it thins every glyph, and this team compares these screens
      // side by side with the system being replaced.
      className={`${lato.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
