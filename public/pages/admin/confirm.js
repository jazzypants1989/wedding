/** @file Shared styled confirm dialog for destructive admin actions.
 *
 *  A reusable, on-brand replacement for window.confirm(): one dialog element
 *  (#admin-confirm-modal) is reused across tabs. openConfirm() swaps its copy,
 *  runs the confirmed action, and surfaces any error inline (leaving the modal
 *  open) rather than closing on failure. Mirrors the moderation confirm modal
 *  but without its release/reason extras.
 */
/** @import * as Types from './types.js' */

import { openModal, closeModal } from "./utils.js"
import {
  getElement,
  getButtonElement,
  getDialogElement,
  getErrorMessage,
} from "../utils.js"

/** @type {Types.ConfirmConfig | null} */
let confirmState = null

/** @type {Types.openConfirm} */
export function openConfirm(cfg) {
  confirmState = cfg
  getElement("admin-confirm-title").textContent = cfg.title
  getElement("admin-confirm-desc").textContent = cfg.desc
  getElement("admin-confirm-error").hidden = true
  const btn = getButtonElement("admin-confirm-btn")
  btn.textContent = cfg.confirmLabel
  btn.className = cfg.danger ? "btn btn-danger" : "btn btn-primary"
  openModal(getDialogElement("admin-confirm-modal"))
}

async function handleConfirm() {
  if (!confirmState) return
  const btn = getButtonElement("admin-confirm-btn")
  btn.disabled = true
  try {
    await confirmState.run()
    closeModal(getDialogElement("admin-confirm-modal"))
  } catch (err) {
    const el = getElement("admin-confirm-error")
    el.textContent = getErrorMessage(err)
    el.hidden = false
  } finally {
    btn.disabled = false
  }
}

/** @type {Types.initConfirmDialog} */
export function initConfirmDialog() {
  getButtonElement("admin-confirm-btn").addEventListener("click", handleConfirm)
}
