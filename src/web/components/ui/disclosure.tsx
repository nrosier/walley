import type { ReactNode } from 'react';
import { Collapsible } from 'radix-ui';
import { ChevronRight } from 'lucide-react';
import { cn } from 'cn';

export interface DisclosureProps {
  /** Trigger text; callers pass translated text. */
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

/** Collapsible section. The trigger is a button with aria-expanded and aria-controls (Enter and Space toggle). */
export function Disclosure({ title, children, defaultOpen, open, onOpenChange, className }: DisclosureProps) {
  return (
    <Collapsible.Root defaultOpen={defaultOpen} open={open} onOpenChange={onOpenChange} className={className}>
      <Collapsible.Trigger className="group inline-flex min-h-(--control-h) items-center gap-1.5 rounded-md text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        <ChevronRight className={cn('size-4 transition-transform group-data-[state=open]:rotate-90')} aria-hidden="true" />
        {title}
      </Collapsible.Trigger>
      <Collapsible.Content>{children}</Collapsible.Content>
    </Collapsible.Root>
  );
}
