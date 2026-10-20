import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerShutdown, type SignalSource } from './shutdown.js';

type Listener = () => void;

function stubProc(): { proc: SignalSource; fire: (signal: string) => void; counts: () => Record<string, number> } {
  const listeners = new Map<string, Listener[]>();
  return {
    proc: {
      on(signal, listener) {
        listeners.set(signal, [...(listeners.get(signal) ?? []), listener]);
        return undefined;
      },
    },
    fire(signal) {
      for (const listener of listeners.get(signal) ?? []) {
        listener();
      }
    },
    counts() {
      return Object.fromEntries([...listeners].map(([k, v]) => [k, v.length]));
    },
  };
}

function stubApp(close: () => Promise<void>): FastifyInstance {
  return {
    close,
    log: { info: vi.fn(), error: vi.fn() },
  } as unknown as FastifyInstance;
}

describe('registerShutdown', () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('registers SIGTERM and SIGINT once each', () => {
    const { proc, counts } = stubProc();
    registerShutdown(stubApp(() => Promise.resolve()), { proc });
    expect(counts()).toEqual({ SIGTERM: 1, SIGINT: 1 });
  });

  it('closes the app once and sets exit code 0 on SIGTERM', async () => {
    const close = vi.fn(() => Promise.resolve());
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const { proc, fire } = stubProc();
    process.exitCode = 5;
    registerShutdown(stubApp(close), { proc });

    fire('SIGTERM');
    fire('SIGINT');
    await vi.waitFor(() => {
      expect(process.exitCode).toBe(0);
    });

    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();
  });

  it('exits 1 from the watchdog when close hangs', () => {
    vi.useFakeTimers();
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const { proc, fire } = stubProc();
    registerShutdown(stubApp(() => new Promise<void>(() => undefined)), { proc, timeoutMs: 50 });

    fire('SIGTERM');
    expect(exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(49);
    expect(exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('does not fire the watchdog after a normal close', async () => {
    vi.useFakeTimers();
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const { proc, fire } = stubProc();
    registerShutdown(stubApp(() => Promise.resolve()), { proc, timeoutMs: 50 });

    fire('SIGINT');
    await vi.advanceTimersByTimeAsync(100);
    expect(exit).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });
});
