import nodemailer from 'nodemailer';
import type { MailTransport } from './mailer.js';

/**
 * Builds a nodemailer SMTP transport from SMTP_URL (smtp: or smtps:). Creating it opens no
 * connection; the first sendMail does. The URL may hold credentials, so callers must never log it.
 */
export function createSmtpTransport(smtpUrl: string): MailTransport {
  return nodemailer.createTransport(smtpUrl);
}
