"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The driver's screen. One job: post where the truck is, every few minutes,
// with no login and no app store.
//
// Everything here assumes a phone in a moving vehicle on bad signal: failures
// are normal and are shown plainly rather than as errors. A fix that cannot be
// posted is BUFFERED in localStorage with its original recorded_at — the
// ingest route accepts up to 24 hours of backdating for exactly this — and
// drained one per cycle once the signal returns, capped at QUEUE_MAX with the
// oldest dropped first.
//
// What no browser can do is track from a locked phone. A screen wake lock
// keeps the display on while the page is visible, and the copy below says the
// honest thing out loud: tracking stops when the screen is off.

const PING_INTERVAL_MS = 3 * 60_000; // inside the brief's 2-5 minutes
const GEO_TIMEOUT_MS = 30_000;
/** Buffered fixes kept per token. ~2.5 hours of no-signal driving. */
const QUEUE_MAX = 50;
/**
 * Must match MAX_BACKDATE_MS in the ingest route: a fix older than this would
 * be clamped to "now" server-side, posting a stale position as current — worse
 * than dropping it.
 */
const QUEUE_MAX_AGE_MS = 24 * 60 * 60_000;
/**
 * The server accepts at most one ping per 25s (MIN_PING_INTERVAL_MS in the
 * route), so a drained fix cannot ride immediately behind the fresh one — it
 * waits this long, which still finishes well inside the 3-minute cycle.
 */
const DRAIN_DELAY_MS = 30_000;

type Status = "starting" | "sharing" | "denied" | "unavailable" | "stopped";

type QueuedFix = {
  lat: number;
  lng: number;
  accuracy_m: number | null;
  recorded_at: string;
};

type PingOutcome = "ok" | "gone" | "too_fast" | "bad" | "failed";

// The key is scoped by token so two orders tracked from one phone (a new link
// after a re-dispatch, say) never mix their backlogs.
const queueKey = (token: string) => `track_queue:${token}`;

function readQueue(token: string): QueuedFix[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(queueKey(token)) ?? "[]");
    return Array.isArray(parsed) ? (parsed as QueuedFix[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(token: string, fixes: QueuedFix[]): void {
  try {
    localStorage.setItem(queueKey(token), JSON.stringify(fixes));
  } catch {
    // Private mode or full storage: tracking still works, buffering doesn't.
  }
}

/** Drop what the server would refuse or clamp, then cap — oldest goes first. */
function pruneQueue(fixes: QueuedFix[]): QueuedFix[] {
  const cutoff = Date.now() - QUEUE_MAX_AGE_MS;
  return fixes
    .filter((f) => new Date(f.recorded_at).getTime() > cutoff)
    .slice(-QUEUE_MAX);
}

export function DriverTracker({ token, loadNumber }: { token: string; loadNumber: string }) {
  const [status, setStatus] = useState<Status>("starting");
  const [lastSent, setLastSent] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);
  // Effects must not setState during render and refs must not be written during
  // it either (both are lint ERRORS here). Every write below happens inside a
  // callback or a timer, which is where they belong anyway.
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const drainRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const stoppedRef = useRef(false);

  const acquireWakeLock = useCallback(() => {
    // Feature-detected: older Safari and some Android browsers don't have it.
    // Without it tracking still works — until the screen locks, which is what
    // the instruction under the card is for.
    if (!("wakeLock" in navigator) || stoppedRef.current) return;
    navigator.wakeLock.request("screen").then(
      (sentinel) => {
        wakeLockRef.current = sentinel;
      },
      () => {
        // Low battery or browser policy said no. Nothing to do about it.
      }
    );
  }, []);

  const releaseWakeLock = useCallback(() => {
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  }, []);

  const stopSharing = useCallback(
    (message: string) => {
      stoppedRef.current = true;
      setStatus("stopped");
      setLastError(message);
      if (timerRef.current) clearInterval(timerRef.current);
      if (drainRef.current) clearTimeout(drainRef.current);
      releaseWakeLock();
    },
    [releaseWakeLock]
  );

  const sendPing = useCallback(
    async (fix: QueuedFix): Promise<PingOutcome> => {
      try {
        const res = await fetch(`/api/track/${encodeURIComponent(token)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(fix),
        });
        if (res.ok) return "ok";
        if (res.status === 410) return "gone";
        if (res.status === 429) return "too_fast";
        if (res.status === 400) return "bad";
        return "failed";
      } catch {
        // Offline in a canyon is the normal case, not an exception.
        return "failed";
      }
    },
    [token]
  );

  // One buffered fix per cycle, oldest first. Sent and unsendable entries
  // leave the queue; a rate-limited or still-offline one stays for next time.
  const drainOne = useCallback(async () => {
    const queue = pruneQueue(readQueue(token));
    writeQueue(token, queue);
    setQueuedCount(queue.length);
    if (!queue.length) return;

    const outcome = await sendPing(queue[0]);
    if (outcome === "gone") {
      stopSharing("This link is no longer active. Ask dispatch for a new one.");
      return;
    }
    if (outcome === "ok" || outcome === "bad") {
      const rest = pruneQueue(readQueue(token)).slice(1);
      writeQueue(token, rest);
      setQueuedCount(rest.length);
    }
  }, [sendPing, stopSharing, token]);

  const scheduleDrain = useCallback(() => {
    if (drainRef.current) clearTimeout(drainRef.current);
    drainRef.current = setTimeout(() => {
      void drainOne();
    }, DRAIN_DELAY_MS);
  }, [drainOne]);

  const postFix = useCallback(
    async (pos: GeolocationPosition) => {
      const fix: QueuedFix = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy_m: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
        recorded_at: new Date(pos.timestamp).toISOString(),
      };
      setSending(true);
      const outcome = await sendPing(fix);
      setSending(false);

      if (outcome === "gone") {
        // The job is over or the link was replaced. Stop rather than posting
        // into the void for the rest of the day.
        stopSharing("This link is no longer active. Ask dispatch for a new one.");
        return;
      }
      if (outcome === "failed") {
        // Couldn't reach dispatch. The fix is NOT thrown away: it keeps its
        // original recorded_at and goes out when the signal returns.
        const queue = pruneQueue([...readQueue(token), fix]);
        writeQueue(token, queue);
        setQueuedCount(queue.length);
        setLastError("No signal — saved. It will send when coverage returns.");
        return;
      }
      // ok / too_fast / bad — the cycle did its job; a queued backlog can now
      // start going out behind it.
      setLastError(null);
      setLastSent(new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }));
      scheduleDrain();
    },
    [scheduleDrain, sendPing, stopSharing, token]
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
    const first = setTimeout(() => {
      setQueuedCount(pruneQueue(readQueue(token)).length);
      readAndSend();
    }, 0);
    const id = setInterval(readAndSend, PING_INTERVAL_MS);
    timerRef.current = id;
    return () => {
      clearTimeout(first);
      clearInterval(id);
      if (drainRef.current) clearTimeout(drainRef.current);
    };
  }, [readAndSend, token]);

  useEffect(() => {
    // The wake lock is what keeps the screen — and therefore the timer — alive.
    // The browser silently releases it whenever the page is hidden, so coming
    // back to the tab must take it out again, and that moment is also the right
    // one for an immediate fix: interval timers were throttled while hidden.
    acquireWakeLock();
    const onVisibility = () => {
      if (document.visibilityState !== "visible" || stoppedRef.current) return;
      acquireWakeLock();
      readAndSend();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      releaseWakeLock();
    };
  }, [acquireWakeLock, readAndSend, releaseWakeLock]);

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
          {queuedCount > 0 && (
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Waiting for signal</dt>
              <dd className="tabular-nums">{queuedCount}</dd>
            </div>
          )}
        </dl>

        {lastError && <p className="mt-3 text-sm text-destructive">{lastError}</p>}
      </div>

      {status !== "stopped" && (
        <p className="text-sm font-medium">
          Keep this screen on and the phone plugged in — tracking stops when the screen is off.
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        This link shares your location with the broker for this order only, and stops working when
        the order is delivered.
      </p>
    </div>
  );
}
