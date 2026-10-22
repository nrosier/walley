import { useT } from '@/i18n';
import { syncDashboardMessages } from '@/pages/SyncDashboard.messages';
import { ItemColumn, type ItemColumnProps } from './ItemRow';

/** Left column: unlinked Wallos subscriptions. The create action is held until M8. */
export function WallosColumn(props: Omit<ItemColumnProps, 'side' | 'title' | 'createLabel'>) {
  const { t } = useT(syncDashboardMessages);
  return <ItemColumn {...props} side="wallos" title={t('columns.wallos')} createLabel={t('row.createInActual')} />;
}
