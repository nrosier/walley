import { createPortal } from 'react-dom';
import { Button } from '../ui/button';

export interface CreateFooterProps {
  /** `id` of the form the Create button submits; the buttons may sit outside it (in the pinned dialog footer). */
  formId: string;
  cancelLabel: string;
  submitLabel: string;
  onCancel?: () => void;
  /** Create is off for this reason (already translated), or null when it is on. Shown next to the buttons. */
  reason: string | null;
  /** Create is off for a reason the user cannot fix (request in flight, already created). */
  busy?: boolean;
  /**
   * The pinned footer element of the modal. `undefined`: render inline (a form shown on its own).
   * `null`: the footer is not mounted yet, render nothing.
   */
  host?: HTMLElement | null;
  reasonId: string;
}

/** Cancel and Create together, with the reason Create is disabled. Rendered into the modal's pinned footer when `host` is given. */
export function CreateFooter({ formId, cancelLabel, submitLabel, onCancel, reason, busy = false, host, reasonId }: CreateFooterProps) {
  const blocked = reason !== null || busy;
  const node = (
    <div data-slot="create-footer" className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
      {reason === null ? null : (
        <p id={reasonId} className="text-xs text-muted sm:mr-auto">
          {reason}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        {onCancel === undefined ? null : (
          <Button type="button" variant="outline" className="min-h-(--control-h)" onClick={onCancel}>
            {cancelLabel}
          </Button>
        )}
        <Button
          type="submit"
          form={formId}
          className="min-h-(--control-h)"
          // aria-disabled, not disabled: a natively disabled button that has focus drops it to the body (while the
          // request is pending, and when a failed create re-enables it). The click is cancelled here, and the forms'
          // onSubmit guards the Enter-in-a-field path, so a blocked Create sends nothing.
          aria-disabled={blocked}
          aria-busy={busy && reason === null}
          onClick={(e) => {
            if (blocked) e.preventDefault();
          }}
          aria-describedby={reason === null ? undefined : reasonId}
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
  if (host === undefined) return node;
  return host === null ? null : createPortal(node, host);
}
