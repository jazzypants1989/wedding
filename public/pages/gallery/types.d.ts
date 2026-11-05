/** @file Types for the gallery page (grid, lightbox, upload tray). */

import type {
  MediaListItem,
  MediaSection,
  MediaContributors,
} from "../../../types.js"

export type { MediaListItem, MediaSection, MediaContributors }

/** What the switcher shows: one section, or both stacked ("all", the default). */
export type GalleryView = MediaSection | "all"

/** An opaque page cursor: an id for guest, a position string for a curated
 *  section. Only ever echoed back to the server. */
export type MediaCursor = number | string

/** GET /api/media response. `contributors` rides on the first guest page. */
export interface GalleryListResponse {
  items: MediaListItem[]
  nextCursor: MediaCursor | null
  contributors?: MediaContributors
}

/** Per-section loaded state; each section keeps its own cursor + scroll. */
export interface GridSectionState {
  section: MediaSection
  items: MediaListItem[]
  nextCursor: MediaCursor | null
  reachedEnd: boolean
  loading: boolean
  autoFetches: number
}

/** Wiring the grid hands back to the page (open a cell in the lightbox). */
export interface GridCallbacks {
  onOpen: (section: MediaSection, id: number) => void
}

/** What the lightbox needs from the grid to navigate + lazy-extend. The key is
 *  a view, not a section: "all" navigates official + guest as one list. */
export interface LightboxSource {
  getItems: (view: GalleryView) => MediaListItem[]
  hasMore: (view: GalleryView) => boolean
  loadMore: (view: GalleryView) => Promise<number>
  /** URL sync: called with the current item on open/navigate, null on close. */
  onChange: (view: GalleryView, id: number | null) => void
  /** Drop a self-deleted item from the grid so the view stays consistent. */
  onDelete: (view: GalleryView, id: number) => void
}

/** The GET /api/media path for one page of a section: the cursor goes out as
 *  `before=` for guest and `after=` for a curated section. Null = first page. */
export function mediaPagePath(
  section: MediaSection,
  limit: number,
  cursor: MediaCursor | null,
): string

/** The items of `page` not already in `loaded` (by id), in page order. */
export function freshItems<T extends { id: number }>(loaded: readonly T[], page: readonly T[]): T[]

/** The prefix of `order` the "all" view's single list covers: every section up
 *  to and including the first one that still has pages to load. */
export function reachableSections(
  order: readonly MediaSection[],
  hasMore: (section: MediaSection) => boolean,
): MediaSection[]

export function initGrid(callbacks: GridCallbacks): void
export function showSection(view: GalleryView): void
export function prependItem(item: MediaListItem): void
export function getSectionItems(section: MediaSection): MediaListItem[]
export function hasMore(section: MediaSection): boolean
export function loadMore(section: MediaSection): Promise<number>
/** Resolves once the section's page load in flight (if any) has finished. */
export function settled(section: MediaSection): Promise<void>
export function ensureItemLoaded(item: MediaListItem): void
export function getSectionCount(section: MediaSection): number
export function removeItem(section: MediaSection, id: number): void

export function initLightbox(source: LightboxSource): void
export function openLightbox(view: GalleryView, id: number): void
export function openLightboxItem(item: MediaListItem, section: MediaSection): void
export function isLightboxOpen(): boolean
export function closeLightbox(): void

export function initUpload(): void
