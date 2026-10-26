import { useId } from 'react';
import { cn } from 'cn';

export interface OptionCard {
  value: string;
  label: string;
}

export interface OptionCardsProps {
  options: readonly OptionCard[];
  value: string;
  onValueChange: (value: string) => void;
  /** Accessible name of the group; callers pass translated text. */
  'aria-label': string;
  className?: string;
}

/**
 * Radio group drawn as selectable cards, for choices with names too long or too many for a segmented control
 * (for example a payee). Native radios share one name, so arrow keys move and select and Tab enters the group once.
 */
export function OptionCards({ options, value, onValueChange, className, ...rest }: OptionCardsProps) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label={rest['aria-label']} className={cn('grid max-h-56 gap-2 overflow-y-auto sm:grid-cols-2', className)}>
      {options.map((option) => (
        <label
          key={option.value}
          className="flex min-h-(--control-h) cursor-pointer items-center gap-2 rounded-md border border-input-border bg-background px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-hover has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring"
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            onChange={() => {
              onValueChange(option.value);
            }}
            className="size-4 shrink-0 accent-primary"
          />
          <span className="min-w-0 break-words">{option.label}</span>
        </label>
      ))}
    </div>
  );
}
