import type { ApiOptions, PaginationInfo } from "../types.js"
import type {
  RSVPWithGuest,
  BlocklistEntry,
  Guest,
  GuestWithInviteCount,
  Stats,
  Petition,
  MediaListItem,
  SiteContent,
  SiteContentNavLink,
  SiteContentScheduleItem,
  SiteContentImage,
} from "../../../types.js"

export type { SiteContent, SiteContentNavLink, SiteContentScheduleItem, SiteContentImage }

/** Response of GET/PUT/DELETE /api/admin/site-content. */
export interface SiteContentResponse {
  content: SiteContent
}

/** Response of GET/PUT/DELETE /api/admin/effect-config. The sparse override map
 *  `{ [effectId]: Partial<config> }`. */
export interface EffectConfigResponse {
  override: Record<string, Record<string, unknown>>
}

/** @file utils.js - Types for admin utilities */

/**
 * Make an authenticated API request.
 * Automatically includes CSRF token for non-GET requests.
 * Redirects to login on 401 responses.
 * @example
 * const data = await api('/api/admin/guests');
 * const result = await api('/api/admin/guests', { method: 'POST', body: JSON.stringify(data) });
 */
export function api(
  endpoint: string,
  options?: ApiOptions,
): Promise<unknown>

/** @file auth.js - Types for admin authentication module */

/**
 * Callback function with no parameters or return value.
 * @example
 * const onLogin: VoidCallback = () => { loadDashboard(); };
 */
export type VoidCallback = () => void

/**
 * Get cookie value by name from document.cookie.
 * @example
 * const token = getCookie('csrf'); // string | null
 */
export function getCookie(name: string): string | null

/**
 * Show the login form and hide the dashboard.
 * @example
 * showLogin();
 */
export function showLogin(): void

/**
 * Show the dashboard section and hide the login form.
 * @example
 * showDashboard();
 */
export function showDashboard(): void

/**
 * Check if user has an active session.
 * If valid, shows dashboard and calls login callback.
 * @example
 * await checkSession();
 */
export function checkSession(): Promise<void>

/**
 * Handle login form submission.
 * @example
 * loginForm.addEventListener('submit', handleLoginSubmit);
 */
export function handleLoginSubmit(e: SubmitEvent): Promise<void>

/**
 * Initialize authentication handlers.
 * Sets up login form submission and logout button.
 * @example
 * initAuth(() => { loadAllData(); });
 */
export function initAuth(loginCallback: VoidCallback): void

/** @file state.js - Types for shared admin dashboard state */

export interface AdminState {
  csrfToken: string | null
  currentGuests: Guest[]
  currentPage: number
  PAGE_SIZE: number
  currentPetitions: Petition[]
  currentBlocklist: BlocklistEntry[]
  currentModeration: ModerationItem[]
  currentAccounts: AccountRow[]
  currentCurated: MediaListItem[]
  onAuthRequired: () => void
  getGuestById: (id: number) => Guest | null
  getBlockedEntryById: (id: number) => BlocklistEntry | null
  getPetitionById: (id: number) => Petition | null
  getAccountById: (id: number) => AccountRow | null
  getCuratedById: (id: number) => MediaListItem | null
}

/** @file moderation.js - Types for the admin Moderation tab (Phase 6: full queue) */

export type ModerationContentType = "guestbook" | "media" | "comment"

/**
 * One row of the combined moderation queue. Text types (guestbook, comment) carry
 * a `message`; media carries `file_key`/`kind`/`caption`/`needs_display` instead.
 * `author_name`/`author_trusted` are null for admin/official rows (account_id null).
 */
export interface ModerationItem {
  content_type: ModerationContentType
  id: number
  account_id: number | null
  author_name: string | null
  author_relation: string | null
  author_trusted: boolean | null
  status: string
  created_at: string
  message: string | null
  target_type: string | null
  target_id: number | null
  file_key: string | null
  kind: string | null
  caption: string | null
  needs_display: boolean | null
}

export interface ModerationQueueResponse {
  items: ModerationItem[]
  type: string | null
  status: string
  hasMore: boolean
}

export interface ModerationActionResponse {
  success: boolean
  autoTrusted: boolean
  released: number
}

export interface ModerationBulkResponse {
  success: boolean
  changed: number
  total: number
  /** How many previously-untrusted authors were auto-trusted by this approve. */
  trusted: number
}

export interface ModerationCountsResponse {
  guestbook: number
  media: number
  comments: number
  total: number
}

/** One account row as projected by GET /api/admin/accounts (booleans, source). */
export interface AccountRow {
  id: number
  name: string
  relation: string | null
  trusted: boolean
  source: string
  guest_id: number | null
  contact_email: string | null
  post_count: number
  created_at: string
}

export interface AccountsResponse {
  accounts: AccountRow[]
  total: number
}

/** Load the combined queue (current filters) into the Moderation table. */
export function loadModeration(): Promise<void>

/** Refresh the Moderation tab badge from the counts endpoint. */
export function loadModerationCount(): Promise<void>

/** Set the Moderation tab badge value/visibility. */
export function updateModerationBadge(count: number): void

/** Wire up the Moderation tab (sub-toggle, queue table, accounts table, modals). */
export function initModeration(): void

/** @file gallery-admin.js - Types for the admin curated-gallery manager (Phase 6) */

/** Load the official section into the curated grid. */
export function loadGalleryAdmin(): Promise<void>

/** Wire up the curated grid, reorder buttons, caption inputs, and upload modal. */
export function initGalleryAdmin(): void

/** @file blocklist.js - Types for blocklist management module */

export interface BlocklistResponse {
  blocklist: BlocklistEntry[]
}

/**
 * Module state for blocklist operations.
 * @example
 * const state: BlocklistState = { deleteId: null };
 * state.deleteId = 5;
 */
export interface BlocklistState {
  deleteId: number | null
}

/**
 * Load and display blocklist entries.
 * @example
 * await loadBlocklist();
 */
export function loadBlocklist(): Promise<void>

/**
 * Render blocklist entries to the table.
 * @example
 * renderBlocklist(entries);
 */
export function renderBlocklist(entries: BlocklistEntry[]): void

/**
 * Open the add to blocklist modal.
 * @example
 * openAddBlocklistModal();
 */
export function openAddBlocklistModal(): void

/**
 * Handle blocklist form submission.
 * @example
 * form.addEventListener('submit', handleBlocklistFormSubmit);
 */
export function handleBlocklistFormSubmit(e: SubmitEvent): Promise<void>

/**
 * Open the remove from blocklist confirmation modal.
 * @example
 * confirmRemoveBlocklist(5);
 */
export function confirmRemoveBlocklist(id: number): void

/**
 * Handle blocklist delete confirmation.
 * @example
 * confirmBtn.addEventListener('click', handleBlocklistDeleteConfirm);
 */
export function handleBlocklistDeleteConfirm(): Promise<void>

/**
 * Handle click events on blocklist table.
 * @example
 * tbody.addEventListener('click', handleBlocklistTableClick);
 */
export function handleBlocklistTableClick(e: MouseEvent): void

/**
 * Initialize blocklist management.
 * @example
 * initBlocklist();
 */
export function initBlocklist(): void

/** @file csv-import.js - Types for CSV import module */

/**
 * CSV parse result row as array of strings.
 * @example
 * const row: CsvRow = ['John', 'john@example.com', '555-1234'];
 */
export type CsvRow = string[]

/**
 * Skipped record from import.
 * @example
 * const skip: SkippedRecord = { line: 3, name: 'John', reason: 'duplicate' };
 */
export interface SkippedRecord {
  line: number
  name: string
  reason: string
}

/**
 * Error record from import.
 * @example
 * const err: ErrorRecord = { line: 5, error: 'Missing name' };
 */
export interface ErrorRecord {
  line: number
  error: string
}

/**
 * Import API response.
 * @example
 * const result: ImportResult = { added: 10, skipped: [], errors: [] };
 */
export interface ImportResult {
  added: number
  skipped: SkippedRecord[]
  errors: ErrorRecord[]
}

/**
 * Module state for CSV import.
 * @example
 * const state: CsvImportState = { csvData: null };
 */
export interface CsvImportState {
  csvData: string | null
}

/**
 * Parse a CSV row handling quoted fields.
 * @example
 * parseRow('John,"Doe, Jr.",email') // ['John', 'Doe, Jr.', 'email']
 */
export function parseRow(row: string): CsvRow

/**
 * Show CSV preview table.
 * @example
 * showCSVPreview(csvText);
 */
export function showCSVPreview(csvText: string): void

/**
 * Open the import CSV modal.
 * @example
 * openImportModal();
 */
export function openImportModal(): void

/**
 * Handle file selection event.
 * @example
 * input.addEventListener('change', handleFileSelect);
 */
export function handleFileSelect(e: Event): Promise<void>

/**
 * Handle import submission.
 * @example
 * btn.addEventListener('click', handleImportSubmit);
 */
export function handleImportSubmit(): Promise<void>

/**
 * Initialize CSV import functionality.
 * @example
 * initCSVImport();
 */
export function initCSVImport(): void

/** @file dashboard.js - Types for admin dashboard main entry point */

/**
 * Handle successful login by loading initial data.
 * Loads stats, guests, and petition count.
 * @example
 * initAuth(onLoginSuccess);
 */
export function onLoginSuccess(): void

/**
 * Switch to a specific tab and load its data.
 * Handles ARIA attributes, visibility, and lazy loading of tab content.
 * @example
 * switchTab("guests");
 * switchTab("rsvps");
 * switchTab("petitions");
 */
export function switchTab(tabId: string): void

/**
 * Initialize tab navigation event listeners.
 * @example
 * initTabs();
 */
export function initTabs(): void

/**
 * Initialize the entire dashboard.
 * Sets up modals, auth, guests, tabs, invites, CSV import, petitions, and blocklist.
 * @example
 * init();
 */
export function init(): void

/** @file guests.js - Types for guest management module */

/**
 * Stats API response.
 * @example
 * const response: StatsApiResponse = { stats: { total_guests: 100, ... } };
 */
export interface StatsApiResponse {
  stats: Stats
}

/**
 * Guests API response with pagination.
 * @example
 * const response: GuestsApiResponse = { guests: [], pagination: { total: 0, limit: 25, offset: 0 } };
 */
export interface GuestsApiResponse {
  guests: GuestWithInviteCount[]
  pagination: PaginationInfo
}

/**
 * Module state for guest operations.
 * @example
 * const state: GuestModuleState = { deleteId: null, searchTimeout: undefined };
 */
export interface GuestModuleState {
  deleteId: number | null
  restoreId: number | null
  searchTimeout: ReturnType<typeof setTimeout> | undefined
}

/**
 * Load stats and update dashboard counters.
 * @example
 * await loadStats();
 */
export function loadStats(): Promise<void>

/**
 * Load guests with pagination, search, and filtering.
 * @example
 * await loadGuests();
 */
export function loadGuests(): Promise<void>

/**
 * Render guest table.
 * @example
 * renderGuests(guests, pagination);
 */
export function renderGuests(
  guests: GuestWithInviteCount[],
  pagination: PaginationInfo,
): void

/**
 * Render pagination controls.
 * @example
 * renderPagination(pagination);
 */
export function renderPagination(pagination: PaginationInfo): void

/**
 * Navigate to a specific page.
 * @example
 * goToPage(2);
 */
export function goToPage(page: number): void

/**
 * Open add guest modal.
 * @example
 * openAddGuestModal();
 */
export function openAddGuestModal(): void

/**
 * Edit a guest.
 * @example
 * editGuest(5);
 */
export function editGuest(id: number): void

/**
 * Open delete confirmation modal.
 * @example
 * confirmDeleteGuest(5);
 */
export function confirmDeleteGuest(id: number): void

/**
 * Open the restore-confirmation dialog for a soft-deleted guest.
 * @example
 * restoreGuest(5);
 */
export function restoreGuest(id: number): void

/**
 * Handle guest form submission.
 * @example
 * form.addEventListener('submit', handleGuestFormSubmit);
 */
export function handleGuestFormSubmit(e: SubmitEvent): Promise<void>

/**
 * Handle delete confirmation click.
 * @example
 * btn.addEventListener('click', handleDeleteConfirm);
 */
export function handleDeleteConfirm(): Promise<void>

/**
 * Handle restore confirmation click.
 * @example
 * btn.addEventListener('click', handleRestoreConfirm);
 */
export function handleRestoreConfirm(): Promise<void>

/**
 * Handle search input.
 * @example
 * input.addEventListener('input', handleSearchInput);
 */
export function handleSearchInput(): void

/**
 * Handle guest table click events.
 * @example
 * tbody.addEventListener('click', handleGuestsTableClick);
 */
export function handleGuestsTableClick(e: MouseEvent): void

/**
 * Handle pagination click events.
 * @example
 * container.addEventListener('click', handlePaginationClick);
 */
export function handlePaginationClick(e: MouseEvent): void

/**
 * Initialize guest management.
 * @example
 * initGuests();
 */
export function initGuests(): void

/** @file invites.js - Types for invite wizard module */

/**
 * Email service configuration.
 * @example
 * const config: ServiceConfig = { configured: true };
 */
export interface ServiceConfig {
  configured: boolean
  /** The default invite body (with {name}/{url} placeholders) for this channel. */
  defaultMessage: string
}

/**
 * Invite configuration response.
 * @example
 * const config: InviteConfig = { email: { configured: true }, sms: { configured: false } };
 */
export interface InviteConfig {
  email: ServiceConfig
  sms: ServiceConfig
}

/**
 * Skipped guest in invite preview.
 * @example
 * const skipped: SkippedGuest = { id: 1, name: 'John', reason: 'No contact info' };
 */
export interface SkippedGuest {
  id: number
  name?: string
  reason: string
}

/**
 * Recipient in invite preview.
 * @example
 * const recipient: InviteRecipient = { name: 'John', contact: 'john@example.com', messagePreview: 'Hello...' };
 */
export interface InviteRecipient {
  name: string
  contact: string
  messagePreview: string
}

/**
 * Invite preview response.
 * @example
 * const preview: InvitePreviewData = { recipients: [], skipped: [], totalToSend: 5 };
 */
export interface InvitePreviewData {
  recipients: InviteRecipient[]
  skipped: SkippedGuest[]
  totalToSend: number
}

/**
 * Failed invite result.
 * @example
 * const failed: FailedInvite = { name: 'John', error: 'Invalid email' };
 */
export interface FailedInvite {
  name: string
  error: string
}

/**
 * Invite send results.
 * @example
 * const results: InviteResults = { sent: [], failed: [], skipped: [] };
 */
export interface InviteResults {
  sent: string[]
  failed: FailedInvite[]
  skipped: SkippedGuest[]
}

/**
 * Invite send summary.
 * @example
 * const summary: InviteSummary = { sent: 10, failed: 2, skipped: 1 };
 */
export interface InviteSummary {
  sent: number
  failed: number
  skipped: number
}

/**
 * Invite send response.
 * @example
 * const response: InviteSendResult = { summary: {...}, results: {...} };
 */
export interface InviteSendResult {
  summary: InviteSummary
  results: InviteResults
}

/**
 * Full invitable-guest set for the current filter/search — the TRUE "Send Invites"
 * audience across every page, not just the rows currently rendered.
 * @example
 * const res: InvitableIdsResponse = { guestIds: [1, 2, 3], pending: 2, invited: 1 };
 */
export interface InvitableIdsResponse {
  guestIds: number[]
  pending: number
  invited: number
}

/**
 * Wizard step names.
 */
export type InviteStep = "config" | "preview" | "results"

/**
 * Module state for invite wizard.
 * @example
 * const state: InviteModuleState = { step: 'config', guestIds: [], config: null, previewData: null };
 */
export interface InviteModuleState {
  step: InviteStep
  guestIds: number[]
  config: InviteConfig | null
  previewData: InvitePreviewData | null
}

/**
 * Update invite config UI based on service status.
 * @example
 * updateInviteConfigUI();
 */
export function updateInviteConfigUI(): void

/**
 * Render invite preview step.
 * @example
 * renderInvitePreview();
 */
export function renderInvitePreview(): void

/**
 * Render invite results step.
 * @example
 * renderInviteResults(result);
 */
export function renderInviteResults(result: InviteSendResult): void

/**
 * Open send invites modal.
 * @example
 * await openSendInvitesModal();
 */
export function openSendInvitesModal(): Promise<void>

/**
 * Handle next button in invite wizard.
 * @example
 * btn.addEventListener('click', handleInviteNext);
 */
export function handleInviteNext(): Promise<void>

/**
 * Handle back button in invite wizard.
 * @example
 * btn.addEventListener('click', handleInviteBack);
 */
export function handleInviteBack(): void

/**
 * Initialize invite wizard.
 * @example
 * initInvites();
 */
export function initInvites(): void

/** @file utils.js - Types for notification banner & modal management utilities  */

/** Show an error notification in the banner.
 * @example
 * showError('An error occurred');
 */
export function showError(message: string): void

/** Show a success notification in the banner.
 * @example
 * showSuccess('Trusted Dana Smith · released 3 items');
 */
export function showSuccess(message: string): void

/** Clear any existing notification from the banner.
 * @example
 * clearNotification();
 */
export function clearNotification(): void

/** Render a centered spinner into a tab container while its data loads, so a
 * slow fetch doesn't leave the prior tab's stale rows in place. For a
 * `<tbody>`, pass the table's column count so the row spans full width.
 * @example
 * showLoading(getElement('guests-tbody'), 6);
 */
export function showLoading(el: HTMLElement, colspan?: number): void

/**
 * Open a modal dialog with optional focus return support.
 * Uses native HTMLDialogElement.showModal() which provides:
 * - Automatic focus trapping
 * - ESC key to close
 * - Inert background
 * @example
 * const dialog = document.getElementById('my-modal');
 * openModal(dialog);
 *
 * // With trigger for focus return
 * openModal(dialog, triggerButton);
 */
export function openModal(
  dialog: HTMLDialogElement,
  trigger?: HTMLElement,
): void

/**
 * Close a modal dialog and return focus to trigger element.
 * @example
 * const dialog = document.getElementById('my-modal');
 * closeModal(dialog);
 */
export function closeModal(dialog: HTMLDialogElement): void

/**
 * Initialize modal event listeners for all dialog elements.
 * Sets up close button handlers, backdrop click handling, and focus return.
 * Call once on page load.
 * @example
 * // In your init function
 * initModals();
 */
export function initModals(): void

/** @file confirm.js - Shared styled confirm dialog for destructive actions */

/** Configuration for a single {@link openConfirm} invocation. */
export interface ConfirmConfig {
  /** Dialog heading. */
  title: string
  /** Body copy spelling out the consequence. */
  desc: string
  /** Label for the confirm button. */
  confirmLabel: string
  /** Style the confirm button as destructive (btn-danger) vs primary. */
  danger: boolean
  /** The action to run on confirm; errors surface inline, keeping it open. */
  run: () => Promise<void>
}

/** Open the shared confirm dialog with the given copy + action. */
export function openConfirm(cfg: ConfirmConfig): void

/** Wire the shared confirm dialog's confirm button. Call once on load. */
export function initConfirmDialog(): void

/** @file petitions.js - Types for petition management module */

/**
 * Petition counts by status.
 * @example
 * const counts: PetitionCounts = { pending: 5 };
 */
export interface PetitionCounts {
  pending: number
}

/**
 * Petitions API response with counts.
 * @example
 * const response: PetitionsWithCountsResponse = { petitions: [], counts: { pending: 0 } };
 */
export interface PetitionsWithCountsResponse {
  petitions: Petition[]
  counts: PetitionCounts
}

/**
 * Update the petition badge count.
 * @example
 * updatePetitionBadge(5);
 */
export function updatePetitionBadge(count: number): void

/**
 * Load petitions with optional status filter.
 * @example
 * await loadPetitions();
 */
export function loadPetitions(): Promise<void>

/**
 * Load just the petition count for badge.
 * @example
 * await loadPetitionCount();
 */
export function loadPetitionCount(): Promise<void>

/**
 * Render petitions table.
 * @example
 * renderPetitions(petitions);
 */
export function renderPetitions(petitions: Petition[]): void

/**
 * View petition details modal.
 * @example
 * viewPetition(5);
 */
export function viewPetition(id: number): void

/**
 * Open approve petition modal.
 * @example
 * openApprovePetition(5);
 */
export function openApprovePetition(id: number): void

/**
 * Open deny petition modal.
 * @example
 * openDenyPetition(5);
 */
export function openDenyPetition(id: number): void

/**
 * Handle approve confirmation click.
 * @example
 * btn.addEventListener('click', handleApproveConfirm);
 */
export function handleApproveConfirm(): Promise<void>

/**
 * Handle deny confirmation click.
 * @example
 * btn.addEventListener('click', handleDenyConfirm);
 */
export function handleDenyConfirm(): Promise<void>

/**
 * Handle petitions table click events.
 * @example
 * tbody.addEventListener('click', handlePetitionsTableClick);
 */
export function handlePetitionsTableClick(e: MouseEvent): void

/**
 * Initialize petition management.
 * @example
 * initPetitions();
 */
export function initPetitions(): void

/** @file rsvps.js - Types for RSVP list display module */

export interface RSVPsResponse {
  rsvps: RSVPWithGuest[]
}

/**
 * Render RSVP data to the table body.
 * Shows name, attendance status, party size, dietary info, and date.
 * @example
 * renderRsvps(rsvps);
 */
export function renderRsvps(rsvps: RSVPWithGuest[]): void

/**
 * Load RSVPs from API and render them to the table.
 * @example
 * await loadRsvps();
 */
export function loadRsvps(): Promise<void>

/** @file manual-sms.js - Types for manual SMS copy-paste texting module */

/**
 * Guest eligible for manual SMS.
 * @example
 * const guest: EligibleGuest = { id: 1, name: 'John', phone: '555-1234', invite_code: 'ABC123', status: 'pending', last_invited_at: null };
 */
export interface EligibleGuest {
  id: number
  name: string
  phone: string
  invite_code: string
  status: string
  last_invited_at: string | null
}

/**
 * Wedding info used for message template rendering.
 * @example
 * const info: WeddingInfo = { date: '2026-06-15', location: 'Beach', coupleNames: 'A & B', baseUrl: 'https://example.com' };
 */
export interface WeddingInfo {
  date: string
  location: string
  coupleNames: string
  baseUrl: string
}

/**
 * Module state for manual SMS operations.
 * @example
 * const state: ManualSmsState = { viewMode: 'focus', template: '', guests: [], weddingInfo: null, currentIndex: 0, sentIds: new Set() };
 */
export interface ManualSmsState {
  viewMode: string
  template: string
  guests: EligibleGuest[]
  weddingInfo: WeddingInfo | null
  currentIndex: number
  sentIds: Set<number>
}

/**
 * Response data from the manual SMS guests endpoint.
 * @example
 * const data: ManualSmsData = { guests: [], wedding: null, defaultTemplate: 'Hello {name}' };
 */
export interface ManualSmsData {
  guests: EligibleGuest[]
  wedding: WeddingInfo | null
  defaultTemplate: string
}

/**
 * Render a message template with guest and wedding info placeholders.
 * @example
 * const msg = renderMessage('Hi {name}, RSVP at {url}', guest);
 */
export function renderMessage(
  template: string,
  guest: EligibleGuest,
): string

/**
 * Copy text to clipboard with button feedback.
 * @example
 * await copyToClipboard('Hello', button);
 */
export function copyToClipboard(
  text: string,
  button: HTMLButtonElement,
): Promise<void>

/**
 * Get the current message template from the textarea or module state.
 * @example
 * const tpl = getTemplate();
 */
export function getTemplate(): string

/**
 * Update the progress counter display.
 * @example
 * updateProgressCounter();
 */
export function updateProgressCounter(): void

/**
 * Render the focus (single-guest) view.
 * @example
 * renderFocusView();
 */
export function renderFocusView(): void

/**
 * Render the list (all-guests) view.
 * @example
 * renderListView();
 */
export function renderListView(): void

/**
 * Render whichever view mode is currently active.
 * @example
 * renderCurrentView();
 */
export function renderCurrentView(): void

/**
 * Mark a guest as sent via the API and update local state.
 * @example
 * await markGuestSent(5);
 */
export function markGuestSent(guestId: number): Promise<void>

/**
 * Type guard for manual SMS API response data.
 * @example
 * if (isManualSmsData(data)) { ... }
 */
export function isManualSmsData(data: unknown): data is ManualSmsData

/**
 * Open the manual SMS modal and load eligible guests.
 * @example
 * await openManualSmsModal();
 */
export function openManualSmsModal(): Promise<void>

/**
 * Handle closing the manual SMS modal and refreshing data.
 * @example
 * await handleDone();
 */
export function handleDone(): Promise<void>

/**
 * Switch between focus and list view modes.
 * @example
 * switchViewMode('list');
 */
export function switchViewMode(mode: string): void

/**
 * Initialize manual SMS module event listeners.
 * @example
 * initManualSms();
 */
export function initManualSms(): void
