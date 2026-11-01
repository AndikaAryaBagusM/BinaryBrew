// Runs a task now and then every interval, never two runs at once: the next
// run is scheduled only after the current one ends. A failing run is passed
// to onError and the loop goes on.

export type Repeating = { stop: () => Promise<void> };

export function startRepeating(
  task: () => Promise<void>,
  intervalMs: number,
  { onError }: { onError: (error: unknown) => void },
): Repeating {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> = Promise.resolve();

  const run = () => {
    running = task()
      .catch(onError)
      .finally(() => {
        if (!stopped) timer = setTimeout(run, intervalMs);
      });
  };
  timer = setTimeout(run, 0);

  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await running;
    },
  };
}
