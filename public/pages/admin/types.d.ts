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
  GiftWithGuest,
  ThankYouCardWithGuest,
  ThankYouCard,
  ThankYouCardReply,
} from "../../../types.js"
import type { CardEffectEntry, ThankYouMediaItem } from "../thanks/types.js"

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
 * @param loginCallback Runs after a successful login / session check.
 * @param logoutCallback Runs whenever the login screen is shown (logout, expiry,
 *   401) — use it to tear down logged-in-session timers.
 * @example
 * initAuth(() => { loadAllData(); }, () => { stopBadgePolling(); });
 */
export function initAuth(
  loginCallback: VoidCallback,
  logoutCallback?: VoidCallback,
): void

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
  currentGifts: GiftWithGuest[]
  currentCards: ThankYouCardWithGuest[]
  onAuthRequired: () => void
  getGuestById: (id: number) => Guest | null
  getBlockedEntryById: (id: number) => BlocklistEntry | null
  getPetitionById: (id: number) => Petition | null
  getAccountById: (id: number) => AccountRow | null
  getCuratedById: (id: number) => MediaListItem | null
  getGiftById: (id: number) => GiftWithGuest | null
  getCardById: (id: number) => ThankYouCardWithGuest | null
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
  /** Comment rows only: the parent's snippet (guestbook message / media caption),
   *  author name, and — for a media parent — its file_key + kind (to pick the
   *  thumbnail variant). Null on non-comment rows and where a field is absent. */
  parent_snippet: string | null
  parent_author: string | null
  parent_file_key: string | null
  parent_kind: string | null
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
  /** The item's status BEFORE this transition, so an Undo knows what to revert to. */
  previousStatus: string
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

/** GET /api/admin/media/:id/references — thank-you card reference counts for a
 *  photo, so a Remove/Reject/Hide confirm can warn about cards it would strip. */
export interface MediaReferencesResponse {
  /** All non-deleted cards (any status) that embed this photo. */
  cardRefs: number
  /** The sent/viewed subset — already delivered, so what the warning names. */
  deliveredCardRefs: number
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
export function loadModerationCount(): Promise<number>

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

/** Inline load-failure state with a "Try again" button (replaces the target's
 * content; table bodies get a spanning row). The transient banner alone leaves
 * a failed view stuck on its spinner. */
export function showLoadError(
  el: HTMLElement,
  colspan: number,
  message: string,
  retry: () => void,
): void

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

/** @file thank-you.js — Types for the admin "Thank yous" tab (gift log, card
 *  list, composer with live iframe preview, send wizard). */

/** GET /api/admin/gifts */
export interface GiftsResponse {
  gifts: GiftWithGuest[]
}

/** GET /api/admin/thank-you */
export interface CardsResponse {
  cards: ThankYouCardWithGuest[]
}

/** GET /api/admin/thank-you/counts */
export interface ThankYouCounts {
  unreadReplies: number
  drafts: number
}

/** One "Most loved" guest media item in the gallery manager (A3). */
export interface LovedMediaItem {
  id: number
  file_key: string
  kind: string
  caption: string | null
  author_name: string | null
  needs_display: boolean
  reaction_count: number
}

/** Response of GET /api/admin/media/guest-loved. */
export interface LovedMediaResponse {
  items: LovedMediaItem[]
}

/** One reply in the cross-card Mailbox / Inbox feed (GET
 *  /api/admin/thank-you/replies). Mirrors db RecentReply. */
export interface ThankYouRecentReply {
  id: number
  cardId: number
  emoji: string | null
  message: string | null
  createdAt: string
  guestName: string
  cardToken: string
  unread: boolean
}

/** Response of GET /api/admin/thank-you/replies. */
export interface ThankYouRepliesResponse {
  replies: ThankYouRecentReply[]
}

/** Per-channel availability + default template for the send wizard. */
export interface ThankYouSendChannel {
  configured: boolean
  defaultMessage: string
}

/** GET /api/admin/thank-you/config */
export interface ThankYouSendConfig {
  email: ThankYouSendChannel
  sms: ThankYouSendChannel
  /** When true, the admin is emailed the moment a card gets its first reply.
   *  Optional/defensive: absent on older backends → treated as off. */
  replyPingEnabled?: boolean
}

/** POST /api/admin/thank-you/preview response. */
export interface ThankYouPreviewResponse {
  type: string
  recipient: {
    id: number
    name: string
    contact: string | null
    messagePreview?: string
  }
  /** Full branded email HTML for the email channel; null/absent for sms/manual
   *  or older backends (falls back to the text messagePreview). */
  emailHtml?: string | null
  skipped: { reason: string } | null
}

/** One gift as projected by GET /api/admin/guests/:id/story. */
export interface GuestStoryGift {
  id: number
  description: string | null
  amount: string | null
  receivedAt: string | null
  physicalCardSent: boolean
}

/** One card as projected by GET /api/admin/guests/:id/story. */
export interface GuestStoryCard {
  id: number
  status: string
  sentAt: string | null
  viewedAt: string | null
  repliedAt: string | null
  replySeen: boolean
}

/** GET /api/admin/guests/:id/story — everything we know about one guest's
 *  relationship to the wedding, for the composer sidecar + guest-detail line. */
export interface GuestStory {
  guest: { id: number; name: string }
  rsvpNote: string | null
  guestbookEntry: { message: string; createdAt: string } | null
  media: { fileKey: string; kind: string }[]
  gifts: GuestStoryGift[]
  cards: GuestStoryCard[]
}

/** Card status filter buckets for the list view (task 2). */
export type ThankYouCardFilter = "all" | "draft" | "sent/unopened" | "viewed" | "unread"

/** { success, card } from create/update/mark-sent. */
export interface ThankYouCardResponse {
  success: true
  card?: ThankYouCard
}

/** A warm starter message for the composer's template picker (E4). Item-based
 *  templates carry a `{gift}` slot; `giftFallback` fills it when the linked gift
 *  has no description, so the sentence still reads naturally (task 2). */
export interface ThankYouTemplate {
  id: string
  label: string
  message: string
  giftFallback?: string
}

/** GET /api/admin/thank-you/:id — a single card joined with its recipient name
 *  plus the full reply thread (ascending). */
export interface ThankYouCardDetail extends ThankYouCardWithGuest {
  replies: ThankYouCardReply[]
}

/** GET /api/admin/thank-you/:id response envelope. */
export interface ThankYouCardDetailResponse {
  card: ThankYouCardDetail
}

/** POST /api/admin/thank-you/:id/resend response. `reset` re-drafts a sent-but-
 *  unopened card (same token); `duplicate` clones an opened card to a fresh draft
 *  (new id + token). */
export interface ThankYouResendResponse {
  mode: "reset" | "duplicate"
  card: ThankYouCard
}

/** Seed passed to openEditor when opening the composer. */
export interface OpenEditorInput {
  cardId: number | null
  guestId: number
  giftId: number | null
  recipientName: string
  giftLabel: string
  message: string
  theme: string
  reveal: string
  effects: CardEffectEntry[]
  mediaKeys: string[]
  mediaItems: ThankYouMediaItem[]
  isNew: boolean
  customized: boolean
}

/** The card currently being composed. */
export interface ThankYouDraft {
  cardId: number | null
  guestId: number
  giftId: number | null
  recipientName: string
  message: string
  theme: string
  reveal: string
  effects: CardEffectEntry[]
  mediaKeys: string[]
  mediaItems: ThankYouMediaItem[]
}

/** Send-wizard state (config → preview → results for one card). */
export interface ThankYouWizardState {
  cardId: number
  recipientName: string
  step: "config" | "preview" | "results"
  config: ThankYouSendConfig | null
}

/** Photo-picker state. */
export interface ThankYouPickerState {
  section: "official" | "guest"
  selected: Set<string>
}

/** The tab's module-level state. */
export interface ThankYouModuleState {
  view: "list" | "editor"
  dirty: boolean
  effectsCustomized: boolean
  /** Whether the couple has hand-edited the message — guards "↻ Reroll" from
   *  silently replacing real writing (D2). */
  messageCustomized: boolean
  /** How many times Reroll has cycled the current draft (deterministic rotation). */
  rerollCount: number
  guestsLoaded: boolean
  guestOptions: { id: number; name: string }[]
  /** The site's active effect theme, cached for seeding new cards (E4). Null
   *  until first loaded; falls back to the composer default. */
  siteTheme: string | null
  draft: ThankYouDraft | null
  previewReady: boolean
  pendingPush: boolean
  wizard: ThankYouWizardState | null
  picker: ThankYouPickerState
  /** Active card status filter bucket (task 2). Persists across in-tab reloads. */
  cardFilter: ThankYouCardFilter
  /** Case-insensitive guest-name substring filtering both tables (task 2). */
  nameQuery: string
  /** Live-preview device width; mobile is the default (phone-first guests). */
  previewDevice: "mobile" | "desktop"
  /** Cached "email me on first reply" config toggle (task 6). */
  replyPingEnabled: boolean
  /** The open card recipient's story, for the composer sidecar (task 7). */
  story: GuestStory | null
  /** Cards ⇆ Mailbox sub-view within the list view (D1). */
  subView: "cards" | "mailbox"
  /** When true, entering the tab lands on the Mailbox (set by the Inbox jump). */
  mailboxOnLoad: boolean
}

export function initThankYous(): void
export function loadThankYous(): Promise<void>
export function loadThankYouCount(): Promise<void>
export function isThankYousDirty(): boolean
/** Ask the thank-you tab to open on the Mailbox next time it loads (Inbox jump). */
export function requestThankYouMailbox(): void

// ---- Inbox (A1) ----
export function initInbox(): void
export function loadInbox(): Promise<void>
/** Badge-only refresh (piggybacks on main.js's existing poll). */
export function refreshInboxBadge(): Promise<void>

/** @file face-assignment.js — Types for the admin Faces tab (assisted face
 *  tagging against the guest roster, docs/post-wedding/SPEC-vision-lab.md
 *  §6.5). Built against a server contract that has no crop endpoint, so a
 *  face is displayed by cropping the media's existing `thumb` variant
 *  client-side to the face's box — which needs the ORIGINAL photo's pixel
 *  width/height alongside the box. The contract's overview/queue payloads
 *  name only `faceId`/`mediaId`/`box` on each entry; `fileKey`, `width` and
 *  `height` here are an ASSUMED addition (matching MediaListItem's fields),
 *  not confirmed against a running server. If the server omits them, the
 *  chip degrades to an uncropped thumbnail rather than failing. */

/** A face's pixel bounding box, in the ORIGINAL photo's coordinate space. */
export interface FaceBox {
  x: number
  y: number
  w: number
  h: number
}

/**
 * One face's appearance, as needed to render a cropped chip for it (used by
 * both a group's member grid and an ask-queue row). `fileKey`/`width`/`height`
 * are the assumed addition described above — everything else is the given
 * contract's shape verbatim.
 */
export interface FaceChipEntry {
  faceId: number
  mediaId: number | null
  /** Null only if the media row vanished between queries. */
  fileKey: string | null
  /** The ORIGINAL photo's pixel width, or null if unknown (chip falls back
   *  to an uncropped thumbnail — see positionFaceChipImage). */
  width: number | null
  height: number | null
  box: FaceBox | null
}

/** A named-group's system-suggested identity (from prototype matching against
 *  already-confirmed faces), pre-filling — never auto-submitting — the
 *  group's name input. */
export interface FaceGroupSuggestion {
  personId: number
  personName: string
  /** NULL when the match was unopposed — matchFace reports `Infinity` for a
   *  face with exactly one prototype to compare against, and JSON has no
   *  Infinity. Which is the state right after the FIRST person is named. */
  margin: number | null
}

/**
 * How likely a group is to be two people welded together: its widest internal
 * pair, over the grouping cutoff. Above 1 means the group contains two faces
 * further apart than the threshold that is supposed to separate people —
 * possible because the clustering is average-linkage, so a merge only needs the
 * MEAN below the cutoff.
 *
 * Present because the Phase 2 comparison established that on this cast, in both
 * descriptor spaces tried, no cutoff separates everyone without welding two
 * people. Welding is not a hypothetical here, and the fast path is a button
 * that names a whole group at once.
 */
export interface FaceGroupWeld {
  diameter: number
  ratio: number
}

/** One unnamed cluster from GET /api/admin/faces/overview, largest first. */
export interface FaceGroup {
  key: string
  /** Only the faces the admin can SEE — set-aside members are absent, so a
   *  bulk confirm cannot carry a face that was never on screen. */
  faceIds: number[]
  media: FaceChipEntry[]
  suggestion: FaceGroupSuggestion | null
  /** The FULL cluster size, including faces filtered out of the chips. */
  size: number
  /** How many of `size` were withheld by routing. */
  setAside: number
  /** Null for a single-face group — one face cannot be two people. */
  weld: FaceGroupWeld | null
}

export interface FaceOverviewCounts {
  faces: number
  identified: number
  unidentified: number
  notAFace: number
}

/** Live faces per routing state. `ungraded` is `route_state IS NULL` — rows
 *  written before routing existed. Not an omission and not a fourth quality
 *  band: they are shown and fully assignable. */
export interface FaceRouteCounts {
  accept: number
  ask: number
  setAside: number
  ungraded: number
}

/** GET /api/admin/faces/overview. */
export interface FacesOverviewResponse {
  counts: FaceOverviewCounts
  routeCounts: FaceRouteCounts
  groups: FaceGroup[]
}

/** One prototype-match candidate offered for an ask-queue face. */
export interface FaceCandidate {
  personId: number | null
  personName: string | null
  distance: number
  /** Null when unopposed — see FaceGroupSuggestion.margin. */
  margin: number | null
  /** How often this person already appears alongside the others in this photo. */
  cooccurrence: number
}

/** One row of GET /api/admin/faces/queue, ordered by `unlocks` descending —
 *  confirming it identifies the most further photo appearances. */
export interface FaceQueueItem extends FaceChipEntry {
  candidates: FaceCandidate[]
  unlocks: number
  /** Never `set_aside` — those do not reach the queue. Null = ungraded. */
  routeState: "accept" | "ask" | null
  /** Which accept condition held it back, for an `ask`. Null otherwise. */
  routeReason: string | null
}

/** GET /api/admin/faces/queue. */
export interface FacesQueueResponse {
  items: FaceQueueItem[]
  truncated: boolean
}

/** One must-link proposal from GET /api/admin/faces/propagations: a confirmed
 *  identity that could be carried onto this (unidentified) face because the
 *  two sit in near-duplicate frames with agreeing boxes AND agreeing
 *  descriptors. Applying it writes a second-class `propagated` identity that
 *  can never seed a prototype. */
export interface FacePropagation extends FaceChipEntry {
  toFaceId: number
  fromFaceId: number
  /** The confirmed face the identity is coming from. */
  from: FaceChipEntry | null
  personId: number | null
  personName: string | null
  /** Box overlap across the frame pair. */
  iou: number
  /** Cosine distance between the two descriptors — rule 3's corroboration. */
  distance: number
}

/** GET /api/admin/faces/propagations. */
export interface FacePropagationsResponse {
  items: FacePropagation[]
}

/** POST /api/admin/faces/assign response. `changed` is how many face rows the
 *  call actually moved onto the identity — it can be fewer than the request's
 *  faceIds.length when some were already assigned to that same person. */
export interface FaceAssignResponse {
  success: boolean
  personId: number
  identityId: number
  changed: number
}

/** POST /api/admin/faces/assign-one response. Same shape as the bulk assign,
 *  except `personId`/`identityId` are null when the call CLEARED the face
 *  (`personId: null` in the request is its own undo). */
export interface FaceAssignOneResponse {
  success: boolean
  personId: number | null
  identityId: number | null
  changed: number
}

/**
 * One face in GET /api/admin/media/:id/faces — every live face in one
 * photograph, whatever its routing state.
 *
 * The extra fields over `FaceChipEntry` are what this view needs and no other
 * does. `routeState` because a `set_aside` face is drawn differently and is the
 * reason the view exists; `provenance` because a `propagated` name is a
 * machine's inference and must not look like a human's; `identityId` because a
 * name can be attached without a live person row behind it.
 */
export interface MediaFaceEntry extends FaceChipEntry {
  personId: number | null
  personName: string | null
  identityId: number | null
  /** Null when unidentified. `propagated` = carried across a near-duplicate
   *  frame by must-link, never confirmed by a human. */
  provenance: "confirmed" | "propagated" | null
  /** Null = ungraded (ingested before quality routing existed). NOT a reason
   *  to hide or disable the face — treat it exactly like `accept`. */
  routeState: "accept" | "ask" | "set_aside" | null
}

/** GET /api/admin/media/:id/faces. */
export interface MediaFacesResponse {
  faces: MediaFaceEntry[]
}

/**
 * One photograph in GET /api/admin/faces/set-aside: a photograph holding at
 * least one live `set_aside` face.
 *
 * Counts and ids only. Nothing in this shape describes what the photograph
 * shows, and nothing built from it may either — an accessible name derived from
 * these fields says which photograph and how many faces, never who is in it.
 */
export interface FaceSetAsidePhoto {
  mediaId: number
  fileKey: string
  setAsideFaces: number
  /** How many of `setAsideFaces` are still unnamed. The number that moves:
   *  naming a set-aside face does not re-grade it, so `setAsideFaces` stays put
   *  and on its own would make the list look permanently untouched. */
  unnamedSetAside: number
  /** Every live face on the photograph, ungraded ones included — the honest
   *  denominator for "N of M faces here were set aside". */
  liveFaces: number
}

/** GET /api/admin/faces/set-aside. `limit`/`offset` echo back what the server
 *  actually APPLIED (it clamps), so "show more" can page from them safely. */
export interface FacesSetAsideResponse {
  photos: FaceSetAsidePhoto[]
  total: number
  limit: number
  offset: number
}

/** One row of GET /api/admin/faces/batches — a bulk pass, and enough about it
 *  to decide whether to take it back.
 *
 *  Ids, kinds, an actor, timestamps and counts. Nothing here names a person or
 *  a photograph: the list is about DECISIONS, not about who they were about. */
export interface FaceBatchEntry {
  batchId: string
  /** `manual` | `propagate` | `label-import` | `merge-repair`. Rendered through
   *  a label function — the enum value is a schema detail. */
  kind: string
  /** core/utils.js `actorId()` — eight hex characters of a session-token
   *  digest, which identifies a session and authenticates nobody. */
  actor: string
  note: string | null
  /** SQLite CURRENT_TIMESTAMP: "YYYY-MM-DD HH:MM:SS", UTC, and unmarked as
   *  such — see `ledgerTime` for why that matters when parsing it. */
  createdAt: string
  /** Null while the pass still counts. Set once and permanently. */
  revokedAt: string | null
  revokedBy: string | null
  /** Events on the pass. Zero is legitimate — the faces may since have been
   *  hard-deleted, which cascades their events away but not the batch. */
  events: number
  /** Distinct faces the pass touched: what revoking would re-derive. */
  faces: number
}

/** GET /api/admin/faces/batches. `limit` echoes what the server APPLIED. */
export interface FacesBatchesResponse {
  batches: FaceBatchEntry[]
  limit: number
}

/** POST /api/admin/faces/revoke. `reprojected` is every face the pass touched,
 *  not how many changed value — a face corrected by hand after the pass is
 *  re-derived and comes out exactly as it was left, which is the promise being
 *  kept rather than a shortfall. `alreadyRevoked` distinguishes a fresh undo
 *  from a second click on one that already happened. */
export interface FaceRevokeResponse {
  success: boolean
  batchId: string
  kind: string
  reprojected: number
  revokedAt: string | null
  revokedBy: string | null
  alreadyRevoked: boolean
}

/** A person in the photographed cast — who a face belongs to. Distinct from a
 *  guest, which is an INVITATION: one row per party, and much of the cast
 *  (partners under someone else's row, children, the photographer, vendors) is
 *  not on it at all. `guestId` is the optional link back to that roster. */
export interface PersonEntry {
  id: number
  displayName: string
  guestId: number | null
  /** Null when the person is off-roster, or when their guest row is deleted. */
  guestName: string | null
  notes: string | null
  /** Live face_identities rows pointing at this person. A person with any
   *  cannot be deleted — the delete endpoint refuses and says so. */
  identities: number
  /** Live faces those identities carry. */
  faces: number
}

/** GET /api/admin/people. */
export interface PeopleApiResponse {
  people: PersonEntry[]
}

/** One person as the write endpoints echo them back (no roll-up counts). */
export interface PersonPayload {
  id: number
  displayName: string
  guestId: number | null
  notes: string | null
}

/** POST /api/admin/people. A 409 instead means a live person already has this
 *  name; creating a second one is possible but must be confirmed explicitly. */
export interface PersonCreateResponse {
  success: boolean
  person: PersonPayload
}

/** PATCH /api/admin/people/:id. */
export interface PersonUpdateResponse {
  success: boolean
  person: PersonPayload
}

/** POST /api/admin/people/merge. `carriedGuestLink` is true when the source's
 *  roster link moved to the target because the target had none; an existing
 *  link on the target is never overwritten. */
export interface PersonMergeResponse {
  success: boolean
  movedFaces: number
  movedIdentities: number
  carriedGuestLink: boolean
}

/** Load the Faces tab's overview + ask queue + people list, then render. */
export function loadFaceAssignment(): Promise<void>

/** Wire up the Faces tab: the refresh button, the delegated
 *  click/keydown/input on the tab body (groups, ask queue, name-input
 *  autocomplete), and the per-photograph dialog's own listeners — that dialog
 *  lives OUTSIDE `#faces-body` and so inherits none of its delegation. */
export function initFaceAssignment(): void
