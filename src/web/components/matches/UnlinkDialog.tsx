import { useEffect, useRef } from 'react';
import type { SyncLinked } from '../../../lib/sync-check-types';
import { useT } from '@/i18n';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/dialog';
import { diffModalMessages } from './DiffModal.messages';
import { unlinkDialogMessages } from './UnlinkDialog.messages';

export interface UnlinkDialogProps {
  /** The Synced pair to unlink; the dialog is open while this is set. */
  row: SyncLinked | null;
  /** Called with the pair after the user pressed Confirm. */
  onConfirm: (row: SyncLinked) => void;
  onCancel: () => void;
}

/** Confirmation for unlinking a Synced pair from the Matches row menu. Names both items; nothing remote changes. */
export function UnlinkDialog({ row, onConfirm, onCancel }: UnlinkDialogProps) {
  const modal = useT(diffModalMessages).t;
  const { t } = useT(unlinkDialogMessages);
  // The row is already null when the close focus handler runs, so the last open row id is kept here.
  const lastId = useRef<string | null>(null);
  const openId = row?.matchId ?? null;
  useEffect(() => {
    if (openId !== null) lastId.current = openId;
  }, [openId]);
  return (
    <AlertDialog
      open={row !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          // Back to the row's menu button; when the row is gone (unlinked), to the search box.
          const id = lastId.current;
          const target =
            (id === null ? null : document.querySelector<HTMLElement>(`[data-linked-id="${CSS.escape(id)}"] [aria-haspopup="menu"]`)) ??
            document.querySelector<HTMLElement>('input[type="search"]');
          if (target !== null) {
            event.preventDefault();
            target.focus();
          }
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{modal('unlinkConfirmTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {row === null ? '' : t('description', { wallos: row.wallosName ?? '', actual: row.actualName ?? '' })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{modal('cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (row !== null) onConfirm(row);
            }}
          >
            {modal('confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
