import type { Metadata } from "next";
import { Lato } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

// msgplane's face, which it serves as "LatoWeb". Lato has no variable build, so
// the weights have to be named: 400 carries the whole app and 700 is used by a
// single label ("Notes from Shipper").
const lato = Lato({
  variable: "--font-lato",
  subsets: ["latin"],
  weight: ["400", "700"],
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
