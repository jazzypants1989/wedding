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
  ThankYouCardListRow,
  ThankYouCard,
  ThankYouCardReply,
} from "../../../types.js"
import type { CardEffectEntry, ThankYouMediaItem } from "../thanks/types.js"
import type { EffectPage, EffectPlacement, EffectTheme } from "../../effects/types.js"

export type { SiteContent, SiteContentNavLink, SiteContentScheduleItem, SiteContentImage }

/** Response of GET/PUT/DELETE /api/admin/site-content. */
export interface SiteContentResponse {
  content: SiteContent
}

/** Response of GET/PUT/DELETE /api/admin/effect-config. The sparse override map
 *  `{ [effectId]: Partial<config> }`. */
export interface EffectConfigResponse {
  override: EffectOverride
}

/** The site-wide override blob: effect id → the keys it overrides. */
export type EffectOverride = Record<string, Record<string, unknown>>

/** @file effect-placement.js - the Effects tab's page table, without the DOM */

/** The textarea's text as an override, or null if the table can't work from it:
 *  not JSON, not an object, or an effect entry that isn't an object. Blank is {}. */
export function parseOverrideText(text: string): EffectOverride | null

/** An effect's `pages` as the override and theme say. Deliberately not
 *  getEffectiveConfig: that reads this browser's studio values and the stale
 *  attribute of whichever page it runs on. */
export function placementOf(override: EffectOverride, theme: EffectTheme, id: string): unknown

/** The placement after one page's tick. Every page ticked collapses to "all". */
export function toggledPlacement(current: unknown, page: EffectPage, on: boolean): EffectPlacement

/** A new override with this effect's `pages` set and every other key untouched. A
 *  placement equal to the theme's removes the key, and an entry left empty goes too. */
export function withPlacement(
  override: EffectOverride,
  theme: EffectTheme,
  id: string,
  next: EffectPlacement,
): EffectOverride

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
  currentCards: ThankYouCardListRow[]
  onAuthRequired: () => void
  getGuestById: (id: number) => Guest | null
  getBlockedEntryById: (id: number) => BlocklistEntry | null
  getPetitionById: (id: number) => Petition | null
  getAccountById: (id: number) => AccountRow | null
  getCuratedById: (id: number) => MediaListItem | null
  getGiftById: (id: number) => GiftWithGuest | null
  getCardById: (id: number) => ThankYouCardListRow | null
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
  /** What changed, with the status each left — what an Undo puts back. */
  items: ModerationChanged[]
  /** Accounts this batch auto-trusted (an Undo un-trusts them). */
  trustedAccounts: number[]
}

/** One post a batch changed, and the status it left. */
export interface ModerationChanged {
  type: ModerationContentType
  id: number
  previousStatus: string
}

/** POST /api/admin/accounts/:id/approve-pending — "Approve their N waiting". */
export interface ApproveWaitingResponse {
  success: boolean
  changed: number
  items: ModerationChanged[]
  trustedAccounts: number[]
}

/** POST /api/admin/moderation/restore — the Undo toast's call. */
export interface ModerationRestoreResponse {
  success: boolean
  restored: number
  untrusted: number
  total: number
}

/** GET /api/admin/moderation/:type/:id — one post in any status. */
export interface ModerationItemResponse {
  item: ModerationItem
}

/** The Review query string: ?status= &type= &author=a5. */
export interface ReviewFilter {
  status: "pending" | "approved" | "hidden" | "rejected"
  /** The URL's names (photo covers video); "" = everything. */
  type: "" | "photo" | "message" | "comment"
  author: number | null
}

/** The Accounts query string: ?trusted=1|0. */
export interface AccountsFilter {
  trusted: "" | "1" | "0"
}

/** How many of one author's posts sit in each status. */
export interface ModerationStatusCounts {
  pending: number
  approved: number
  hidden: number
  rejected: number
}

/** GET /api/admin/accounts/:id — an account row plus its per-status counts. */
export interface AccountDetail extends AccountRow {
  counts: ModerationStatusCounts
}

export interface AccountDetailResponse {
  account: AccountDetail
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
  /** Of those, how many wait for review. */
  pending_count: number
  created_at: string
  /** Newest activity on a live sign-in; null once they have all lapsed. */
  last_seen_at: string | null
}

export interface AccountsResponse {
  accounts: AccountRow[]
  total: number
}

/** Reload whichever view (Review or Accounts) is showing. Unused while the
 *  panel is registered (the router mounts it); kept for main.js's legacy hook. */
export function loadModeration(): Promise<void>

/** Refresh the Moderation tab badge from the counts endpoint. */
export function loadModerationCount(): Promise<number>

/** Set the Moderation tab badge value/visibility. */
export function updateModerationBadge(count: number): void

/** Register the Review + Accounts panel with the router and wire its panes. */
export function initModeration(): void

/** @file gallery-admin.js - Gallery: Official (curated order) | Most loved */

/** Load the official section into the curated grid. */
export function loadGalleryAdmin(): Promise<void>

/** Wire the grids, the upload dialog route and register the panel. */
export function initGalleryAdmin(): void

/** @file blocklist.js - Requests › Blocked (drawn inside the Requests split view) */

export interface BlocklistResponse {
  blocklist: BlocklistEntry[]
}

/** Load every blocklist entry. */
export function loadBlocklist(): Promise<void>

/** Blocked entries, newest first. */
export function blockedItems(): BlocklistEntry[]

/** The Blocked list pane's body (tools + rows), `selected` marked. */
export function blockedListMarkup(selected: number | null): string

/** The Blocked detail pane for one entry (or its empty state). */
export function blockedDetailMarkup(id: number | null): string

/** Reset the "Block someone" dialog route's form. */
export function prepareBlockForm(): void

/** Ask before unblocking; `next` names where to go once it's done. */
export function confirmUnblock(id: number, next: () => string): void

export function handleBlocklistFormSubmit(e: SubmitEvent): Promise<void>

export function handleBlocklistDeleteConfirm(): Promise<void>

/** Wire the Block someone form and the Unblock confirm. */
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

/** Reset the import dialog for a fresh arrival at /admin/guests/import. */
export function mountImport(): void

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
 * Show one section's panel (#tab-<id>) and load its data. Called by the router,
 * which decides the section from the path.
 */
export function showPanel(tabId: string): void

/**
 * Initialize the entire dashboard.
 * Sets up modals, auth, guests, tabs, invites, CSV import, petitions, and blocklist.
 * @example
 * init();
 */
export function init(): void

/** @file guests.js - Guests (one split view: invitations, RSVPs, and the people
 *  who signed in to the website) */

export interface StatsApiResponse {
  stats: Stats
}

/** GET /api/admin/guests: one page. */
export interface GuestsApiResponse {
  guests: GuestWithInviteCount[]
  pagination: PaginationInfo
}

/** The list's filter (`?rsvp=`): everyone, coming, can't come, no reply yet,
 *  the archived (soft-deleted) guests, or the people who signed up on the
 *  website without an invitation. */
export type GuestFilter = "all" | "yes" | "no" | "awaiting" | "archived" | "uninvited"

/** The whole roster, loaded once and filtered client-side (a wedding is small). */
export interface GuestsData {
  guests: GuestWithInviteCount[]
  /** Loaded the first time the Archived filter is shown. */
  archived: GuestWithInviteCount[] | null
  /** RSVPs by guest id. */
  rsvps: Map<number, RSVPWithGuest>
  /** Everyone who has signed in to the website (GET /api/admin/accounts). */
  accounts: AccountRow[]
  /** The sign-ins couldn't be loaded; the roster still shows. */
  accountsFailed: boolean
  stats: Stats | null
  loaded: boolean
}

/** What the list shows, from the URL. */
export interface GuestsView {
  filter: GuestFilter
  q: string
  /** The selected guest (`/admin/guests/g12`). */
  id: number | null
  /** The selected person with no invitation on the list (`/admin/guests/a7`). */
  person: number | null
  /** A person to point at on their household's page (arrived by `a7`). */
  focus: number | null
  items: RosterEntry[]
}

/** @file guest-accounts.js - the Guests list's rows: invitations with the
 *  people who signed in under them, and people with no invitation on the list */

/** One row of the Guests list. */
export type RosterEntry =
  | {
      kind: "guest"
      /** "g12": the row's selection, as in `/admin/guests/g12`. */
      key: string
      guest: GuestWithInviteCount
      /** The people who signed in with this invitation's code. */
      accounts: AccountRow[]
    }
  | {
      kind: "person"
      /** "a7" */
      key: string
      account: AccountRow
      /** Signed in with a code whose invitation is archived (not on the list). */
      archivedInvite: boolean
    }

export interface RosterInput {
  guests: readonly GuestWithInviteCount[]
  /** The archived guests, when the Archived filter has loaded them. */
  archived: readonly GuestWithInviteCount[] | null
  accounts: readonly AccountRow[]
  filter: GuestFilter
  q: string
  /** Where a guest's RSVP stands (the page owns the RSVP map). */
  rsvpOf: (g: GuestWithInviteCount) => "yes" | "no" | "awaiting"
}

/** A `:guest` selection: an invitation (`g12`) or a person who signed in (`a7`). */
export type RosterSel = { kind: "guest"; id: number } | { kind: "account"; id: number }

/** The people who signed in, by the invitation they used. */
export function accountsByGuest(accounts: readonly AccountRow[]): Map<number, AccountRow[]>

/** Does a guest match a lowercased search (name, email, phone, code, or the
 *  name of anyone who signed in with their code)? */
export function guestMatches(
  g: GuestWithInviteCount,
  accounts: readonly AccountRow[],
  q: string,
): boolean

/** Does a person who signed in match a lowercased search? */
export function accountMatches(a: AccountRow, q: string): boolean

/** The rows a filter + search shows, sorted by name. */
export function rosterEntries(input: RosterInput): RosterEntry[]

/** How many signed up without an invitation (the filter chip's count). */
export function uninvitedCount(accounts: readonly AccountRow[]): number

/** "g12" / "a7" → what it selects; anything else → null. */
export function parseRosterSel(sel: string | undefined): RosterSel | null

/** Where a row lives: `/admin/guests/g12` or `/admin/guests/a7`. */
export function entryPath(entry: RosterEntry): string

/** Refresh the stats (the list head's "N parties · N people coming"). */
export function loadStats(): Promise<void>

/** Reload the roster, the RSVPs and the stats; re-draw if the panel shows. */
export function loadGuests(): Promise<void>

export function handleGuestFormSubmit(e: SubmitEvent): Promise<void>

/** Wire the panel and its dialogs, and register it with the router. */
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

/** Which invite dialog route is being shown: the list's invitable guests
 *  (filtered like the list), one guest, or the results of the last send. */
export type InviteMount =
  | { kind: "bulk"; filter: GuestFilter; q: string }
  | { kind: "one"; id: number; name: string }
  | { kind: "sent" }

/** Fill the invite dialog for this arrival (the router opens it). */
export function mountInvite(opts: InviteMount): Promise<void>

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

/** Run the pending Undo (the toast's button, or `z`). False when there is none. */
export function runUndo(): boolean

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

/** The most recently opened dialog (via openModal) that is still open, or null. */
export function topModal(): HTMLDialogElement | null

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

/** @file petitions.js - Requests | Blocked (one split view) */

export interface PetitionCounts {
  pending: number
}

export interface PetitionsWithCountsResponse {
  petitions: Petition[]
  counts: PetitionCounts
}

/** The Requests list's filter (`?status=`). */
export type PetitionFilter = "pending" | "approved" | "denied" | "all"

/** What the Requests panel shows, from the URL. */
export interface RequestsView {
  /** /admin/requests/blocked… (the Blocked tab). */
  blocked: boolean
  filter: PetitionFilter
  /** The selected request (`p3`) or blocked entry (`b5`). */
  id: number | null
  items: Array<Petition | BlocklistEntry>
}

/** The sidebar's Requests count and the tab's. */
export function updatePetitionBadge(count: number): void

/** Load every request (the list filters them). */
export function loadPetitions(): Promise<void>

/** The waiting count only, for the badge poll. */
export function loadPetitionCount(): Promise<void>

/** Ask the approve questions (party size, send now, a note). */
export function openApprovePetition(id: number): void

/** Ask the deny questions; `block` pre-ticks "also block them". */
export function openDenyPetition(id: number, block?: boolean): void

export function handleApproveConfirm(): Promise<void>

export function handleDenyConfirm(): Promise<void>

/** Wire the panel and its confirms, and register it with the router. */
export function initPetitions(): void

/** GET /api/admin/rsvps (Guests & RSVPs reads it into each guest). */
export interface RSVPsResponse {
  rsvps: RSVPWithGuest[]
}

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

/** Load the eligible guests into the dialog route /admin/guests/text. */
export function mountManualSms(): Promise<void>

/**
 * Handle closing the manual SMS modal and refreshing data.
 * @example
 * await handleDone();
 */
export function handleDone(): void

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

/** @file thank-you.js — Types for Thank-yous: Gifts, Cards and Replies lists,
 *  the composer route (live iframe preview), the send dialog and batch send. */

/** A card as the admin lists it: recipient name + contact (GET /api/admin/thank-you). */
export type ThankYouCardRow = ThankYouCardListRow

/** How a card goes: by email, by text, or as a link the couple sends. */
export type ThankYouChannel = "email" | "sms" | "link"

/** GET /api/admin/gifts */
export interface GiftsResponse {
  gifts: GiftWithGuest[]
}

/** GET /api/admin/thank-you */
export interface CardsResponse {
  cards: ThankYouCardListRow[]
}

/** One approved gallery item the guest is in (GET /api/admin/guests/:id/photos). */
export interface GuestPhotoItem {
  id: number
  file_key: string
  kind: "image" | "video"
  section: "official" | "guest" | "honeymoon"
  width: number | null
  height: number | null
  needs_display: boolean
  created_at: string
  faces: number
}

/** GET /api/admin/guests/:id/photos — "Photos they're in" (IA §13.1). */
export interface GuestPhotosResponse {
  items: GuestPhotoItem[]
}

/** One card's outcome in a batch send. */
export interface ThankYouBatchResult {
  id: number
  via: ThankYouChannel
  ok: boolean
  error: string | null
}

/** The batch-send flow (Choose → How → Check → Sent). The ids and channels
 *  survive a reload (sessionStorage); the history positions don't. */
export interface ThankYouBatchFlow {
  /** Ticked cards (step 1). */
  ids: number[]
  /** Card id → the channel picked in step 2 (absent = the pre-pick). */
  channel: Record<string, ThankYouChannel>
  sent: boolean
  results: ThankYouBatchResult[]
  /** history.state.idx of step 1's entry. */
  chooseIdx: number | null
  /** history.state.idx of the entry step 1 was opened from (null: deep link). */
  originIdx: number | null
  /** history.state.idx of Sent (which replaced Check). */
  doneIdx: number | null
  /** Back from Sent should still rewind to the origin. */
  rewind: boolean
}

/** The single-card send dialog (route cards/:id/send). */
export interface ThankYouSendDialogState {
  cardId: number
  stage: "pick" | "done" | "closed"
  channel: ThankYouChannel
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

/** Response of GET /api/admin/media/curated: every live row of a section. */
export interface CuratedMediaResponse {
  items: MediaListItem[]
}

/** A drag-to-reorder in the curated grid, from the press on a handle to the drop. */
export interface CuratedDrag {
  /** The media id of the photo being dragged. */
  id: number
  pointerId: number
  /** Its card, which follows the pointer by a transform. */
  item: HTMLElement
  /** Where the press was, in viewport pixels. */
  startX: number
  startY: number
  /** Where the pointer is now. */
  x: number
  y: number
  /** The element the page scrolls in, and its scrollTop at the press: the card's
   *  offset has to make up for any scrolling since. */
  scroller: HTMLElement
  startScroll: number
  /** False until the pointer has moved far enough to be a drag rather than a press. */
  active: boolean
  /** The card it would land beside, and on which side of it. */
  over: HTMLElement | null
  after: boolean
  /** The edge-scroll animation frame. */
  frame: number
}

/** Approved: what guests see. */
export function isCuratedRowOnSite(row: { status: string }): boolean

/** Hidden or pending: kept, off the site, and restorable from the Hidden view. */
export function isCuratedRowOffSite(row: { status: string }): boolean

/** The whole section with the grid's order applied: `shown` rows take their new
 *  order inside the slots they already occupy, and every other row stays put. */
export function applyShownOrder<T extends { id: number }>(all: T[], shown: T[]): T[]

/** Where a photo dragged from index `from` lands when it is dropped on the photo
 *  at `over`, before it or (`after`) after it: the index to hand to a move, in
 *  the list as it will be once the photo is taken out. Equal to `from` when the
 *  drop leaves it where it was. */
export function curatedDropIndex(from: number, over: number, after: boolean): number

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

/** GET /api/admin/thank-you/:id — one card with its recipient name, plus the
 *  full reply thread, oldest first. */
export interface ThankYouCardDetailResponse {
  card: ThankYouCard & { guest_name: string | null }
  replies: Array<Pick<ThankYouCardReply, "emoji" | "message" | "created_at">>
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

/** Photo-picker state. */
export interface ThankYouPickerState {
  selected: Set<string>
}

/** The panel's module-level state. */
export interface ThankYouModuleState {
  /** Gifts and cards have been fetched at least once. */
  loaded: boolean
  /** What #ty-view (or the composer) is showing. */
  view: "gifts" | "cards" | "replies" | "composer" | "flow" | null
  /** Which list the split shows, so a selection move keeps its scroll. */
  listKey: string
  /** The list's name filter (transient; not in the URL). */
  query: string
  dirty: boolean
  effectsCustomized: boolean
  /** The couple has written in the message: replacing it asks first. */
  messageCustomized: boolean
  /** How many times "another starter" has cycled the current draft. */
  rerollCount: number
  guestsLoaded: boolean
  guestOptions: { id: number; name: string }[]
  /** The site's effect theme (seeds a new card). Null until loaded. */
  siteTheme: string | null
  /** The couple's display name (signs the card miniatures + preview). */
  coupleName: string
  config: ThankYouSendConfig | null
  draft: ThankYouDraft | null
  /** Which composer route the draft belongs to ("card:17", "gift:41", "guest:12"). */
  draftKey: string | null
  /** The open draft has never been saved. */
  isNew: boolean
  /** An autosave that differs from the open draft, offered for restore. */
  restoreSaved: string | null
  previewReady: boolean
  pendingPush: boolean
  picker: ThankYouPickerState
  previewDevice: "mobile" | "desktop"
  replyPingEnabled: boolean
  /** The open card recipient's story, for the composer sidecar. */
  story: GuestStory | null
  /** A batch send or retry is running. */
  sending: boolean
}

export function initThankYous(): void
export function loadThankYous(): Promise<void>
export function loadThankYouCount(): Promise<void>
export function isThankYousDirty(): boolean

// ---- Home (inbox.js; IA §2, §13.6) ----

/** One numbered step card on Home. */
export interface HomeStep {
  step: number
  /** Work waiting; 0 = done (the card dims, its button says "Look again"). */
  waiting: number
  title: string
  todo: string
  done: string
  /** Where the button goes (an /admin path). */
  to: string
  cta: string
  /** Progress in the job's own unit ("38 of 212 faces named"). */
  progress?: { done: number; total: number; label: string }
}

export interface HomeData {
  review: ModerationCountsResponse
  /** Null when the faces endpoints could not be read. */
  faces: { groups: number; ask: number; named: number; total: number } | null
  thanks: { owed: number; thanked: number; unwritten: number; drafts: number; unread: number }
  replies: number
}

/** Fetch and draw Home's step cards (mounted on every visit). */
export function loadHome(): Promise<void>
/** The badge poll's share: the Gifts count, which only Home computes. */
export function refreshHomeBadges(): Promise<void>

/** @file face-assignment.js — Types for the admin Faces tab (assisted face
 *  tagging against the guest roster, docs/post-wedding/SPEC-vision-lab.md
 *  §6.5). There is no crop endpoint and there cannot be one — re-encoding a
 *  crop server-side needs an image library on the request path, which this
 *  project does not have — so a face is displayed by loading the media's
 *  `display` variant and cropping to the face's box client-side. That needs the
 *  ORIGINAL photo's pixel width/height alongside the box, because the box is in
 *  original-pixel coordinates and the variant is an unknown scale of it;
 *  `fileKey`, `width` and `height` ride on every chip entry for exactly that,
 *  pinned by an integration test. A missing dimension degrades to an uncropped
 *  image rather than failing. */

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
 * How varied a group's faces are: its widest internal pair, over the grouping
 * cutoff. Above 1 means the group contains two faces further apart than the
 * threshold that is supposed to separate people — possible because the
 * clustering is average-linkage, so a merge only needs the MEAN below the
 * cutoff.
 *
 * ⚠ SORT ORDER ONLY. It is never rendered as a per-group warning, and the
 * search for a statistic selective enough to be one came back empty — see
 * `weldRisk` in api/admin/faces.js for what was tried and why none of it
 * survived contact with a hand-labelled set. The check the UI actually offers
 * is the review view: every face in the group, large, one at a time.
 */
export interface FaceGroupWeld {
  diameter: number
  ratio: number
}

/** One unnamed cluster from GET /api/admin/faces/overview, clearest then
 *  largest first. */
export interface FaceGroup {
  /** The group's lowest shown face id: stable across reloads while that face
   *  stays unnamed, so a route can carry it. */
  key: number
  /** The faces a BULK confirm may name — set-aside members are absent, so a
   *  bulk confirm cannot carry one the server would refuse anyway. */
  faceIds: number[]
  /** Chips for exactly `faceIds`, same order. */
  media: FaceChipEntry[]
  /** Chips for the members routing HELD BACK. Shown by the review view's
   *  filmstrip (dimmed, labelled) so the group's real extent is visible, and
   *  deliberately absent from `faceIds`: these are nameable only one at a time
   *  through POST /api/admin/faces/assign-one, which is the single-face
   *  exemption from the bulk routing check. */
  setAsideMedia: FaceChipEntry[]
  suggestion: FaceGroupSuggestion | null
  /** People exist to suggest, but none cleared `assign.suggest*` — so the
   *  group shows "no confident match" rather than the nearest wrong name. */
  abstained: boolean
  /** The nearest people to the group, nearest first, with NO bar applied —
   *  the picker's numbered alternatives ("Or one of these"), never a
   *  suggestion. Empty until someone has been named. */
  candidates: FaceGroupCandidate[]
  /** A strict majority of the cluster routed `accept`; the server sorts these
   *  first. */
  mostlyClear: boolean
  /** The FULL cluster size: `media.length + setAsideMedia.length`. */
  size: number
  /** How many of `size` were withheld by routing — `setAsideMedia.length`. */
  setAside: number
  /** Null for a single-face group. SORT ORDER ONLY — see FaceGroupWeld. */
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

/** One of a group's nearest people (FaceGroup.candidates). */
export interface FaceGroupCandidate {
  personId: number
  personName: string
  distance: number
}

/** What became of one face, from `overview?face=` — so a link that names a
 *  face no longer in any group can say why instead of 404ing. `unnamed` is
 *  either "in a group" or "held back from every group"; the client tells them
 *  apart by membership. */
export interface FaceAnchor {
  faceId: number
  mediaId: number | null
  state: "unnamed" | "named" | "not_a_face" | "gone"
  personId: number | null
  personName: string | null
}

/** GET /api/admin/faces/overview. */
export interface FacesOverviewResponse {
  counts: FaceOverviewCounts
  routeCounts: FaceRouteCounts
  groups: FaceGroup[]
  /** Only with `?face=<id>`. */
  anchor?: FaceAnchor
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
  /** The ledger pass this wrote — revoking it is the Undo. */
  batchId: string
}

/** POST /api/admin/faces/not-a-face and /propagate: one revocable pass. */
export interface FaceBatchWriteResponse {
  success: boolean
  changed: number
  batchId: string
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
  /** Only with `?faces=<personId>`: that person's newest live faces (capped)
   *  and how many there are in all. */
  personFaces?: { personId: number; faces: FaceChipEntry[]; total: number }
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

/** Which Name-faces screen a route draws: the four steps, the two reference
 *  tabs, or `root` (/admin/faces, which resolves to the first unfinished step). */
export type FacesView =
  | "root"
  | "groups"
  | "ask"
  | "same-moment"
  | "leftovers"
  | "people"
  | "history"

/** Where the Name-faces panel is, parsed from the route. Ids are numbers; the
 *  URL spells them `f1240` (a face), `p12` (a person), `m380` (a photograph). */
export interface FacesPlace {
  view: FacesView
  face: number | null
  person: number | null
  media: number | null
  /** `?face=` on a photograph route: the face to select when it opens. */
  photoFace: number | null
}

/** One Quick question: a face that is a group of one, with the ask queue's
 *  candidates and `unlocks` when it has them (it has none until someone is
 *  named). */
export interface FacesAskItem {
  faceId: number
  entry: FaceChipEntry
  candidates: Array<{ personId: number | null; personName: string | null }>
  /** Null when the queue doesn't carry the face (no one named yet). */
  unlocks: number | null
  routeState: "accept" | "ask" | null
  routeReason: string | null
}

/** One decision made in this browser session, kept (sessionStorage) so the
 *  Groups list can show it under "Named", a link to its face can say "Named
 *  Rosa" with an Undo, and History can label its pass with a name. Ids, a
 *  name someone typed and one chip — never anything about a photograph. */
export interface FacesNamedEntry {
  kind: "group" | "ask"
  /** The face the group was shown by; its link resolves to this entry. */
  anchor: number
  faceIds: number[]
  personId: number | null
  /** Null = marked not a face. */
  personName: string | null
  count: number
  batchId: string
  chip: FaceChipEntry
  revoked: boolean
}

/** The pieces of one "who is this?" picker. */
export interface FacesPickerSpec {
  kind: "group" | "ask"
  /** The group key or the face id, as the action buttons carry it. */
  id: number
  /** How many faces a confirm names. */
  count: number
  suggestion: { personId: number; personName: string; note: string } | null
  /** Numbered alternatives (keys 1–3). */
  alternatives: Array<{ personId: number; personName: string; note: string }>
  /** Why there's no suggestion, for the "Who is this?" heading. */
  emptyNote: string
}

/** Load (or reload) everything the Name-faces panel draws, then redraw it. */
export function loadFaceAssignment(): Promise<void>

/** Register the Name-faces panel with the router and wire its delegated
 *  click/keydown/input handlers, plus the photograph dialog's own listeners —
 *  that dialog is a top-level <dialog> and inherits none of the panel's. */
export function initFaceAssignment(): void

/** The variant a face chip loads: `thumb` when its pixels already cover the
 *  chip at this device pixel ratio, else `display`. Unknown geometry, or an
 *  unbounded size (`Infinity`, the review stage), always means `display`. */
export function chipVariant(
  entry: Pick<FaceChipEntry, "box" | "width" | "height">,
  pad: number,
  cssPx: number,
  dpr: number,
): "thumb" | "display"

/** @file routes.js / router.js - The admin's real-path routes (Workspace shell) */

/** One place in the admin. `path` is relative to /admin ("" is /admin itself)
 *  and may hold `:param` segments ("review/:id"). `tab` is the panel that draws
 *  it (#tab-<tab>), `sub` the panel's sub-view pill it selects, `nav` the
 *  sidebar item it lights (a key of NAV). */
export interface AdminRoute {
  path: string
  tab: string
  sub?: string
  nav: string
  /** The page's own name: last breadcrumb and document title (a panel may
   *  refine both with setCrumbs()). */
  title: string
  /** The param that names the selected item in a list. Moving it while one is
   *  already selected (j/k, clicking the next row, advance-after-act) is
   *  motion, not navigation: replaceState. */
  sel?: string
  /** Dialog route: the id of the <dialog> the router opens over `parent`. */
  dialog?: string
  /** Dialog route: the route pattern underneath, filled with the same params.
   *  Closing the dialog goes up() to it. */
  parent?: string
  /** Alias: arriving here always replaces the URL with this path. */
  redirect?: string
}

/** A sidebar item. `path` is its root, relative to /admin. */
export interface NavItem {
  label: string
  /** Bottom-bar label (phones); defaults to `label`. */
  short?: string
  path: string
  /** A name from icons.js. */
  icon: string
  /** Id of the count badge in this item (kept for modules that set it by id). */
  badge?: string
  /** The badge is a heart-tinted count (unread replies). */
  heart?: boolean
  /** Route paths shown as a segmented control above the panel ("Requests |
   *  Blocked") — sections that are one job but, for now, two panels. */
  tabs?: string[]
}

export interface NavGroup {
  label: string
  items: string[]
}

export interface RouteMatch {
  route: AdminRoute
  params: Record<string, string>
}

export interface Crumb {
  label: string
  /** A link (an /admin path); the last crumb never has one. */
  href?: string
}

/** The route a pathname shows: an exact match (params filled) beats a prefix
 *  match (params empty), which keeps a deeper unknown path in its section. */
export function matchRoute(pathname: string): RouteMatch | null

/** matchRoute(pathname)?.route — the section a path belongs to. */
export function routeFor(pathname: string): AdminRoute | null

/** The path of a route with its params filled ("/admin", "/admin/review/photo-4"). */
export function pathFor(route: AdminRoute, params?: Record<string, string>): string

/** The route an old `/admin#<tab>` link meant, or null. */
export function legacyHashRoute(hash: string): AdminRoute | null

/** The route that shows a panel's given sub-view, or null. */
export function routeForSub(tab: string, sub: string): AdminRoute | null

/** A sidebar item's root path. */
export function navRoot(key: string): string

/** The heading of the sidebar group holding `key` ("" for Home). */
export function navGroupOf(key: string): string

/** Where a sidebar item links: the remembered place in that section, unless
 *  you are already in it (then its root). */
export function navHref(key: string, currentNav: string, memory: Record<string, string>): string

/** An alias's target path (its `:param`s filled from the alias's own), or
 *  null when the route is not an alias. */
export function redirectPath(match: RouteMatch): string | null

/** A dialog route's parent path, or null for an ordinary route. */
export function parentPath(match: RouteMatch): string | null

/** Group › Section › Page, the section linking to its root. */
export function crumbsFor(match: RouteMatch): Crumb[]

/** What a panel is told on every arrival. */
export interface RouteContext {
  route: AdminRoute
  params: Record<string, string>
  query: URLSearchParams
  /** The full /admin path + search being shown. */
  path: string
  /** The app path this history entry was pushed from (null on a deep link). */
  prev: string | null
  /** True when the panel was already showing (a param or query change). */
  samePanel: boolean
  /** True when this arrival was a replace (selection motion, a redirect). */
  replace: boolean
}

/** The module contract (WORKSPACE.md). Register with registerPanel(tab, panel).
 *  A panel that registers is mounted on EVERY arrival at one of its routes,
 *  including param/query changes; one that does not keeps today's behaviour
 *  (main.js's load*() runs when the panel is first shown). */
export interface AdminPanel {
  mount(params: Record<string, string>, query: URLSearchParams, ctx: RouteContext): void | Promise<void>
  /** Leaving for another panel. Drop timers, listeners, guards. */
  unmount?(): void
  /** Keys while this panel shows (not typing, no dialog open). True = handled. */
  keys?(e: KeyboardEvent, ctx: RouteContext): boolean
  /** Lines added to the ? sheet while this panel shows: [keys, what]. */
  help?: { title: string; keys: Array<[string, string]> }
}

/** Work a navigation would throw away. `tab`: guards while that panel shows;
 *  `path`: guards while the URL is inside this /admin path prefix (so the
 *  composer's own photo-picker route doesn't trip it). */
export interface LeaveGuard {
  what: string
  dirty: () => boolean
  /** Present → the dialog offers "Save and leave". Resolve true when saved. */
  save?: () => Promise<boolean>
  /** Called when the owner chooses Discard: drop the edits, so the next visit
   *  shows the saved version rather than the text they threw away. */
  discard?: () => void
  tab?: string
  path?: string
}

export interface NavigateOptions {
  /** replaceState instead of pushState (selection motion, advance-after-act). */
  replace?: boolean
  /** false: only record the place (a pill already switched the view). */
  render?: boolean
}

/** Go to an /admin path (+ search): push (or replace), ask first if unsaved
 *  work would be lost. */
export function navigate(path: string, opts?: NavigateOptions): Promise<void>

/** Close / back-chevron / Esc: history.back() when the previous entry IS
 *  `fallback` (so Close and Back agree), else replace to it. */
export function up(fallback: string): void

/** Register a panel module for its #tab-<tab>. */
export function registerPanel(tab: string, panel: AdminPanel): void

/** Add a leave guard; returns the function that removes it. */
export function addGuard(guard: LeaveGuard): () => void

/** Replace the crumbs after the section ("Hannah Weiss · Photo"); also sets
 *  the document title to the last label. Call from mount(). */
export function setCrumbs(trail: Crumb[]): void

/** The place being shown. */
export function currentPlace(): RouteContext | null

/** Set a sidebar item's count badge (and the bottom bar's, and More's). */
export function setNavBadge(key: string, count: number): void

/** Wire the shell (sidebar, bottom bar, keys) and Back/Forward. `load` runs a
 *  legacy panel's load*() when it is first shown. */
export function initRouter(load: (tabId: string) => void): void

/** Render whatever the current URL names (after login). Redirects old #tab links. */
export function startRouter(): void

/** Fill /admin/more (phones) with every section, its live badge, and settings. */
export function renderMore(): void

/** @file icons.js - Stroke icons (20px grid), shared by the shell and panels */
export function icon(name: string): string

// --- guest-match.js -----------------------------------------------------------

/** A roster guest as the Faces tab's linker needs it. */
export interface GuestOption {
  id: number
  name: string
  email: string | null
  phone: string | null
  inviteCode: string
}

/** A guest plus the type-ahead label that tells it apart from a namesake. */
export interface GuestChoice extends GuestOption {
  label: string
}

export type GuestChoiceResult =
  | { kind: "one"; guest: GuestChoice }
  | { kind: "ambiguous" }
  | { kind: "none" }

/** How well an informal person name matches a guest's name; 0 is no match. */
export function guestMatchScore(personName: string, guestName: string): number
/** The guests an informal name most likely refers to, best first. */
export function suggestGuests<T extends { name: string }>(
  personName: string,
  guests: readonly T[],
  limit?: number,
): T[]
/** Every guest with a unique label: a shared name gets its email, phone or code. */
export function guestChoices(guests: readonly GuestOption[]): GuestChoice[]
/** What was typed or picked → exactly one guest, a name shared by several, or nothing. */
export function resolveGuestChoice(
  typed: string,
  choices: readonly GuestChoice[],
): GuestChoiceResult

/** The list pane's width a drag or an arrow key asks for, kept between 280px
 *  and 720px and never leaving the detail pane under 480px (split-resize.js). */
export function clampListWidth(px: number, splitWidth: number): number
/** Wire every `.split-handle`: drag, ← →, double-click to reset, remembered per split. */
export function initSplitResize(): void
