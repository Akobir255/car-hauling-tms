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

export const metadata: Metadata = {
  title: "Broker TMS",
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
      className={`${lato.variable} h-full antialiased`}
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
