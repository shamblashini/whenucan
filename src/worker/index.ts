import { errorText, isErrorKey } from "@shared/errors";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { ZodError } from "zod";
import type { Config } from "@shared/types";
import { authRoutes, cleanupExpired } from "./auth";
import { ApiError, clientIp, devLoginEnabled, rateLimit, type AppContext, type Env } from "./env";
import { groupRoutes } from "./groups";

export const app = new Hono<AppContext>();

// X-Download-Options only ever applied to Internet Explorer, and it says not to open files.
app.use(secureHeaders({ referrerPolicy: "same-origin", xFrameOptions: "DENY", xDownloadOptions: false }));

// Every API request counts, before any database work, so no route can be used to run up reads.
app.use("/api/*", async (c, next) => {
  await rateLimit(c.env.RL_READ, clientIp(c.req.raw));
  await next();
});

// The largest real request is a full calendar of day changes, well under this.
app.use(
  "/api/*",
  bodyLimit({
    maxSize: 64 * 1024,
    onError: () => {
      throw new ApiError(413, "too_large", "error.checkInput");
    },
  }),
);

// Browsers send Origin on cross-site writes. JSON bodies also force a CORS preflight, which this API never grants.
app.use("/api/*", async (c, next) => {
  if (c.req.method !== "GET") {
    const origin = c.req.header("origin");
    if (origin && origin !== new URL(c.req.url).origin) {
      throw new ApiError(403, "bad_origin", "error.badOrigin");
    }
  }
  await next();
  c.header("Cache-Control", c.res.headers.get("Cache-Control") ?? "no-store");
});

app.get("/api/config", (c) => {
  const config: Config = {
    turnstileSiteKey: c.env.TURNSTILE_SITE_KEY,
    googleEnabled: !!(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET),
    devLogin: devLoginEnabled(c.env, c.req.url),
    contactEmail: c.env.CONTACT_EMAIL,
    repoUrl: c.env.REPO_URL,
  };
  return c.json(config);
});

app.route("/", authRoutes);
app.route("/", groupRoutes);

app.all("/api/*", () => {
  throw new ApiError(404, "not_found", "error.notFound");
});

app.onError((error, c) => {
  if (error instanceof ApiError) {
    return c.json({ error: { code: error.code, message: error.message, key: error.key, vars: error.vars } }, error.status);
  }
  if (error instanceof ZodError) {
    const issue = error.issues[0]?.message;
    const key = isErrorKey(issue) ? issue : "error.checkInput";
    return c.json({ error: { code: "invalid", message: errorText(key), key } }, 400);
  }
  if (error instanceof SyntaxError) {
    return c.json({ error: { code: "invalid", message: errorText("error.invalidJson"), key: "error.invalidJson" } }, 400);
  }
  console.error("[api]", error);
  return c.json({ error: { code: "server_error", message: errorText("error.server"), key: "error.server" } }, 500);
});

export default {
  fetch: app.fetch,
  scheduled: (_controller, env, ctx) => {
    ctx.waitUntil(cleanupExpired(env));
  },
} satisfies ExportedHandler<Env>;
