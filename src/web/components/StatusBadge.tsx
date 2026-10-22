import { Unlink } from 'lucide-react';
import type { PairBadgeKind } from '../../lib/match-badge';
import { useT } from '@/i18n';
import { Badge, type BadgeProps } from './ui/badge';
import { statusBadgeMessages } from './StatusBadge.messages';

const VARIANT: Record<PairBadgeKind, NonNullable<BadgeProps['variant']>> = {
  synced: 'linked',
  mismatch: 'mismatch',
  ignored: 'neutral',
  orphaned: 'orphaned',
};

/** Pair status pill. The text carries the meaning; the orphaned icon is decorative. */
export function StatusBadge({ kind }: { kind: PairBadgeKind }) {
  const { t } = useT(statusBadgeMessages);
  return (
    <Badge variant={VARIANT[kind]} data-kind={kind}>
      {kind === 'orphaned' && <Unlink aria-hidden="true" className="mr-1 size-3" />}
      {t(kind)}
    </Badge>
  );
}
