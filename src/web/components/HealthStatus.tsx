import { useEffect, useState } from 'react';

type Health = 'checking' | 'ok' | 'unreachable';

const LABELS: Record<Health, string> = {
  checking: 'API: checking',
  ok: 'API: ok',
  unreachable: 'API: unreachable',
};

export function HealthStatus() {
  const [health, setHealth] = useState<Health>('checking');

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;

    void fetch('/api/health', { signal })
      .then((res) => {
        if (!res.ok) {
          throw new Error('Health check failed');
        }
        setHealth('ok');
      })
      .catch(() => {
        if (signal.aborted) {
          return;
        }
        setHealth('unreachable');
      });

    return () => {
      controller.abort();
    };
  }, []);

  return <span className="text-xs">{LABELS[health]}</span>;
}
