"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The driver's screen. One job: post where the truck is, every few minutes,
// with no login and no app store.
//
// Everything here assumes a phone in a moving vehicle on bad signal: failures
// are normal, they are shown plainly rather than as errors, and nothing is
// thrown away when a post fails — the next fix simply goes out later.

const PING_INTERVAL_MS = 3 * 60_000; // inside the brief's 2-5 minutes
const GEO_TIMEOUT_MS = 30_000;

type Status = "starting" | "sharing" | "denied" | "unavailable" | "stopped";

export function DriverTracker({ token, loadNumber }: { token: string; loadNumber: string }) {
  const [status, setStatus] = useState<Status>("starting");
  const [lastSent, setLastSent] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // Effects must not setState during render and refs must not be written during
  // it either (both are lint ERRORS here). Every write below happens inside a
  // callback or a timer, which is where they belong anyway.
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const postFix = useCallback(
    async (pos: GeolocationPosition) => {
      setSending(true);
      try {
        const res = await fetch(`/api/track/${encodeURIComponent(token)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy_m: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
            recorded_at: new Date(pos.timestamp).toISOString(),
          }),
        });
        if (res.status === 410) {
          // The job is over or the link was replaced. Stop the timer rather
          // than posting into the void for the rest of the day.
          setStatus("stopped");
          setLastError("This link is no longer active. Ask dispatch for a new one.");
          if (timerRef.current) clearInterval(timerRef.current);
          return;
        }
        if (!res.ok && res.status !== 429) {
          setLastError("Couldn't reach dispatch — will retry.");
          return;
        }
        setLastError(null);
        setLastSent(new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }));
      } catch {
        // Offline in a canyon is the normal case, not an exception.
        setLastError("No signal — will retry.");
      } finally {
        setSending(false);
      }
    },
    [token]
  );

  const readAndSend = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setStatus("unavailable");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setStatus("sharing");
        void postFix(pos);
      },
      (err) => {
        setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable");
      },
      { enableHighAccuracy: true, timeout: GEO_TIMEOUT_MS, maximumAge: 60_000 }
    );
  }, [postFix]);

  useEffect(() => {
    // The first read is deferred into a timer rather than called here:
    // readAndSend can set state synchronously (a device with no geolocation at
    // all), and react-hooks/set-state-in-effect is a build-failing error in
    // this project. A timer callback is the sanctioned place for it.
    const first = setTimeout(readAndSend, 0);
    const id = setInterval(readAndSend, PING_INTERVAL_MS);
    timerRef.current = id;
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [readAndSend]);

  return (
    <div className="mx-auto max-w-md space-y-6 p-5">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">Order</p>
        <h1 className="text-2xl font-bold tabular-nums">{loadNumber}</h1>
      </header>

      <div className="rounded-md border p-5">
        {status === "sharing" && (
          <>
            <p className="text-lg font-bold text-[#2e7d32] dark:text-[#81c784]">
              Location sharing is on
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Keep this page open while you drive. It sends your position every few minutes.
            </p>
          </>
        )}
        {status === "starting" && <p className="text-lg">Starting…</p>}
        {status === "denied" && (
          <>
            <p className="text-lg font-bold text-destructive">Location is blocked</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Allow location for this site in your browser settings, then reload this page.
            </p>
          </>
        )}
        {status === "unavailable" && (
          <>
            <p className="text-lg font-bold text-destructive">Can&apos;t read your location</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Turn on location services, then reload this page.
            </p>
          </>
        )}
        {status === "stopped" && (
          <p className="text-lg font-bold text-muted-foreground">Sharing stopped</p>
        )}

        <dl className="mt-4 space-y-1 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Last sent</dt>
            <dd className="tabular-nums">{sending ? "sending…" : (lastSent ?? "—")}</dd>
          </div>
        </dl>

        {lastError && <p className="mt-3 text-sm text-destructive">{lastError}</p>}
      </div>

      <p className="text-xs text-muted-foreground">
        This link shares your location with the broker for this order only, and stops working when
        the order is delivered.
      </p>
    </div>
  );
}
