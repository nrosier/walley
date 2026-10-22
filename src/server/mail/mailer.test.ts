import { describe, expect, it } from 'vitest';
import { MAIL_DROPPED_LINE, MAIL_FAILED_LINE, createMailer, type MailTransport } from './mailer.js';

const SECRET_ADDRESS = 'private.person@example.test';
const SECRET_SUBJECT = 'Subject with a private token abc123';
const SECRET_BODY = 'Body with https://walley.example.test/verify-email#token=abc123';

/** Waits until the queue has had a chance to drain. */
function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function recordingTransport(): MailTransport & { readonly calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    sendMail(message): Promise<unknown> {
      calls.push(message);
      return Promise.resolve({ accepted: [message.to] });
    },
  };
}

describe('createMailer', () => {
  it('sends queued messages through the transport with the configured from address', async () => {
    const transport = recordingTransport();
    const mailer = createMailer({
      transport,
      from: 'Walley <noreply@example.test>',
      log: () => {},
    });

    mailer.send({ to: 'a@example.test', subject: 'one', text: 'first' });
    mailer.send({ to: 'b@example.test', subject: 'two', text: 'second' });
    await settle();
    await settle();

    expect(transport.calls).toEqual([
      {
        from: 'Walley <noreply@example.test>',
        to: 'a@example.test',
        subject: 'one',
        text: 'first',
      },
      {
        from: 'Walley <noreply@example.test>',
        to: 'b@example.test',
        subject: 'two',
        text: 'second',
      },
    ]);
  });

  it('returns from send before the transport is called', () => {
    const transport = recordingTransport();
    const mailer = createMailer({
      transport,
      from: 'noreply@example.test',
      log: () => {},
    });

    mailer.send({ to: 'a@example.test', subject: 'one', text: 'first' });

    expect(transport.calls).toHaveLength(0);
  });

  it('drops a message beyond capacity and logs one fixed line with no private data', async () => {
    const lines: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const transport: MailTransport = {
      async sendMail(): Promise<unknown> {
        await gate;
        return {};
      },
    };
    const mailer = createMailer({
      transport,
      from: 'noreply@example.test',
      capacity: 2,
      log: (line) => lines.push(line),
    });

    mailer.send({ to: 'x@example.test', subject: 'x', text: 'x' });
    mailer.send({ to: 'y@example.test', subject: 'y', text: 'y' });
    // The queue now holds two messages; the third must be dropped.
    mailer.send({
      to: SECRET_ADDRESS,
      subject: SECRET_SUBJECT,
      text: SECRET_BODY,
    });
    mailer.send({
      to: SECRET_ADDRESS,
      subject: SECRET_SUBJECT,
      text: SECRET_BODY,
    });

    expect(lines).toEqual([MAIL_DROPPED_LINE, MAIL_DROPPED_LINE]);
    for (const line of lines) {
      expect(line).not.toContain(SECRET_ADDRESS);
      expect(line).not.toContain(SECRET_SUBJECT);
      expect(line).not.toContain('abc123');
    }
    release();
    await settle();
  });

  it('logs a fixed failure line and keeps draining after a transport error', async () => {
    const lines: string[] = [];
    let attempts = 0;
    const transport: MailTransport = {
      sendMail(): Promise<unknown> {
        attempts += 1;
        if (attempts === 1) {
          return Promise.reject(
            new Error(`connect failed for ${SECRET_ADDRESS} smtp://user:pw@host`),
          );
        }
        return Promise.resolve({});
      },
    };
    const mailer = createMailer({
      transport,
      from: 'noreply@example.test',
      log: (line) => lines.push(line),
    });

    mailer.send({
      to: SECRET_ADDRESS,
      subject: SECRET_SUBJECT,
      text: SECRET_BODY,
    });
    mailer.send({
      to: 'second@example.test',
      subject: 'second',
      text: 'second',
    });
    await settle();
    await settle();

    expect(attempts).toBe(2);
    expect(lines).toEqual([MAIL_FAILED_LINE]);
    expect(lines[0]).not.toContain('pw');
    expect(lines[0]).not.toContain(SECRET_ADDRESS);
  });

  it('never throws into the caller when the transport throws synchronously', async () => {
    const lines: string[] = [];
    const transport: MailTransport = {
      sendMail(): Promise<unknown> {
        throw new Error('boom');
      },
    };
    const mailer = createMailer({
      transport,
      from: 'noreply@example.test',
      log: (line) => lines.push(line),
    });

    expect(() => {
      mailer.send({
        to: SECRET_ADDRESS,
        subject: SECRET_SUBJECT,
        text: SECRET_BODY,
      });
    }).not.toThrow();
    await settle();
    expect(lines).toEqual([MAIL_FAILED_LINE]);
  });

  it('does not throw when the logger itself throws', async () => {
    const transport: MailTransport = {
      sendMail(): Promise<unknown> {
        return Promise.reject(new Error('down'));
      },
    };
    const mailer = createMailer({
      transport,
      from: 'noreply@example.test',
      log: () => {
        throw new Error('logger broken');
      },
    });

    expect(() => {
      mailer.send({
        to: SECRET_ADDRESS,
        subject: SECRET_SUBJECT,
        text: SECRET_BODY,
      });
    }).not.toThrow();
    await settle();
  });
});
