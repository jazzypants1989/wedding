import type { LookupResponse } from "../types.js"

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
  nameGroup: HTMLElement
  name: HTMLInputElement
  contact: HTMLInputElement
  contactLabel: HTMLElement
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
  name: string | null,
  contact: string,
): Promise<LookupResponse>

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
): Promise<void>

export interface ConfigResponse {
  features?: {
    enableNameLookup?: boolean
    enableEmailLookup?: boolean
  }
}

export function getConfig(): Promise<ConfigResponse>

export function fetchConfig(): Promise<void>

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
): Promise<PetitionResponse>

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
  additional_info: string | null
  message: string | null
  submitted_at?: string | null
  updated_at?: string | null
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
export function showError(message: string, neutral?: boolean): void

/**
 * Show success state. Confetti only fires when the guest is attending; a decline
 * still gets a warm, non-celebratory success screen.
 * @example
 * showSuccess('Thank you!', true);
 */
export function showSuccess(message: string, attending: boolean): void

/**
 * Pre-fill form with existing RSVP data.
 * @example
 * prefillForm(rsvp);
 */
export function prefillForm(rsvp: ExistingRsvp): void

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
 * const data = await fetchRsvpData('ABC123');
 */
export function fetchRsvpData(inviteCode: string): Promise<RsvpFormData>

/**
 * Submit RSVP response.
 * @example
 * const data = await submitRsvp('ABC123', payload);
 */
export function submitRsvp(
  inviteCode: string,
  payload: RsvpSubmitPayload,
): Promise<RsvpSubmitResponse>

/**
 * Payload for RSVP submission.
 * @example
 * const payload: RsvpSubmitPayload = { attending: true, actual_party_size: 2, ... };
 */
export interface RsvpSubmitPayload {
  attending: boolean
  actual_party_size: number | null
  dietary_restrictions: string | null
  additional_info: string | null
  message: string | null
}

/**
 * Mini Sparkle effect on an element.
 * @example
 * miniSparkle(element);
 */
export function miniSparkle(element: HTMLElement): void

/** @file utils.js - Types for shared form utilities */

export function showResult(
  el: HTMLElement,
  message: string,
  isError: boolean,
  errorClass: string,
  successClass: string,
  shakeClass: string,
): void

export function setButtonLoading(
  btn: HTMLButtonElement,
  isLoading: boolean,
): void

export function fireConfetti(): void
