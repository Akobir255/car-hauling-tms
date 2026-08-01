"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Keeps a server-rendered page current without any client data fetching:
// router.refresh() re-runs the server component, so the page's own queries and
// redactions stay the single source of what the viewer may see. Used by the
// public customer tracking page, where opening a realtime channel would mean
// handing an anonymous visitor a database connection.
export function AutoRefresh({ intervalMs = 60_000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(t);
  }, [router, intervalMs]);
  return null;
}
