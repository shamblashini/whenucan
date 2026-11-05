import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/worker/index";
import { call, createGroup, createOrganiser, errorCode, join, resetDb, stubFetch, testEnv } from "./helpers";

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

const { privateKey, publicKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };

interface Claims {
  nonce?: string;
  aud?: string;
  iss?: string;
  email_verified?: boolean;
}

/** Fakes Google's token and key endpoints. Claims are built after the app picks a nonce. */
function fakeGoogle(claims: (query: URLSearchParams) => Claims, onToken?: (body: URLSearchParams) => void) {
  let authorize = new URLSearchParams();
  stubFetch(async (url, init) => {
    if (url.includes("/oauth2/v3/certs")) return Response.json({ keys: [jwk] });
    if (url.includes("oauth2.googleapis.com/token")) {
      onToken?.(new URLSearchParams(String(init?.body)));
      const c = claims(authorize);
      const idToken = await new SignJWT({
        nonce: c.nonce ?? authorize.get("nonce"),
        email: "olive@example.test",
        email_verified: c.email_verified ?? true,
        name: "Olive Tree",
      })
        .setProtectedHeader({ alg: "RS256", kid: "k1" })
        .setIssuer(c.iss ?? "https://accounts.google.com")
        .setAudience(c.aud ?? "test-client-id")
        .setSubject("google-sub-1")
        .setExpirationTime("5m")
        .sign(privateKey);
      return Response.json({ id_token: idToken });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  return (query: URLSearchParams) => {
    authorize = query;
  };
}

async function start(next?: string) {
  const response = await call("/api/auth/google/start", { method: "POST", body: { turnstileToken: "ok", next } });
  expect(response.status).toBe(200);
  const { url } = (await response.json()) as { url: string };
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  return { query: new URL(url).searchParams, cookie };
}

function callback(query: URLSearchParams, cookie: string, state = query.get("state")!) {
  return call(`/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`, { cookie });
}

describe("Google sign-in", () => {
  it("requires Turnstile before sending anyone to Google", async () => {
    stubFetch(undefined, false);
    const response = await call("/api/auth/google/start", { method: "POST", body: { turnstileToken: "bad" } });
    expect(response.status).toBe(403);
  });

  it("uses PKCE and asks only for basic identity", async () => {
    const setQuery = fakeGoogle(() => ({}));
    const { query } = await start();
    setQuery(query);
    expect(query.get("scope")).toBe("openid email profile");
    expect(query.get("code_challenge_method")).toBe("S256");
    expect(query.get("redirect_uri")).toBe("http://localhost/auth/google/callback");
    expect(query.get("code_challenge")).toBeTruthy();
    expect(query.get("code_challenge")).not.toContain("=");
  });

  it("signs in, creates the account once, and returns to the requested page", async () => {
    let verifier: string | null = null;
    const setQuery = fakeGoogle(() => ({}), (body) => { verifier = body.get("code_verifier"); });
    const { query, cookie } = await start("/new");
    setQuery(query);

    const response = await callback(query, cookie);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/new");
    expect(verifier).toBeTruthy();

    const session = response.headers.getSetCookie().find((c) => c.startsWith("session="))!.split(";")[0];
    const { user } = (await (await call("/api/me", { cookie: session })).json()) as { user: { name: string; email: string } };
    expect(user).toMatchObject({ name: "Olive Tree", email: "olive@example.test", groupCount: 0 });

    const again = await start();
    setQuery(again.query);
    await callback(again.query, again.cookie);
    const { n } = (await testEnv.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>())!;
    expect(n).toBe(1);
  });

  it("does not redirect to another site after sign-in", async () => {
    const setQuery = fakeGoogle(() => ({}));
    const { query, cookie } = await start("//evil.example/");
    setQuery(query);
    const response = await callback(query, cookie);
    expect(response.headers.get("location")).toBe("/dashboard");
  });

  it("does not trust a redirect with control characters, which browsers strip", async () => {
    const setQuery = fakeGoogle(() => ({}));
    const { query, cookie } = await start("/\t/evil.example/");
    setQuery(query);
    const response = await callback(query, cookie);
    expect(response.headers.get("location")).toBe("/dashboard");
  });

  for (const [name, claims] of [
    ["a wrong nonce", { nonce: "other" }],
    ["a token for another app", { aud: "another-client" }],
    ["a token from another issuer", { iss: "https://evil.example" }],
    ["an unverified email", { email_verified: false }],
  ] as [string, Claims][]) {
    it(`rejects ${name}`, async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const setQuery = fakeGoogle(() => claims);
      const { query, cookie } = await start();
      setQuery(query);
      const response = await callback(query, cookie);
      expect(response.headers.get("location")).toBe("/?signin=failed");
      expect(response.headers.getSetCookie().some((c) => c.startsWith("session="))).toBe(false);
    });
  }

  it("rejects a mismatched state and a missing flow cookie", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const setQuery = fakeGoogle(() => ({}));
    const { query, cookie } = await start();
    setQuery(query);
    expect((await callback(query, cookie, "forged")).headers.get("location")).toBe("/?signin=failed");
    expect((await callback(query, "")).headers.get("location")).toBe("/?signin=failed");
  });

  it("explains when Google is not configured", async () => {
    stubFetch();
    const env = { ...testEnv, GOOGLE_CLIENT_ID: "" };
    const response = await app.request(
      "http://localhost/api/auth/google/start",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ turnstileToken: "ok" }) },
      env,
    );
    expect(response.status).toBe(503);
    expect(await errorCode(response)).toBe("google_not_configured");
  });
});

describe("test sign-in", () => {
  it("works only on localhost with the flag set", async () => {
    const post = (url: string, env: object) => app.request(url, { method: "POST" }, env);
    expect((await post("http://localhost/api/auth/dev", testEnv)).status).toBe(200);
    expect((await post("https://example.com/api/auth/dev", testEnv)).status).toBe(404);
    expect((await post("http://localhost/api/auth/dev", { ...testEnv, DEV_LOGIN: undefined })).status).toBe(404);
  });

  it("is not advertised in production", async () => {
    const config = await (await app.request("https://example.com/api/config", {}, testEnv)).json<{ devLogin: boolean }>();
    expect(config.devLogin).toBe(false);
  });
});

describe("sessions", () => {
  it("signs out on the server, not just in the browser", async () => {
    const owner = await createOrganiser();
    expect((await call("/api/auth/logout", { method: "POST", cookie: owner.cookie })).status).toBe(200);
    const { user } = (await (await call("/api/me", { cookie: owner.cookie })).json()) as { user: unknown };
    expect(user).toBeNull();
  });

  it("deleting an account removes its groups and everyone's answers", async () => {
    stubFetch();
    const owner = await createOrganiser();
    const slug = await createGroup(owner.cookie);
    await join(slug, "Anna");
    expect((await call("/api/me", { method: "DELETE", cookie: owner.cookie })).status).toBe(200);
    expect((await call(`/api/g/${slug}`)).status).toBe(404);
    const row = await testEnv.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM users) + (SELECT COUNT(*) FROM sessions) + (SELECT COUNT(*) FROM participants) AS n",
    ).first<{ n: number }>();
    expect(row!.n).toBe(0);
  });
});
