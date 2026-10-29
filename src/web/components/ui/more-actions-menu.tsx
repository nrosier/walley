import type { ReactNode } from 'react';
import { DropdownMenu } from 'radix-ui';
import { Ellipsis } from 'lucide-react';
import { cn } from 'cn';
import { useT } from '@/i18n';
import { controlsMessages } from './controls.messages';

export interface MoreActionsItem {
  id: string;
  label: string;
  onSelect: () => void;
  icon?: ReactNode;
  disabled?: boolean;
  /** Destructive action: the label uses the danger token (red text, danger-bg highlight). */
  destructive?: boolean;
}

export interface MoreActionsMenuProps {
  items: readonly MoreActionsItem[];
  /** Names the row the menu belongs to, so each trigger has a unique accessible name ("More actions for Netflix"). */
  name?: string;
  className?: string;
  /** Opens the menu on first render. For tests. */
  defaultOpen?: boolean;
}

/** One-level dropdown behind a "more actions" button. Radix handles arrow keys, Escape and focus return. */
export function MoreActionsMenu({ items, name, className, defaultOpen }: MoreActionsMenuProps) {
  const { t } = useT(controlsMessages);
  const label = name === undefined ? t('moreActions') : t('moreActionsFor', { name });
  return (
    <DropdownMenu.Root defaultOpen={defaultOpen} modal={false}>
      <DropdownMenu.Trigger
        aria-label={label}
        className={cn(
          'inline-flex min-h-(--control-h) min-w-(--control-h) items-center justify-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          className,
        )}
      >
        <Ellipsis className="size-4" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          aria-label={label}
          className="z-50 min-w-40 rounded-md border bg-card p-1 text-sm shadow-overlay"
        >
          {items.map((item) => (
            <DropdownMenu.Item
              key={item.id}
              disabled={item.disabled}
              onSelect={item.onSelect}
              className={cn(
                'flex min-h-(--control-h) cursor-default items-center gap-2 rounded-sm px-2 py-1.5 outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-hover',
                item.destructive === true && 'text-danger data-[highlighted]:bg-danger-bg',
              )}
            >
              {item.icon}
              {item.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
