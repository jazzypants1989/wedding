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

/** The server SiteContent as the wizard handles it: the fields it reads/writes,
 *  plus the fields it only carries through. The server's buildOverride validates
 *  a COMPLETE SiteContent, so the ride-along keys must be submitted unchanged —
 *  they are typed opaquely (the wizard never touches them) but are declared here
 *  so a maintainer can't reconstruct `content` from this type and silently drop
 *  them (which would 400 the submit). */
export interface SetupContent {
  couple: SetupCouple
  weddingDate: string
  location: string
  theme: string
  registry: SetupRegistry
  copy: { pre: SetupCopyVariant; post: SetupCopyVariant }
  // Carried through unchanged; see note above.
  schedule: unknown
  dressCode: unknown
  nav: unknown
  footer: unknown
  memories: unknown
  contactEmail: unknown
}

export interface SetupStatusResponse {
  complete: boolean
  content?: SetupContent
}

export interface SetupTheme {
  id: string
  label: string
}
