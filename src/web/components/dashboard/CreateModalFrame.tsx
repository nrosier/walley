import type { ReactNode } from 'react';
import { Dialog } from '../ui/dialog';
import { DialogShell } from '../ui/dialog-shell';

export interface CreateModalFrameProps {
  title: string;
  description: string;
  onClose: () => void;
  /** Pinned footer. */
  footer: ReactNode;
  /** Scrolling body. */
  children: ReactNode;
}

/** Shared shell of both create modals: pinned header and footer, scrolling body, a full-screen sheet below 768px. */
export function CreateModalFrame({ title, description, onClose, footer, children }: CreateModalFrameProps) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogShell title={title} description={description} footer={footer}>
        {children}
      </DialogShell>
    </Dialog>
  );
}
