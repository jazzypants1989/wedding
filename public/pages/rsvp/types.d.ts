import type { LookupResponse } from "../types.js"

/** @file fetch-helper.js - Types for fetch helper utilities */

/**
 * Options for fetch requests with timeout support.
 * Extends standard RequestInit with optional timeout.
 * @example
 * const options: FetchOptions = {
 *   method: 'POST',
 *   timeout: 5000,
 *   headers: { 'Content-Type': 'application/json' }
 * };
 */
export interface FetchOptions extends RequestInit {
  timeout?: number
}

/**
 * Result from apiRequest function.
 * Contains response status and parsed JSON data.
 * @example
 * const result: ApiRequestResult = {
 *   ok: true,
 *   status: 200,
 *   data: { guest: { id: 1, name: "John" } }
 * };
 */
export interface ApiRequestResult<T = Record<string, unknown>> {
  ok: boolean
  status: number
  data: T
}

/**
 * Error response from API.
 * @example
 * const err: ApiErrorResponse = { error: "Guest not found" };
 */
export interface ApiErrorResponse {
  error?: string
}

/**
 * Make a fetch request with timeout support.
 * Aborts the request if it exceeds the timeout (default 30s).
 * @example
 * const response = await fetchWithTimeout('/api/guest', { timeout: 5000 });
 */
export function fetchWithTimeout(
  url: string,
  options?: FetchOptions,
): Promise<Response>

/**
 * Make a JSON API request with timeout and error handling.
 * Automatically sets Content-Type header and parses JSON response.
 * @example
 * const { ok, status, data } = await apiRequest('/api/rsvp', {
 *   method: 'POST',
 *   body: JSON.stringify({ attending: true })
 * });
 */
export function apiRequest<T = Record<string, unknown>>(
  url: string,
  options?: FetchOptions,
): Promise<ApiRequestResult<T>>

/**
 * Get user-friendly error message from Error or API response.
 * Handles network errors, timeout errors, and API error responses.
 * @example
 * getErrorMessage(new Error('Network error')) // "Unable to connect..."
 * getErrorMessage({ error: 'Invalid code' }) // "Invalid code"
 */
export function getErrorMessage(
  error: Error | ApiErrorResponse | unknown,
): string

/** @file lookup-form.js - Types for guest invitation lookup form module */

/**
 * Callback function to show the petition form with prefilled data.
 * Called when a guest lookup fails but petitioning is allowed.
 * @example
 * onShowPetitionForm("John Doe", "john@example.com");
 */
export type ShowPetitionFormCallback = (name: string, contact: string) => void

/**
 * Cached DOM elements for the lookup form.
 * @example
 * const elements: LookupFormElements = {
 *   result: getElement('lookup-result'),
 *   name: getInputElement('lookup-name'),
 *   ...
 * };
 */
export interface LookupFormElements {
  result: HTMLElement
  name: HTMLInputElement
  contact: HTMLInputElement
  submit: HTMLButtonElement
  section: HTMLElement
}

/**
 * Lookup form module state.
 * @example
 * let state: LookupFormState | null = null;
 */
export interface LookupFormState {
  elements: LookupFormElements
  onShowPetitionForm: ShowPetitionFormCallback | null
}

/**
 * Call the lookup API with name and contact.
 * @example
 * const result = await lookupGuest('John', 'john@example.com');
 */
export function lookupGuest(
  name: string,
  contact: string,
): Promise<ApiRequestResult<LookupResponse>>

/**
 * Display a result message in the lookup form.
 * @example
 * showLookupResult("Invitation sent!", false);
 * showLookupResult("Guest not found", true);
 */
export function showLookupResult(message: string, isError?: boolean): void

/**
 * Handle lookup form submission.
 * Validates input, calls API, and shows appropriate result.
 * @example
 * form.addEventListener('submit', handleLookupSubmit);
 */
export function handleLookupSubmit(e: SubmitEvent): Promise<void>

/**
 * Hide the lookup section (when transitioning to petition form).
 * @example
 * hideLookupSection();
 */
export function hideLookupSection(): void

/**
 * Initialize the lookup form with event listeners.
 * @example
 * initLookupForm((name, contact) => showPetitionForm(name, contact));
 * initLookupForm(null); // No petition form callback
 */
export function initLookupForm(
  onShowPetitionForm?: ShowPetitionFormCallback | null,
): void

/** @file petition-form.js - Types for petition form module */

/**
 * Payload for petition API request.
 * @example
 * const payload: PetitionPayload = { name: 'John', email: 'john@example.com' };
 */
export interface PetitionPayload {
  name: string
  email: string
  phone?: string
  relationship?: string
  message?: string
}

/**
 * Response from petition API.
 * @example
 * const response: PetitionResponse = { message: 'Request submitted!' };
 */
export interface PetitionResponse {
  message: string
}

/**
 * Call the petition API.
 * @example
 * const result = await submitPetition(payload);
 */
export function submitPetition(
  payload: PetitionPayload,
): Promise<ApiRequestResult<PetitionResponse>>

/**
 * Show petition result message.
 * @example
 * showPetitionResult('Success!', false);
 */
export function showPetitionResult(message: string, isError?: boolean): void

/**
 * Show petition form with optional prefilled data.
 * @example
 * showPetitionForm('John', 'john@example.com');
 */
export function showPetitionForm(
  prefillName?: string,
  prefillContact?: string,
): void

/**
 * Handle petition form submission.
 * @example
 * form.addEventListener('submit', handlePetitionSubmit);
 */
export function handlePetitionSubmit(e: SubmitEvent): Promise<void>

/**
 * Initialize the petition form.
 * @example
 * initPetitionForm();
 */
export function initPetitionForm(): void

/** @file rsvp-form.js - Types for RSVP form module */

/**
 * Guest info for RSVP form.
 * @example
 * const guest: RsvpGuest = { name: 'John', party_size: 2 };
 */
export interface RsvpGuest {
  name: string
  party_size: number
}

/**
 * RSVP data from existing response.
 * @example
 * const rsvp: ExistingRsvp = { attending: 1, actual_party_size: 2, ... };
 */
export interface ExistingRsvp {
  attending: 0 | 1
  actual_party_size: number | null
  dietary_restrictions: string | null
  song_request: string | null
  message: string | null
}

/**
 * RSVP form data response from API.
 * @example
 * const data: RsvpFormData = { guest: {...}, rsvp: null };
 */
export interface RsvpFormData {
  guest: RsvpGuest
  rsvp: ExistingRsvp | null
}

/**
 * RSVP submit response.
 * @example
 * const response: RsvpSubmitResponse = { message: 'Thank you!' };
 */
export interface RsvpSubmitResponse {
  message: string
}

/**
 * Module state for RSVP form.
 * @example
 * const state: RsvpFormState = { inviteCode: null, guestData: null };
 */
export interface RsvpFormState {
  inviteCode: string | null
  guestData: RsvpFormData | null
}

/**
 * Show error state.
 * @example
 * showError('Invalid code');
 */
export function showError(message: string): void

/**
 * Show success state.
 * @example
 * showSuccess('Thank you!');
 */
export function showSuccess(message: string): void

/**
 * Pre-fill form with existing RSVP data.
 * @example
 * prefillForm(rsvp);
 */
export function prefillForm(rsvp: ExistingRsvp): void

/**
 * Update radio label checked styles.
 * @example
 * updateRadioStyles();
 */
export function updateRadioStyles(): void

/**
 * Set up form event listeners.
 * @example
 * setupFormListeners();
 */
export function setupFormListeners(): void

/**
 * Handle form submission.
 * @example
 * form.addEventListener('submit', handleSubmit);
 */
export function handleSubmit(event: Event): Promise<void>

/**
 * Show the RSVP form with guest data.
 * @example
 * showForm(data);
 */
export function showForm(data: RsvpFormData): void

/**
 * Initialize the RSVP form.
 * @example
 * await initRsvpForm();
 */
export function initRsvpForm(): Promise<void>

/**
 * Fetch RSVP data for a guest by invite code.
 * @example
 * const { ok, data } = await fetchRsvpData('ABC123');
 */
export function fetchRsvpData(
  inviteCode: string,
): Promise<ApiRequestResult<RsvpFormData>>

/**
 * Submit RSVP response.
 * @example
 * const { ok, data } = await submitRsvp('ABC123', payload);
 */
export function submitRsvp(
  inviteCode: string,
  payload: RsvpSubmitPayload,
): Promise<ApiRequestResult<RsvpSubmitResponse>>

/**
 * Payload for RSVP submission.
 * @example
 * const payload: RsvpSubmitPayload = { attending: true, actual_party_size: 2, ... };
 */
export interface RsvpSubmitPayload {
  attending: boolean
  actual_party_size: number | null
  dietary_restrictions: string | null
  song_request: string | null
  message: string | null
}
