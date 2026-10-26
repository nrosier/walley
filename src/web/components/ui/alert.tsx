import type { ReactNode } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { cn } from 'cn';
import { useT } from '@/i18n';
import { controlsMessages } from './controls.messages';

export type AlertVariant = 'error' | 'warning' | 'info' | 'success';

const STYLES: Record<AlertVariant, { box: string; Icon: typeof Info }> = {
  error: { box: 'border-danger-line bg-danger-bg text-danger', Icon: AlertCircle },
  warning: { box: 'border-warning bg-warning-bg text-warning', Icon: AlertTriangle },
  info: { box: 'border-info bg-info-bg text-info', Icon: Info },
  success: { box: 'border-success bg-success-bg text-success', Icon: CheckCircle2 },
};

export interface AlertProps {
  variant?: AlertVariant;
  children: ReactNode;
  className?: string;
}

/**
 * Inline message. Errors and warnings use role="alert" (assertive, as the existing page errors do);
 * info and success use role="status" with aria-live="polite". A visually hidden prefix names the kind
 * so colour is not the only cue.
 */
export function Alert({ variant = 'info', children, className }: AlertProps) {
  const { t } = useT(controlsMessages);
  const { box, Icon } = STYLES[variant];
  const urgent = variant === 'error' || variant === 'warning';
  return (
    <div
      data-slot="alert"
      data-variant={variant}
      role={urgent ? 'alert' : 'status'}
      aria-live={urgent ? 'assertive' : 'polite'}
      className={cn('flex items-start gap-2 rounded-md border px-3 py-2 text-sm', box, className)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p>
        <span className="sr-only">{t(`alert.${variant}`)}: </span>
        {children}
      </p>
    </div>
  );
}
