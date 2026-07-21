/** @file Types for the gallery page (grid, lightbox, upload tray). */

import type {
  MediaListItem,
  MediaSection,
  MediaContributors,
} from "../../../types.js"

export type { MediaListItem, MediaSection, MediaContributors }

/** GET /api/media response. `contributors` rides on the first guest page. */
export interface GalleryListResponse {
  items: MediaListItem[]
  nextCursor: number | null
  contributors?: MediaContributors
}

/** Per-section loaded state; each section keeps its own cursor + scroll. */
export interface GridSectionState {
  section: MediaSection
  items: MediaListItem[]
  nextCursor: number | null
  reachedEnd: boolean
  loading: boolean
  autoFetches: number
}

/** Wiring the grid hands back to the page (open a cell in the lightbox). */
export interface GridCallbacks {
  onOpen: (section: MediaSection, id: number) => void
}

/** What the lightbox needs from the grid to navigate + lazy-extend. */
export interface LightboxSource {
  getItems: (section: MediaSection) => MediaListItem[]
  hasMore: (section: MediaSection) => boolean
  loadMore: (section: MediaSection) => Promise<number>
  /** URL sync: called with the current item on open/navigate, null on close. */
  onChange: (section: MediaSection, id: number | null) => void
  /** Drop a self-deleted item from the grid so the view stays consistent. */
  onDelete: (section: MediaSection, id: number) => void
}

export function initGrid(callbacks: GridCallbacks): void
export function showSection(section: MediaSection): void
export function prependItem(item: MediaListItem): void
export function getSectionItems(section: MediaSection): MediaListItem[]
export function hasMore(section: MediaSection): boolean
export function loadMore(section: MediaSection): Promise<number>
export function ensureItemLoaded(item: MediaListItem): void
export function getSectionCount(section: MediaSection): number
export function removeItem(section: MediaSection, id: number): void

export function initLightbox(source: LightboxSource): void
export function openLightbox(section: MediaSection, id: number): void
export function openLightboxItem(item: MediaListItem, section: MediaSection): void
export function isLightboxOpen(): boolean
export function closeLightbox(): void

export function initUpload(): void
