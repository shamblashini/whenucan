import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "./i18n";

interface TurnstileApi {
  render(element: HTMLElement, options: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadScript(): Promise<TurnstileApi> {
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("no turnstile")));
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("blocked"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/**
 * Runs Turnstile quietly in the background. It only takes space on the page in the rare
 * case Cloudflare wants the visitor to click something. Each token works once.
 */
export function useTurnstile(siteKey: string, action: "join" | "signin") {
  const slot = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const token = useRef<string | null>(null);
  const waiting = useRef<{ resolve: (t: string) => void; reject: (e: Error) => void } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!siteKey || !slot.current) return;
    let cancelled = false;
    const element = slot.current;
    loadScript()
      .then((turnstile) => {
        if (cancelled) return;
        widget.current = turnstile.render(element, {
          sitekey: siteKey,
          action,
          appearance: "interaction-only",
          "refresh-expired": "auto",
          callback: (value: string) => {
            token.current = value;
            setProblem(null);
            waiting.current?.resolve(value);
            waiting.current = null;
          },
          "expired-callback": () => {
            token.current = null;
          },
          "error-callback": () => {
            token.current = null;
            const message = t("error.botFailed");
            setProblem(message);
            waiting.current?.reject(new Error(message));
            waiting.current = null;
            return true;
          },
        });
      })
      .catch(() => {
        if (!cancelled) setProblem(t("error.botBlocked"));
      });
    return () => {
      cancelled = true;
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey, action]);

  const getToken = useCallback((): Promise<string | undefined> => {
    if (!siteKey) return Promise.resolve(undefined);
    if (token.current) return Promise.resolve(token.current);
    if (problem) return Promise.reject(new Error(problem));
    return new Promise((resolve, reject) => {
      waiting.current = { resolve, reject };
      setTimeout(() => {
        if (waiting.current?.resolve === resolve) {
          waiting.current = null;
          reject(new Error(t("error.botSlow")));
        }
      }, 30_000);
    });
  }, [siteKey, problem]);

  const reset = useCallback(() => {
    token.current = null;
    if (widget.current) window.turnstile?.reset(widget.current);
  }, []);

  return { slot, getToken, reset, problem };
}
