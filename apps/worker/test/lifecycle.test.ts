import { describe, expect, it, vi } from "vitest";
import { createWorkerLoop } from "../src/lifecycle.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("worker loop lifecycle", () => {
  it("stops claiming new audits and waits for in-flight audits before resolving", async () => {
    const job = deferred();
    const tick = vi.fn(() => job.promise);
    let scheduled: (() => void) | undefined;
    const loop = createWorkerLoop({ tick, intervalMs: 1000, drainTimeoutMs: 5000, setTimer: (cb) => { scheduled = cb; return 1; }, clearTimer: () => undefined });
    loop.start();
    expect(tick).toHaveBeenCalledTimes(1);
    expect(loop.inFlight).toBe(1);
    const stopped = loop.stop();
    scheduled?.();
    expect(tick).toHaveBeenCalledTimes(1);
    job.resolve();
    await expect(stopped).resolves.toBe(true);
    expect(loop.inFlight).toBe(0);
  });

  it("reports a timed-out drain when an audit does not finish", async () => {
    vi.useFakeTimers();
    try {
      const loop = createWorkerLoop({ tick: () => new Promise(() => undefined), intervalMs: 1000, drainTimeoutMs: 50, setTimer: () => 1, clearTimer: () => undefined });
      loop.start();
      const stopped = loop.stop();
      await vi.advanceTimersByTimeAsync(60);
      await expect(stopped).resolves.toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it("keeps polling after a tick error", async () => {
    const onError = vi.fn();
    const loop = createWorkerLoop({ tick: () => Promise.reject(new Error("db down")), intervalMs: 1000, drainTimeoutMs: 100, onError, setTimer: () => 1, clearTimer: () => undefined });
    loop.start();
    await expect(loop.stop()).resolves.toBe(true);
    expect(onError).toHaveBeenCalledOnce();
  });
});
