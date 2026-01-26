/** @file Types for unit test helpers */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';

export interface MockFn {
  (...args: unknown[]): unknown;
  calls: unknown[][];
  reset: () => number;
}

export type CreateMockFn = (returnValue?: unknown) => MockFn;

export interface MockRequestOptions {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
  socket?: { remoteAddress?: string };
}

export interface MockRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  socket: { remoteAddress?: string };
  on: (event: string, handler: (data?: Buffer) => void) => void;
}

export interface MockResponse {
  statusCode: number | null;
  headers: Record<string, string | number | string[]>;
  body: string | null | undefined;
  ended: boolean;
  writeHead: (status: number, headers?: Record<string, string | number | string[]>) => MockResponse;
  setHeader: (name: string, value: string | number | string[]) => MockResponse;
  end: (body?: string) => MockResponse;
  getBody: () => unknown;
}

export interface ValidationResult {
  valid: boolean;
  value?: unknown;
  error?: string;
}

export type MockRequestFn = (options?: MockRequestOptions) => MockRequest;
export type MockResponseFn = () => MockResponse;
export type AssertValidationFn = (result: ValidationResult, expectedValid: boolean, expectedValue?: unknown, expectedErrorSubstring?: string) => void;

export const createMock: CreateMockFn;
export const mockRequest: MockRequestFn;
export const mockResponse: MockResponseFn;
export const assertValidation: AssertValidationFn;
