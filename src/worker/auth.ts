import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { SignJWT, createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import { LIMITS } from "@shared/limits";
import type { Account, Me } from "@shared/types";
import { ApiError, clientIp, devLoginEnabled, rateLimit, secretKey, type AppContext, type Env } from "./env";
import { verifyTurnstile } from "./turnstile";

const SESSION_DAYS = 30;
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

function isHttps(url: string): boolean {
  return new URL(url).protocol === "https:";
}

function sessionCookieName(url: string): string {
  return isHttps(url) ? "__Host-session" : "session";
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

async function sha256(value: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

export async function currentUser(c: Context<AppContext>): Promise<Me | null> {
  const token = getCookie(c, sessionCookieName(c.req.url));
  if (!token) return null;
  return c.env.DB.prepare(
    `SELECT u.id, u.name, u.email FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await sha256(token), new Date().toISOString())
    .first<Me>();
}

export async function requireUser(c: Context<AppContext>): Promise<Me> {
  const user = await currentUser(c);
  if (!user) throw new ApiError(401, "signed_out", "error.signIn");
  return user;
}

async function startSession(c: Context<AppContext>, sub: string, email: string, name: string): Promise<void> {
  const db = c.env.DB;
  const user = await db
    .prepare(
      `INSERT INTO users (id, google_sub, email, name) VALUES (?, ?, ?, ?)
       ON CONFLICT (google_sub) DO UPDATE SET email = excluded.email, name = excluded.name
       RETURNING id`,
    )
    .bind(crypto.randomUUID(), sub, email, name)
    .first<{ id: string }>();
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db
    .prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256(token), user!.id, expires.toISOString())
    .run();
  setCookie(c, sessionCookieName(c.req.url), token, {
    httpOnly: true,
    secure: isHttps(c.req.url),
    sameSite: "Lax",
    path: "/",
    expires,
  });
}

function endSessionCookie(c: Context<AppContext>): void {
  deleteCookie(c, sessionCookieName(c.req.url), { path: "/", secure: isHttps(c.req.url) });
}

/** Only same-site paths, so a crafted link cannot send people elsewhere after sign-in. */
function safeNext(next: string | undefined): string {
  // Browsers drop tabs and newlines from redirects, which could turn "/\t/site" into "//site".
  return next && /^\/(?![/\\])[^\p{Cc}]*$/u.test(next) ? next : "/dashboard";
}

const startBody = z.object({ turnstileToken: z.string().max(4096).optional(), next: z.string().max(200).optional() });

export const authRoutes = new Hono<AppContext>();

authRoutes.post("/api/auth/google/start", async (c) => {
  await rateLimit(c.env.RL_AUTH, clientIp(c.req.raw));
  const { turnstileToken, next } = startBody.parse(await c.req.json());
  if (!c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET) {
    throw new ApiError(503, "google_not_configured", "error.googleNotConfigured");
  }
  await verifyTurnstile(c.env, c.req.raw, turnstileToken, "signin");

  const state = randomToken();
  const nonce = randomToken();
  const verifier = randomToken();
  const flow = await new SignJWT({ state, nonce, verifier, next: safeNext(next) })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("10m")
    .sign(secretKey(c.env));
  setCookie(c, "oauth_flow", flow, {
    httpOnly: true,
    secure: isHttps(c.req.url),
    sameSite: "Lax",
    path: "/auth/google",
    maxAge: 600,
  });

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(c.req.url),
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    prompt: "select_account",
    code_challenge: await sha256(verifier),
    code_challenge_method: "S256",
  }).toString();
  return c.json({ url: url.toString() });
});

function redirectUri(requestUrl: string): string {
  return `${new URL(requestUrl).origin}/auth/google/callback`;
}

authRoutes.get("/auth/google/callback", async (c) => {
  try {
    await rateLimit(c.env.RL_AUTH, clientIp(c.req.raw));
    const next = await finishGoogleSignIn(c);
    deleteCookie(c, "oauth_flow", { path: "/auth/google", secure: isHttps(c.req.url) });
    return c.redirect(next);
  } catch (error) {
    console.error("[auth] Google sign-in failed:", error);
    deleteCookie(c, "oauth_flow", { path: "/auth/google", secure: isHttps(c.req.url) });
    return c.redirect("/?signin=failed");
  }
});

async function finishGoogleSignIn(c: Context<AppContext>): Promise<string> {
  const code = c.req.query("code");
  const flowCookie = getCookie(c, "oauth_flow");
  if (!code || !flowCookie) throw new Error("missing code or flow cookie");

  const { payload: flow } = await jwtVerify<{ state: string; nonce: string; verifier: string; next: string }>(
    flowCookie,
    secretKey(c.env),
    { algorithms: ["HS256"] },
  );
  if (c.req.query("state") !== flow.state) throw new Error("state mismatch");

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri(c.req.url),
      grant_type: "authorization_code",
      code_verifier: flow.verifier,
    }),
  });
  if (!response.ok) throw new Error(`token exchange returned ${response.status}`);
  const { id_token: idToken } = await response.json<{ id_token: string }>();

  const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
    issuer: GOOGLE_ISSUERS,
    audience: c.env.GOOGLE_CLIENT_ID,
  });
  if (payload.nonce !== flow.nonce) throw new Error("nonce mismatch");
  if (!payload.sub || payload.email_verified !== true || typeof payload.email !== "string") {
    throw new Error("Google account has no verified email");
  }
  const name = typeof payload.name === "string" && payload.name ? payload.name : payload.email.split("@")[0];
  await startSession(c, payload.sub, payload.email, name.slice(0, 100));
  return flow.next;
}

authRoutes.post("/api/auth/dev", async (c) => {
  if (!devLoginEnabled(c.env, c.req.url)) throw new ApiError(404, "not_found", "error.notFound");
  await startSession(c, "dev:organiser", "organiser@example.test", "Test Organiser");
  return c.json({ ok: true });
});

authRoutes.post("/api/auth/logout", async (c) => {
  const token = getCookie(c, sessionCookieName(c.req.url));
  if (token) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  }
  endSessionCookie(c);
  return c.json({ ok: true });
});

authRoutes.get("/api/me", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ user: null });
  const row = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM groups WHERE owner_id = ?").bind(user.id).first<{ n: number }>();
  const account: Account = { ...user, groupCount: row?.n ?? 0 };
  return c.json({ user: account });
});

/** Deletes the account, its sessions and every group it owns. Foreign keys cascade the rest. */
authRoutes.delete("/api/me", async (c) => {
  const user = await requireUser(c);
  await c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id).run();
  endSessionCookie(c);
  return c.json({ ok: true });
});

export async function cleanupExpired(env: Env): Promise<void> {
  const now = new Date();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM groups WHERE end_date < date(?, ?)").bind(now.toISOString().slice(0, 10), `-${LIMITS.retentionDays} days`),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now.toISOString()),
    env.DB.prepare(
      `DELETE FROM users WHERE id NOT IN (SELECT owner_id FROM groups) AND id NOT IN (SELECT user_id FROM sessions)`,
    ),
  ]);
}
