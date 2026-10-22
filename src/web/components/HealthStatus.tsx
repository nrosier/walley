import { useEffect, useState } from 'react';
import { useT } from '@/i18n';
import { healthStatusMessages } from './HealthStatus.messages';

type Health = 'checking' | 'ok' | 'unreachable';

export function HealthStatus() {
  const { t } = useT(healthStatusMessages);
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

  return <span className="text-xs">{t(health)}</span>;
}
