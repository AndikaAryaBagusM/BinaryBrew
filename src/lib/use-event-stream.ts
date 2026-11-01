"use client";

import { useEffect, useEffectEvent } from "react";

// Client side of the SSE streams (Tech §7). Calls onChange for every message
// of the given event name(s) and on every (re)connect, so the page refetches and catches up on
// anything missed while the stream was down. Pages keep polling as the
// safety net; the browser reconnects by itself (server `retry:`).
export function useEventStream(
  url: string,
  events: string | readonly string[],
  onChange: () => void,
) {
  const changed = useEffectEvent(onChange);
  const names = typeof events === "string" ? events : events.join(" ");
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const source = new EventSource(url);
    const handle = () => changed();
    for (const name of names.split(" ")) source.addEventListener(name, handle);
    source.addEventListener("open", handle);
    return () => source.close();
  }, [url, names]);
}
