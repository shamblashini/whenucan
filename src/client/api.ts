import { isErrorKey } from "@shared/errors";
import { t } from "./i18n";

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  token?: string;
  headers?: Record<string, string>;
}

export async function rawRequest(path: string, options: RequestOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  try {
    return await fetch(path, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiFailure(0, "offline", t("error.offline"));
  }
}

export async function failureFrom(response: Response): Promise<ApiFailure> {
  const data = await (response.json() as Promise<{ error?: { code: string; message: string; key?: string; vars?: Record<string, string | number> } }>).catch(() => null);
  const key = data?.error?.key;
  return new ApiFailure(
    response.status,
    data?.error?.code ?? "server_error",
    isErrorKey(key) ? t(key, data?.error?.vars) : (data?.error?.message ?? t("error.server")),
  );
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await rawRequest(path, options);
  if (!response.ok) throw await failureFrom(response);
  return response.json() as Promise<T>;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : t("error.generic");
}
