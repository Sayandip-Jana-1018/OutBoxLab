"use client";

import * as React from "react";
import { API_BASE } from "@/lib/api";
import type { RealtimeEvent } from "@/lib/types";

export type ConnectionState = "connecting" | "live" | "reconnecting" | "offline";

interface UseLiveEventsOptions {
  /** Called for every event that arrives on the stream. */
  onEvent?: (event: RealtimeEvent) => void;
  /** Disable the stream entirely (e.g. before auth resolves). */
  enabled?: boolean;
}

/**
 * Subscribe to the backend's per-user SSE stream.
 *
 * The stream is same-origin - a Next.js rewrite proxies it to the API - so the
 * session cookie rides along normally. `withCredentials` stays set because it
 * costs nothing and keeps the hook correct if the base URL is ever pointed
 * straight at the backend again.
 *
 * `EventSource` reconnects on its own, but it gives no "connected" signal, so
 * this hook layers on:
 *   - an explicit connection state for the UI ("Live" / "Reconnecting"),
 *   - a bounded backoff so a dead API is not hammered,
 *   - a heartbeat watchdog: the server sends a comment every 25s, so if 45s
 *     pass with total silence we force a reconnect rather than trusting a
 *     half-open socket.
 *
 * The named events (`email.status`, `campaign.progress`, `system.window`) are
 * all delivered through a single `onEvent` callback keyed by `event.type`.
 */
export function useLiveEvents({ onEvent, enabled = true }: UseLiveEventsOptions = {}) {
  const [state, setState] = React.useState<ConnectionState>("connecting");
  const [lastEventAt, setLastEventAt] = React.useState<number>(0);

  // Keep the latest callback in a ref so re-renders don't tear down the stream.
  const onEventRef = React.useRef(onEvent);
  React.useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  React.useEffect(() => {
    if (!enabled) {
      setState("offline");
      return;
    }

    let source: EventSource | null = null;
    let retry = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let watchdog: ReturnType<typeof setInterval> | null = null;
    let lastActivity = Date.now();
    let closed = false;

    const dispatch = (raw: string) => {
      lastActivity = Date.now();
      setLastEventAt(lastActivity);
      try {
        const parsed = JSON.parse(raw) as RealtimeEvent;
        onEventRef.current?.(parsed);
      } catch {
        // Ignore malformed frames; the heartbeat keeps the connection healthy.
      }
    };

    const connect = () => {
      if (closed) return;
      setState(retry === 0 ? "connecting" : "reconnecting");

      source = new EventSource(`${API_BASE}/api/events`, { withCredentials: true });

      source.onopen = () => {
        retry = 0;
        lastActivity = Date.now();
        setState("live");
      };

      // Named events the server emits.
      for (const type of ["email.status", "campaign.progress", "system.window", "ping"]) {
        source.addEventListener(type, (ev) => dispatch((ev as MessageEvent).data));
      }
      // Fallback for any unnamed message frames.
      source.onmessage = (ev) => dispatch(ev.data);

      source.onerror = () => {
        if (closed) return;
        source?.close();
        source = null;
        setState("reconnecting");
        const delay = Math.min(1000 * 2 ** retry, 15_000);
        retry += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    connect();

    // Watchdog: 25s server heartbeat + margin. Silence past 45s => reconnect.
    watchdog = setInterval(() => {
      if (closed || !source) return;
      if (Date.now() - lastActivity > 45_000) {
        source.close();
        source = null;
        setState("reconnecting");
        const delay = Math.min(1000 * 2 ** retry, 15_000);
        retry += 1;
        reconnectTimer = setTimeout(connect, delay);
      }
    }, 10_000);

    return () => {
      closed = true;
      source?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (watchdog) clearInterval(watchdog);
    };
  }, [enabled]);

  return { state, lastEventAt };
}
