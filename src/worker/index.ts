import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { ZodError } from "zod";
import type { Config } from "@shared/types";
import { authRoutes, cleanupExpired } from "./auth";
import { ApiError, devLoginEnabled, type AppContext, type Env } from "./env";
import { groupRoutes } from "./groups";

export const app = new Hono<AppContext>();

app.use(secureHeaders({ referrerPolicy: "same-origin", xFrameOptions: "DENY" }));

// Browsers send Origin on cross-site writes. JSON bodies also force a CORS preflight, which this API never grants.
app.use("/api/*", async (c, next) => {
  if (c.req.method !== "GET") {
    const origin = c.req.header("origin");
    if (origin && origin !== new URL(c.req.url).origin) {
      throw new ApiError(403, "bad_origin", "This request came from another site.");
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
  throw new ApiError(404, "not_found", "Not found.");
});

app.onError((error, c) => {
  if (error instanceof ApiError) {
    return c.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  if (error instanceof ZodError) {
    return c.json({ error: { code: "invalid", message: error.issues[0]?.message ?? "Check your input." } }, 400);
  }
  if (error instanceof SyntaxError) {
    return c.json({ error: { code: "invalid", message: "Send a valid JSON body." } }, 400);
  }
  console.error("[api]", error);
  return c.json({ error: { code: "server_error", message: "Something failed on the server. Try again." } }, 500);
});

export default {
  fetch: app.fetch,
  scheduled: (_controller, env, ctx) => {
    ctx.waitUntil(cleanupExpired(env));
  },
} satisfies ExportedHandler<Env>;
