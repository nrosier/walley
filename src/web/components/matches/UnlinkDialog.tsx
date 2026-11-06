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
import { restoreFocus, rowMenuTrigger } from './row-menu-focus';

export interface UnlinkDialogProps {
  /** The Synced pair to unlink; the dialog is open while this is set. */
  row: SyncLinked | null;
  /** Called with the pair after the user pressed Confirm. */
  onConfirm: (row: SyncLinked) => void;
  onCancel: () => void;
}

/** Confirmation for unlinking a Synced pair from the linked-pair row menu on the Sync Dashboard. Names both items; nothing remote changes. */
export function UnlinkDialog({ row, onConfirm, onCancel }: UnlinkDialogProps) {
  const modal = useT(diffModalMessages).t;
  const { t } = useT(unlinkDialogMessages);
  // The row is already null when the close focus handler runs, so the last open row id is kept here.
  const lastId = useRef<string | null>(null);
  // Set by Confirm: the pair is then unlinked and its row is gone, so focus must not go to its menu button.
  const confirmed = useRef(false);
  const openId = row?.matchId ?? null;
  useEffect(() => {
    if (openId !== null) {
      lastId.current = openId;
      confirmed.current = false;
    }
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
          // Cancel or Escape: the row stays, so back to its menu button (the menu item that opened this dialog is
          // unmounted, Radix has nothing to return to). Confirm: the row is gone, so the search box.
          restoreFocus(event, confirmed.current ? null : rowMenuTrigger(lastId.current));
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
            className="border border-danger-line bg-card text-danger hover:bg-danger-bg"
            onClick={() => {
              confirmed.current = true;
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
