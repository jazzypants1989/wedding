/** @file Types for service unit tests */

export interface MockResponseConfig {
  statusCode?: number;
  error?: string;
  timeout?: boolean;
  body?: string;
}

export interface MockHttpCallOptions {
  hostname?: string;
  path?: string;
  method?: string;
  port?: number;
  timeout?: number;
  headers?: Record<string, string | number>;
}

export interface MockHttpCall {
  options: MockHttpCallOptions;
  data?: string;
}

export interface MockResponse {
  statusCode: number;
  on(event: string, listener: (...args: unknown[]) => void): this;
  emit(event: string, ...args: unknown[]): boolean;
}

export interface MockRequest {
  write(data: string): void;
  end(): void;
  destroy(): void;
  on(event: string, listener: (...args: unknown[]) => void): this;
  emit(event: string, ...args: unknown[]): boolean;
}

export type MockRequestFn = (
  options: MockHttpCallOptions,
  callback: (res: MockResponse) => void
) => MockRequest;

export interface MockHttpClient {
  request: MockRequestFn;
  calls: MockHttpCall[];
}

export type CreateMockHttpClientFn = (responseConfig?: MockResponseConfig) => MockHttpClient;
