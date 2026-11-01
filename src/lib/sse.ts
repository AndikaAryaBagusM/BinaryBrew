// Server-Sent Events responses (Tech §7). Server only.

export const SSE_RETRY_MS = 3_000; // browser reconnect delay
const HEARTBEAT_MS = 20_000; // keeps proxies from closing an idle stream

export type SseSend = (event: string, data: unknown) => void;
type Cleanup = () => void | Promise<void>;

// Streams events until the client disconnects (signal) or the stream is
// cancelled; then the cleanup returned by start runs once.
export function sseResponse(
  signal: AbortSignal,
  start: (send: SseSend) => Promise<Cleanup>,
): Response {
  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let cleanup: Cleanup | undefined;
  let closed = false;

  const stop = async () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    await cleanup?.();
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          void stop();
        }
      };
      write(`retry: ${SSE_RETRY_MS}\n\n`);
      heartbeat = setInterval(() => write(": heartbeat\n\n"), HEARTBEAT_MS);
      const onAbort = () => {
        void stop().then(() => {
          try {
            controller.close();
          } catch {
            // Already closed.
          }
        });
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
      cleanup = await start((event, data) =>
        write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
      );
      // Disconnected while starting: stop ran before there was a cleanup.
      if (closed) await cleanup();
    },
    cancel: stop,
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
