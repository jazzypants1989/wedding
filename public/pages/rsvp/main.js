/** @file RSVP forms entry point */

import { initRsvpForm } from "./rsvp-form.js"
import { initMobileNav } from "../../components/mobile-nav.js"
import { initLookupForm } from "./lookup-form.js"
import { initPetitionForm, showPetitionForm } from "./petition-form.js"
import { initThemeToggle } from "../../components/theme-toggle.js"

initRsvpForm()
initLookupForm(showPetitionForm)
initPetitionForm()
initMobileNav()
initThemeToggle()
