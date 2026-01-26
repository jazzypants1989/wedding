/** @file email.js - Types for email service */

import type { ClientRequest, IncomingMessage } from "node:http"

/**
 * Email options for sending.
 * @example
 * const options: EmailOptions = { to: 'user@example.com', subject: 'Hello', text: 'Hi!' };
 */
export interface EmailOptions {
  to: string
  subject: string
  text: string
  html?: string
}

/**
 * Result from sending an email.
 * @example
 * const result: SendResult = { success: true, id: 'email-123' };
 */
export interface SendResult {
  success: boolean
  id?: string
  error?: string
}

/**
 * Invite email data.
 * @example
 * const data: InviteEmailData = { subject: 'Wedding', text: '...', html: '...' };
 */
export interface InviteEmailData {
  subject: string
  text: string
  html: string
}

/**
 * Minimal HTTP client interface for email service.
 * @example
 * const client: HttpClient = https;
 */
export interface HttpClient {
  request(
    options: object,
    callback: (res: IncomingMessage) => void,
  ): ClientRequest
}

/**
 * Email service interface.
 * @example
 * const service: EmailService = createEmailService();
 */
export interface EmailService {
  isConfigured(): boolean
  sendEmail(options: EmailOptions): Promise<SendResult>
}

/**
 * Send email request.
 * @example
 * const result = await sendEmailRequest(options);
 */
export function sendEmailRequest(options: EmailOptions): Promise<SendResult>

/**
 * Create email service.
 * @example
 * const service = createEmailService();
 */
export function createEmailService(httpClient?: HttpClient): EmailService

/**
 * Check if email is configured.
 * @example
 * if (isConfigured()) { ... }
 */
export function isConfigured(): boolean

/**
 * Send an email.
 * @example
 * await sendEmail({ to: 'user@example.com', subject: 'Hello', text: 'Hi!' });
 */
export function sendEmail(options: EmailOptions): Promise<SendResult>

/**
 * Get default invite email.
 * @example
 * const email = getDefaultInviteEmail('John', 'https://example.com');
 */
export function getDefaultInviteEmail(
  guestName: string,
  inviteUrl: string,
): InviteEmailData

/** @file retry.js - Types for retry utilities */

/**
 * Result from retryable operation.
 * @example
 * const result: RetryResult = { success: true };
 */
export interface RetryResult {
  success: boolean
  error?: string
}

/**
 * Options for retry behavior.
 * @example
 * const options: RetryOptions = { maxRetries: 3, baseDelayMs: 1000 };
 */
export interface RetryOptions {
  maxRetries?: number
  baseDelayMs?: number
}

/**
 * Function that can be retried.
 * @example
 * const fn: RetryableFn = async () => ({ success: true });
 */
export type RetryableFn = () => Promise<RetryResult>

/**
 * Check if error is retryable.
 * @example
 * if (isRetryableError('timeout')) { ... }
 */
export function isRetryableError(errorMessage: string | undefined): boolean

/**
 * Sleep for specified milliseconds.
 * @example
 * await sleep(1000);
 */
export function sleep(ms: number): Promise<void>

/**
 * Retry a function with exponential backoff.
 * @example
 * await withRetry(fn, { maxRetries: 3 });
 */
export function withRetry(
  fn: RetryableFn,
  options?: RetryOptions,
): Promise<RetryResult>

/** @file templates.js - Types for message template utilities */

/**
 * Template placeholders.
 * @example
 * const name = PLACEHOLDERS.NAME; // "{name}"
 */
export interface Placeholders {
  readonly NAME: "{name}"
  readonly URL: "{url}"
}

/**
 * Template values for replacement.
 * @example
 * const values: TemplateValues = { name: 'John', url: 'https://example.com' };
 */
export interface TemplateValues {
  name: string
  url: string
}

export const PLACEHOLDERS: Placeholders

/**
 * Format template with values.
 * @example
 * const msg = formatTemplate('Hi {name}', { name: 'John', url: '...' });
 */
export function formatTemplate(template: string, values: TemplateValues): string

/**
 * Get template example.
 * @example
 * const example = getTemplateExample();
 */
export function getTemplateExample(): string

/** @file twilio.js - Types for Twilio SMS service */

import type { ClientRequest, IncomingMessage } from "node:http"

/**
 * Result from sending SMS.
 * @example
 * const result: SendSMSResult = { success: true, sid: 'SM123' };
 */
export interface SendSMSResult {
  success: boolean
  sid?: string
  error?: string
}

/**
 * Minimal HTTP client interface for SMS service.
 * @example
 * const client: HttpClient = https;
 */
export interface HttpClient {
  request(options: object, callback: (res: any) => void): any
}

/**
 * SMS service interface.
 * @example
 * const service: SMSService = createSMSService();
 */
export interface SMSService {
  isConfigured(): boolean
  sendSMS(to: string, body: string): Promise<SendSMSResult>
}

/**
 * Send SMS request.
 * @example
 * const result = await sendSMSRequest('+1234567890', 'Hello');
 */
export function sendSMSRequest(to: string, body: string): Promise<SendSMSResult>

/**
 * Create SMS service.
 * @example
 * const service = createSMSService();
 */
export function createSMSService(httpClient?: HttpClient): SMSService

/**
 * Check if SMS is configured.
 * @example
 * if (isConfigured()) { ... }
 */
export function isConfigured(): boolean

/**
 * Send an SMS.
 * @example
 * await sendSMS('+1234567890', 'Hello');
 */
export function sendSMS(to: string, body: string): Promise<SendSMSResult>

/**
 * Get default invite message.
 * @example
 * const msg = getDefaultInviteMessage('John', 'https://example.com');
 */
export function getDefaultInviteMessage(
  guestName: string,
  inviteUrl: string,
): string
