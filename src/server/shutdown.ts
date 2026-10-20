import type { FastifyInstance } from 'fastify';

type Signal = 'SIGTERM' | 'SIGINT';

/** The part of `process` that registerShutdown needs. Tests pass a stub. */
export interface SignalSource {
  on(signal: Signal, listener: () => void): unknown;
}

export interface ShutdownOptions {
  readonly proc?: SignalSource;
  /** Time to wait for app.close() before forcing exit 1. Default 8000. */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 8000;

export function registerShutdown(app: FastifyInstance, opts?: ShutdownOptions): void {
  const proc = opts?.proc ?? process;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let shuttingDown = false;

  const handle = (signal: Signal): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');

    const watchdog = setTimeout(() => {
      app.log.error({ timeoutMs }, 'shutdown timed out, forcing exit');
      process.exit(1);
    }, timeoutMs);
    watchdog.unref();

    app.close().then(
      () => {
        clearTimeout(watchdog);
        process.exitCode = 0;
      },
      (error: unknown) => {
        clearTimeout(watchdog);
        app.log.error(error, 'error while closing');
        process.exitCode = 1;
      },
    );
  };

  proc.on('SIGTERM', () => {
    handle('SIGTERM');
  });
  proc.on('SIGINT', () => {
    handle('SIGINT');
  });
}
