"use client";

import { useEffect, useEffectEvent } from "react";

// Client side of the SSE streams (Tech §7). Calls onChange for every `event`
// message and on every (re)connect, so the page refetches and catches up on
// anything missed while the stream was down. Pages keep polling as the
// safety net; the browser reconnects by itself (server `retry:`).
export function useEventStream(
  url: string,
  event: string,
  onChange: () => void,
) {
  const changed = useEffectEvent(onChange);
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const source = new EventSource(url);
    const handle = () => changed();
    source.addEventListener(event, handle);
    source.addEventListener("open", handle);
    return () => source.close();
  }, [url, event]);
}
