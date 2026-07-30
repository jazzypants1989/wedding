/**
 * Type declarations for the CLI scripts in scripts/ and their shared helpers in
 * scripts/lib/. Implementations annotate against these with
 * `/** @type {Types.name} *\/` via `/** @import * as Types from './types.js' *\/`
 * (or '../types.js' from scripts/lib/).
 */

// --- Terminal prompt (scripts/lib/prompt.js) ---

/**
 * Ask a question on stdout and resolve with the answer. When `hidden` is set
 * and stdin is a TTY, input is echoed as asterisks; otherwise readline is used
 * and the answer is visible.
 */
export function prompt(question: string, hidden?: boolean): Promise<string>

/** Raw-mode keypress handler used by the hidden-input path. */
export function onPromptData(char: string): void

/** Whether stdin is interactive — false means prompt() would hang or echo. */
export function canPrompt(): boolean
