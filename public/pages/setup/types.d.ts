/** Types for the first-run setup wizard (public/pages/setup). */

export interface SetupCouple {
  display: string
  first: string
  monogram: string
  fullNames: string[]
}

export interface SetupRegistry {
  title: string
  body: string
  frameNote: string
  url: string
  label: string
}

export interface SetupCopyVariant {
  welcomeHeading: string
  welcomeIntro: string
}

/** The subset of the server SiteContent the wizard reads/writes. Untouched keys
 *  (schedule, dressCode, nav, footer, memories, contactEmail) still ride along on
 *  the runtime object and are submitted unchanged. */
export interface SetupContent {
  couple: SetupCouple
  weddingDate: string
  location: string
  theme: string
  registry: SetupRegistry
  copy: { pre: SetupCopyVariant; post: SetupCopyVariant }
}

export interface SetupStatusResponse {
  complete: boolean
  content?: SetupContent
}

export interface SetupTheme {
  id: string
  label: string
}
