"use client";

import * as React from "react";
import { useLiveEvents, type ConnectionState } from "@/hooks/useLiveEvents";
import type { RealtimeEvent } from "@/lib/types";

interface LiveContextValue {
  state: ConnectionState;
  /** Register a listener; returns an unsubscribe function. */
  subscribe: (listener: (event: RealtimeEvent) => void) => () => void;
}

const LiveContext = React.createContext<LiveContextValue | undefined>(undefined);

/**
 * One SSE connection for the whole dashboard.
 *
 * Every page that wants realtime updates registers a listener here instead of
 * opening its own `EventSource`. Browsers cap concurrent connections per
 * origin, so a per-page stream would exhaust that budget quickly and each
 * navigation would pay a fresh handshake.
 */
export function LiveProvider({
  children,
  enabled = true,
}: {
  children: React.ReactNode;
  enabled?: boolean;
}) {
  const listeners = React.useRef(new Set<(event: RealtimeEvent) => void>());

  const handleEvent = React.useCallback((event: RealtimeEvent) => {
    listeners.current.forEach((listener) => {
      try {
        listener(event);
      } catch {
        // One broken listener must not stop the others.
      }
    });
  }, []);

  const { state } = useLiveEvents({ onEvent: handleEvent, enabled });

  const subscribe = React.useCallback((listener: (event: RealtimeEvent) => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const value = React.useMemo(() => ({ state, subscribe }), [state, subscribe]);

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveContextValue {
  const ctx = React.useContext(LiveContext);
  if (!ctx) throw new Error("useLive must be used within a LiveProvider");
  return ctx;
}

/**
 * Subscribe to the realtime stream for the lifetime of a component.
 * The callback is held in a ref so it can close over fresh state without
 * re-subscribing on every render.
 */
export function useLiveSubscription(listener: (event: RealtimeEvent) => void): ConnectionState {
  const { subscribe, state } = useLive();
  const ref = React.useRef(listener);

  React.useEffect(() => {
    ref.current = listener;
  }, [listener]);

  React.useEffect(() => subscribe((event) => ref.current(event)), [subscribe]);

  return state;
}
