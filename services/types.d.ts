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
 * Result from sending an email (discriminated union).
 * @example
 * const result: SendResult = { success: true, id: 'email-123' };
 */
export type SendResult =
  | { success: true; id?: string }
  | { success: false; error: string }

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

/** @file http-client.js - Types for shared HTTP request helper */

export type ServiceRequestResult =
  | { success: true; data?: Record<string, unknown> }
  | { success: false; error: string }

export function makeServiceRequest(
  httpClient: HttpClient,
  options: object,
  postData: string,
): Promise<ServiceRequestResult>

/** @file retry.js - Types for retry utilities */

/**
 * Result from retryable operation (generic discriminated union).
 * Preserves the inner result type through the retry wrapper.
 */
export type RetryResult<T> = T | { success: false; error: string }

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
 * Check if error is retryable.
 * @example
 * if (isRetryableError('timeout')) { ... }
 */
export function isRetryableError(errorMessage: string | null | undefined): boolean

/**
 * Sleep for specified milliseconds.
 * @example
 * await sleep(1000);
 */
export function sleep(ms: number): Promise<void>

/**
 * Retry a function with exponential backoff.
 * Returns the inner result type on success, or a failure result.
 */
export function withRetry<T extends { success: boolean; error?: string }>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<RetryResult<T>>

/** @file templates.js - Types for message template utilities */

/**
 * Template placeholders.
 * @example
 * const name = PLACEHOLDERS.NAME; // "{name}"
 */
export interface Placeholders {
  readonly NAME: "{name}"
  readonly URL: "{url}"
  readonly DATE: "{date}"
  readonly LOCATION: "{location}"
}

/**
 * Template values for replacement.
 * @example
 * const values: TemplateValues = { name: 'John', url: 'https://example.com' };
 */
export interface TemplateValues {
  name: string
  url: string
  date?: string
  location?: string
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

/**
 * Result from sending SMS (discriminated union).
 * @example
 * const result: SendSMSResult = { success: true, sid: 'SM123' };
 */
export type SendSMSResult =
  | { success: true; sid?: string }
  | { success: false; error: string }

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
