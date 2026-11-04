export interface WorkerLoopOptions {
  /** Claims and runs at most one audit. Resolves once that audit is finished or none was queued. */
  tick: () => Promise<void>;
  intervalMs: number;
  /** How long shutdown waits for in-flight audits before giving up. */
  drainTimeoutMs: number;
  onError?: (error: unknown) => void;
  setTimer?: (callback: () => void, ms: number) => { unref?: () => void } | number;
  clearTimer?: (timer: unknown) => void;
}

export interface WorkerLoop {
  start(): void;
  /** Stops claiming new audits and waits for in-flight ones. Returns false if the drain timed out. */
  stop(): Promise<boolean>;
  readonly inFlight: number;
  readonly stopping: boolean;
}

/** Persistent polling loop. Each tick may start one audit; in-flight audits are tracked so shutdown can drain them. */
export function createWorkerLoop(options: WorkerLoopOptions): WorkerLoop {
  const running = new Set<Promise<void>>();
  const setTimer = options.setTimer ?? ((callback: () => void, ms: number) => setInterval(callback, ms));
  const clearTimer = options.clearTimer ?? ((timer: unknown) => clearInterval(timer as ReturnType<typeof setInterval>));
  let timer: unknown = null;
  let stopping = false;

  const tick = () => {
    if (stopping) return;
    const job = options.tick().catch((error: unknown) => options.onError?.(error)).finally(() => running.delete(job));
    running.add(job);
  };

  return {
    get inFlight() { return running.size; },
    get stopping() { return stopping; },
    start() {
      if (timer !== null || stopping) return;
      tick();
      timer = setTimer(tick, options.intervalMs);
    },
    async stop() {
      stopping = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const drained = await Promise.race([
        Promise.allSettled([...running]).then(() => true),
        new Promise<boolean>((resolve) => { timeout = setTimeout(() => resolve(false), options.drainTimeoutMs); }),
      ]);
      if (timeout) clearTimeout(timeout);
      return drained;
    },
  };
}
