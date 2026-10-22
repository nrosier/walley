export {
  MAIL_DROPPED_LINE,
  MAIL_FAILED_LINE,
  MAIL_QUEUE_CAPACITY,
  createCapturingMailer,
  createMailer,
} from './mailer.js';
export type {
  CapturingMailer,
  MailMessage,
  MailTransport,
  Mailer,
  MailerOptions,
} from './mailer.js';
export { createSmtpTransport } from './smtp.js';
export {
  VERIFICATION_TOKEN_TTL_MS,
  alreadyRegisteredEmail,
  buildVerificationLink,
  verificationEmail,
} from './templates.js';
export type { MailContent } from './templates.js';
