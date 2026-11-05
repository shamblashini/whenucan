import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { vi } from "vitest";
import { app } from "../src/worker/index";
import type { Env } from "../src/worker/env";
import type { GroupMeta, GroupState, JoinResult } from "@shared/types";

export const testEnv = env as unknown as Env & { TEST_MIGRATIONS: D1Migration[] };

export async function resetDb(): Promise<void> {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  for (const table of ["users", "participants", "groups"]) {
    await testEnv.DB.prepare(`DELETE FROM ${table}`).run();
  }
}

let ipCounter = 0;

/** Each test client has its own IP, so rate limits do not leak from one test to the next. */
export function newIp(): string {
  ipCounter += 1;
  return `10.0.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
}

export interface CallOptions {
  method?: string;
  body?: unknown;
  token?: string;
  cookie?: string;
  ip?: string;
  headers?: Record<string, string>;
}

export function call(path: string, options: CallOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { "cf-connecting-ip": options.ip ?? newIp(), ...options.headers };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.cookie) headers.cookie = options.cookie;
  return Promise.resolve(
    app.request(
      `http://localhost${path}`,
      {
        method: options.method ?? "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      },
      testEnv,
    ),
  );
}

/** Answers Turnstile siteverify. Pass a function to fake other outbound requests too. */
export function stubFetch(other?: (url: string, init?: RequestInit) => Promise<Response> | Response, turnstile = true) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("challenges.cloudflare.com")) {
      return Response.json({ success: turnstile, action: "join" });
    }
    if (other) return other(url, init);
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function createOrganiser(name = "Olive"): Promise<{ id: string; cookie: string }> {
  const id = crypto.randomUUID();
  const token = crypto.randomUUID();
  await testEnv.DB.batch([
    testEnv.DB.prepare("INSERT INTO users (id, google_sub, email, name) VALUES (?, ?, ?, ?)").bind(id, id, `${id}@example.test`, name),
    testEnv.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(
      await sha256(token),
      id,
      new Date(Date.now() + 86_400_000).toISOString(),
    ),
  ]);
  return { id, cookie: `session=${token}` };
}

export const GROUP = {
  name: "Ski trip",
  description: "Pick a weekend",
  startDate: "2030-01-10",
  endDate: "2030-01-20",
  timezone: "Europe/Warsaw",
};

export async function createGroup(cookie: string, overrides: Partial<typeof GROUP> = {}): Promise<string> {
  const response = await call("/api/groups", { method: "POST", cookie, body: { ...GROUP, ...overrides } });
  if (response.status !== 201) throw new Error(`createGroup: ${response.status} ${await response.text()}`);
  return ((await response.json()) as { slug: string }).slug;
}

export async function join(slug: string, name: string): Promise<JoinResult> {
  const response = await call(`/api/g/${slug}/join`, { method: "POST", body: { name, turnstileToken: "ok" } });
  if (response.status !== 200) throw new Error(`join: ${response.status} ${await response.text()}`);
  return response.json();
}

export async function getState(slug: string, token: string): Promise<GroupState> {
  return (await call(`/api/g/${slug}/state`, { token })).json();
}

export async function getMeta(slug: string, cookie?: string): Promise<GroupMeta> {
  return (await call(`/api/g/${slug}`, { cookie })).json();
}

export async function errorCode(response: Response): Promise<string> {
  return ((await response.json()) as { error: { code: string } }).error.code;
}
