import { X } from 'lucide-react';
import { useT } from '@/i18n';
import { noticeStore, useNotices, type Notice, type NoticeStore } from '@/lib/notices';
import { Alert } from '../ui/alert';
import { Button } from '../ui/button';
import { createModalMessages } from './CreateModal.messages';

export interface NoticeToastViewProps {
  notices: readonly Notice[];
  onDismiss: (id: number) => void;
}

/** Dismissible notices at the bottom right of the dashboard. Not a dialog: nothing is blocked and focus is not moved. */
export function NoticeToastView({ notices, onDismiss }: NoticeToastViewProps) {
  const { t } = useT(createModalMessages);
  if (notices.length === 0) return null;
  return (
    <div data-slot="notice-toast" className="fixed right-4 bottom-4 left-4 z-[60] grid gap-2 sm:left-auto sm:w-96">
      {notices.map((n) => (
        <div key={n.id} className="flex items-start gap-1 rounded-md bg-card shadow-md">
          <Alert variant="info" className="flex-1">
            {t(`notice.${n.kind}`)}
          </Alert>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('notice.dismiss')}
            onClick={() => {
              onDismiss(n.id);
            }}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      ))}
    </div>
  );
}

/** Reads the shared notice store; rendered once by the Sync Dashboard page. */
export function NoticeToast({ store = noticeStore }: { store?: NoticeStore }) {
  const notices = useNotices(store);
  return <NoticeToastView notices={notices} onDismiss={store.dismiss} />;
}
