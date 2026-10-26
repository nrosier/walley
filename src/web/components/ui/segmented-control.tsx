import { useId } from 'react';
import { cn } from 'cn';

export interface SegmentedOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SegmentedControlProps {
  options: readonly SegmentedOption[];
  value: string;
  onValueChange: (value: string) => void;
  /** Accessible name of the group; callers pass translated text. Give each control on a page a different name. */
  'aria-label': string;
  className?: string;
}

/**
 * Radio group drawn as joined buttons. Native radios share one name, so arrow keys move and select,
 * and Tab enters and leaves the group once.
 */
export function SegmentedControl({ options, value, onValueChange, className, ...rest }: SegmentedControlProps) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label={rest['aria-label']} className={cn('inline-flex rounded-md border border-input-border bg-surface-2 p-0.5', className)}>
      {options.map((option) => (
        <label
          key={option.value}
          className="relative inline-flex min-h-(--control-h) min-w-(--control-h) flex-1 cursor-pointer items-center justify-center rounded-sm px-3 text-sm has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring"
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            disabled={option.disabled}
            onChange={() => {
              onValueChange(option.value);
            }}
            className="absolute inset-0 m-0 cursor-pointer opacity-0"
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
