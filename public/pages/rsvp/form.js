/** @file RSVP forms entry point */

import { initRsvpForm } from './rsvp-form.js'
import { initLookupForm } from './lookup-form.js'
import { initPetitionForm, showPetitionForm } from './petition-form.js'

initRsvpForm()
initLookupForm(showPetitionForm)
initPetitionForm()
