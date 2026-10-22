/** One outgoing message. The recipient is the only personal data a mailer sees. */
export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

/**
 * Fire-and-forget mail sender. send() enqueues and returns at once. It never throws and never
 * reports delivery; failures are logged as fixed lines that carry no address, subject or body.
 */
export interface Mailer {
  send(message: MailMessage): void;
}

/** The part of a nodemailer transport that the queue uses. */
export interface MailTransport {
  sendMail(message: {
    readonly from: string;
    readonly to: string;
    readonly subject: string;
    readonly text: string;
  }): Promise<unknown>;
}

/** Maximum messages waiting in memory. A full queue drops new messages. */
export const MAIL_QUEUE_CAPACITY = 100;

/** Logged once per dropped message. Fixed text: never includes an address, subject or body. */
export const MAIL_DROPPED_LINE = 'mail: queue full, message dropped';

/** Logged once per failed delivery. Fixed text: never includes an address, subject or body. */
export const MAIL_FAILED_LINE = 'mail: transport failed, message not sent';

export interface MailerOptions {
  readonly transport: MailTransport;
  /** The From address placed on every message. */
  readonly from: string;
  readonly capacity?: number;
  /** Receives fixed lines only. Defaults to console.error. */
  readonly log?: (line: string) => void;
}

function defaultLog(line: string): void {
  console.error(line);
}

/**
 * Bounded in-memory queue drained one message at a time through the transport. Messages are lost
 * if the process exits before they are sent. That is accepted for verification mail, which the
 * user can request again.
 */
export function createMailer(options: MailerOptions): Mailer {
  const capacity = options.capacity ?? MAIL_QUEUE_CAPACITY;
  const log = options.log ?? defaultLog;
  const queue: MailMessage[] = [];
  let draining = false;

  // A logger that throws must not break the queue or surface as an unhandled rejection.
  const report = (line: string): void => {
    try {
      log(line);
    } catch {
      // Logging is best effort.
    }
  };

  const drain = async (): Promise<void> => {
    if (draining) {
      return;
    }
    draining = true;
    try {
      let next = queue.shift();
      while (next !== undefined) {
        const message = next;
        try {
          await options.transport.sendMail({
            from: options.from,
            to: message.to,
            subject: message.subject,
            text: message.text,
          });
        } catch {
          report(MAIL_FAILED_LINE);
        }
        next = queue.shift();
      }
    } finally {
      draining = false;
    }
  };

  return {
    send(message: MailMessage): void {
      try {
        if (queue.length >= capacity) {
          report(MAIL_DROPPED_LINE);
          return;
        }
        queue.push({
          to: message.to,
          subject: message.subject,
          text: message.text,
        });
        setImmediate(() => {
          void drain().catch(() => {
            // drain catches transport errors itself; this guards anything else.
          });
        });
      } catch {
        report(MAIL_DROPPED_LINE);
      }
    },
  };
}

export interface CapturingMailer extends Mailer {
  /** Messages passed to send(), in order. For tests only. */
  readonly sent: MailMessage[];
}

/** A mailer that keeps messages in memory instead of sending them. For tests. */
export function createCapturingMailer(): CapturingMailer {
  const sent: MailMessage[] = [];
  return {
    sent,
    send(message: MailMessage): void {
      sent.push({
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
    },
  };
}
