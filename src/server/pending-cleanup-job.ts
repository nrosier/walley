import type { AppDatabase } from './db/client.js';
import { deleteExpiredPendingRegistrations } from './db/pending-cleanup.js';
import { VERIFICATION_TOKEN_TTL_MS } from './mail/index.js';

/** How often abandoned registrations are removed. */
export const PENDING_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Runs the pending-registration cleanup once now and then on an interval. The timer is unref'd, so
 * it never keeps the process open. Returns a function that stops it. A failure is logged with
 * fixed text and never stops the schedule.
 */
export function startPendingCleanup(
  db: AppDatabase,
  options: {
    readonly now?: () => number;
    readonly intervalMs?: number;
    readonly onError?: () => void;
  } = {},
): () => void {
  const now = options.now ?? Date.now;
  const run = (): void => {
    try {
      deleteExpiredPendingRegistrations(db, new Date(now()), VERIFICATION_TOKEN_TTL_MS);
    } catch {
      // Fixed text: a database error can quote row data.
      if (options.onError === undefined) {
        console.error('Pending registration cleanup failed.');
      } else {
        options.onError();
      }
    }
  };
  run();
  const timer = setInterval(run, options.intervalMs ?? PENDING_CLEANUP_INTERVAL_MS);
  timer.unref();
  return () => {
    clearInterval(timer);
  };
}
