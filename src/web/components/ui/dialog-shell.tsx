import type { ComponentProps, ReactNode } from 'react';
import { cn } from 'cn';
import { DialogContent, DialogDescription, DialogTitle } from './dialog';

export interface DialogShellProps extends Omit<ComponentProps<typeof DialogContent>, 'title' | 'children'> {
  /** Translated heading, pinned at the top. */
  title: ReactNode;
  description?: ReactNode;
  /** Pinned at the bottom (buttons). */
  footer?: ReactNode;
  /** Scrolls when taller than the available height. */
  children: ReactNode;
}

/**
 * Dialog layout: pinned header, scrolling body (max height 85vh in total), pinned footer.
 * Below 768px it fills the screen as a sheet. Use inside a `Dialog` root.
 */
export function DialogShell({ title, description, footer, children, className, ...props }: DialogShellProps) {
  return (
    <DialogContent
      data-slot="dialog-shell"
      className={cn(
        'flex max-h-[85vh] flex-col gap-0 p-0 max-md:inset-0 max-md:h-dvh max-md:max-h-none max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none max-md:border-0',
        className,
      )}
      {...props}
    >
      <div data-slot="dialog-shell-header" className="flex shrink-0 flex-col gap-2 border-b px-6 py-4 pr-12">
        <DialogTitle>{title}</DialogTitle>
        {description === undefined ? null : <DialogDescription>{description}</DialogDescription>}
      </div>
      <div data-slot="dialog-shell-body" className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {children}
      </div>
      {footer === undefined ? null : (
        <div data-slot="dialog-shell-footer" className="flex shrink-0 flex-col-reverse gap-2 border-t px-6 py-3 sm:flex-row sm:justify-end">
          {footer}
        </div>
      )}
    </DialogContent>
  );
}
