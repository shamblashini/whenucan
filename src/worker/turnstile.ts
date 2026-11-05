import { ApiError, devLoginEnabled, type Env } from "./env";

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile(
  env: Env,
  request: Request,
  token: string | undefined,
  action: "join" | "signin",
): Promise<void> {
  if (!env.TURNSTILE_SECRET_KEY) throw new ApiError(503, "not_configured", "Bot protection is not set up yet.");
  if (!token) throw new ApiError(403, "turnstile_failed", "Bot check missing. Reload the page and try again.");

  const form = new FormData();
  form.set("secret", env.TURNSTILE_SECRET_KEY);
  form.set("response", token);
  const ip = request.headers.get("cf-connecting-ip");
  if (ip) form.set("remoteip", ip);

  let result: { success?: boolean; action?: string };
  try {
    const response = await fetch(SITEVERIFY, { method: "POST", body: form, signal: AbortSignal.timeout(5000) });
    result = await response.json();
  } catch {
    throw new ApiError(503, "turnstile_unavailable", "The bot check is unavailable. Try again in a moment.");
  }

  // Cloudflare's test keys report a fixed action, so it can only be compared in production.
  const actionOk = devLoginEnabled(env, request.url) || result.action === action;
  if (!result.success || !actionOk) {
    throw new ApiError(403, "turnstile_failed", "The bot check did not pass. Reload the page and try again.");
  }
}
