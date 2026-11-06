import type { ReactNode } from 'react';
import { Dialog } from '../ui/dialog';
import { DialogShell } from '../ui/dialog-shell';

export interface CreateModalFrameProps {
  title: string;
  description: string;
  onClose: () => void;
  /**
   * Where focus goes when the modal closes: the control that opened it, or null when that control is gone
   * (a successful create usually removes the row). Null falls back to the dashboard search box.
   */
  returnFocus?: () => HTMLElement | null;
  /** Pinned footer. */
  footer: ReactNode;
  /** Scrolling body. */
  children: ReactNode;
}

/**
 * Shared shell of both create modals: pinned header and footer, scrolling body, a full-screen sheet below 768px.
 *
 * Focus on close: Radix would return focus to whatever was focused when the modal opened. That is the row's
 * Create button, which is unmounted when the row goes, so focus fell to the body. We move it explicitly.
 * Choice: back to the Create button while the row exists (cancel, or a failed create); the search box once the
 * row is gone (a successful create). The search box is the stable landmark, because the next row's position
 * depends on the list order after a sync re-run.
 */
export function CreateModalFrame({ title, description, onClose, returnFocus, footer, children }: CreateModalFrameProps) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogShell
        title={title}
        description={description}
        footer={footer}
        onCloseAutoFocus={(event) => {
          const target = returnFocus?.() ?? document.querySelector<HTMLElement>('input[type="search"]');
          if (target !== null) {
            event.preventDefault();
            target.focus();
          }
        }}
      >
        {children}
      </DialogShell>
    </Dialog>
  );
}
