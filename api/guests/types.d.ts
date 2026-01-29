/** @file data.js - Types for guest database operations */

import type {
  Guest,
  GuestWithInviteCount,
  GuestStatus,
  CreateGuestInput,
  UpdateGuestInput,
} from "../../types.js"

import type {
  SyncHandler,
  AuthedHandler,
  ParamsHandler,
} from "../admin/types.js"
import type { WrappedHandler } from "../../core/types.js"

export interface GetGuestByIdOptions {
  includeDeleted?: boolean
}

export interface GetGuestsByIdsOptions {
  includeDeleted?: boolean
}

export interface GetAllGuestsOptions {
  status?: GuestStatus
  search?: string
  limit?: number
  offset?: number
  includeDeleted?: boolean
  onlyDeleted?: boolean
}

export interface CountGuestsOptions {
  status?: GuestStatus
  search?: string
  includeDeleted?: boolean
  onlyDeleted?: boolean
}

export interface CountResult {
  count: number
}

export interface CreateGuestResult {
  id: number | bigint
  invite_code: string
}

export function getGuestByInviteCode(code: string): Guest | undefined

export function getGuestByEmail(
  email: string | null | undefined,
): Guest | undefined
export function getGuestByPhone(
  phone: string | null | undefined,
): Guest | undefined
export function getGuestById(
  id: number,
  options?: GetGuestByIdOptions,
): Guest | undefined
export function getGuestsByIds(
  ids: number[],
  options?: GetGuestsByIdsOptions,
): Guest[]
export function getAllGuests(
  options?: GetAllGuestsOptions,
): GuestWithInviteCount[]
export function countGuests(options?: CountGuestsOptions): number
export function createGuest(input: CreateGuestInput): CreateGuestResult
export function updateGuest(id: number, input: UpdateGuestInput): boolean
export function softDeleteGuest(id: number): boolean
export function restoreGuest(id: number): boolean
export function hardDeleteGuest(id: number): boolean
export function updateGuestInvitedAt(id: number): void

export type statsHandler = SyncHandler
export type listHandler = SyncHandler
export type createHandler = AuthedHandler
export type updateHandler = ParamsHandler
export type deleteHandler = ParamsHandler
export type restoreHandler = ParamsHandler

export const stats: SyncHandler
export const list: SyncHandler
export const create: AuthedHandler
export const update: ParamsHandler
export const remove: ParamsHandler
export const restore: ParamsHandler

/** @file export.js - Types for admin guest export endpoints */

import type { SyncHandler } from "../admin/types.js"
import type { WrappedHandler } from "../../core/types.js"

export type ExportHandlerFn = SyncHandler

export const exportCSV: SyncHandler

/** @file import.js - Types for admin guest import endpoints */

import type { AuthedHandler } from "../admin/types.js"
import type { WrappedHandler } from "../../core/types.js"

export interface ImportError {
  line?: number
  error: string
}

export interface ImportSkipped {
  line: number
  name: string
  reason: string
}

export interface ValidatedRow {
  lineNum: number
  name: string
  email: string | null
  phone: string | null
  partySize: number
  notes: string | null
}

export interface ImportResult {
  added: number
  skipped: ImportSkipped[]
  errors: ImportError[]
}

export type ImportHandlerFn = AuthedHandler

export const importCSV: AuthedHandler
