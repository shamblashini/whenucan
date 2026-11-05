import { errorText, type ErrorKey, type ErrorVars } from "@shared/errors";
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  RL_READ: RateLimit;
  RL_WRITE: RateLimit;
  RL_JOIN: RateLimit;
  RL_AUTH: RateLimit;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET?: string;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET_KEY?: string;
  SESSION_SECRET?: string;
  CONTACT_EMAIL: string;
  REPO_URL: string;
  /** Local development only: enables the test organiser sign-in on localhost. */
  DEV_LOGIN?: string;
}

export type AppContext = { Bindings: Env };

export class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 500 | 503,
    readonly code: string,
    readonly key: ErrorKey,
    readonly vars?: ErrorVars,
  ) {
    super(errorText(key, vars));
  }
}

export function devLoginEnabled(env: Env, url: string): boolean {
  const { hostname } = new URL(url);
  return env.DEV_LOGIN === "1" && (hostname === "localhost" || hostname === "127.0.0.1");
}

export function clientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "local";
}

export async function rateLimit(limiter: RateLimit, key: string): Promise<void> {
  const { success } = await limiter.limit({ key });
  if (!success) throw new ApiError(429, "rate_limited", "error.rateLimited");
}

export function secretKey(env: Env): Uint8Array {
  if (!env.SESSION_SECRET) throw new ApiError(500, "not_configured", "error.notConfigured");
  return new TextEncoder().encode(env.SESSION_SECRET);
}

const SLUG_ALPHABET = "23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";

/** 12 characters from 56 symbols: about 70 bits, unguessable behind the read rate limit. */
export function newSlug(): string {
  const limit = 256 - (256 % SLUG_ALPHABET.length);
  let slug = "";
  while (slug.length < 12) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      if (byte < limit && slug.length < 12) slug += SLUG_ALPHABET[byte % SLUG_ALPHABET.length];
    }
  }
  return slug;
}
