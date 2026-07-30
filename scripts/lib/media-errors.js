/** @file Error type shared by the bulk-import modules. A discriminated `code`
 *  lets the CLI decide whether a failure kills the run or just that one file,
 *  and lets the summary group failures without string-matching messages. */
/** @import * as Types from './types.js' */

export class MediaImportError extends Error {
  /**
   * @param {Types.MediaImportErrorCode} code
   * @param {string} message user-facing; says what to do, not just what broke
   * @param {{ file?: string, detail?: string }} [context]
   */
  constructor(code, message, context = {}) {
    super(message)
    this.name = "MediaImportError"
    this.code = code
    /** Source file the failure belongs to, when it belongs to one. */
    this.file = context.file
    /** Backend argv or stderr tail — shown at --verbose. */
    this.detail = context.detail
  }
}

/**
 * Narrow an unknown catch binding.
 * @param {unknown} err
 * @returns {err is MediaImportError}
 */
export function isMediaImportError(err) {
  return err instanceof MediaImportError
}
