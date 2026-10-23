import { useT } from '@/i18n';
import { syncDashboardMessages } from '@/pages/SyncDashboard.messages';
import { ItemColumn, type ItemColumnProps } from './ItemRow';

/** Right column: unlinked Actual Budget schedules. The create action opens a modal that writes through the create route. */
export function ActualColumn(props: Omit<ItemColumnProps, 'side' | 'title' | 'createLabel'>) {
  const { t } = useT(syncDashboardMessages);
  return <ItemColumn {...props} side="actual" title={t('columns.actual')} createLabel={t('row.createInWallos')} />;
}
