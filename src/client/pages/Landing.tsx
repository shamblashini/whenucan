import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { addDays } from "@shared/dates";
import type { Vote } from "@shared/types";
import { api, errorMessage } from "../api";
import { useApp } from "../App";
import { DayGrid, MarkerTray, type Tally } from "../components/DayGrid";
import { SiteFooter, useTitle } from "../components/ui";
import { firstWeekday, localToday } from "../format";
import { t } from "../i18n";
import { useTurnstile } from "../turnstile";

export function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.7 1.2 9.2 3.6l6.9-6.9C35.9 2.4 30.5 0 24 0 14.6 0 6.5 5.4 2.6 13.2l8 6.2C12.5 13.6 17.8 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 7l7.2 5.6c4.2-3.9 7.1-9.7 7.1-17.1z" />
      <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-8-6.2C1 16.5 0 20.1 0 24s1 7.5 2.6 10.8l8-6.2z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8L32.7 36.6c-2 1.4-4.6 2.2-8.7 2.2-6.2 0-11.5-4.1-13.4-9.8l-8 6.2C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}

/** Shows the real grid working, with made-up friends, so the first visit explains itself. */
function Demo() {
  const today = useMemo(localToday, []);
  const start = useMemo(() => {
    const offset = (new Date(`${today}T00:00:00Z`).getUTCDay() - firstWeekday() + 7) % 7;
    return addDays(today, 7 - offset);
  }, [today]);
  const end = addDays(start, 20);
  const tallies = useMemo(() => {
    const pattern: Tally[] = [
      { yes: 1, ok: 1, no: 1 }, { yes: 0, ok: 1, no: 2 }, { yes: 2, ok: 1, no: 0 }, { yes: 3, ok: 0, no: 0 },
      { yes: 1, ok: 2, no: 0 }, { yes: 0, ok: 0, no: 3 }, { yes: 2, ok: 0, no: 1 },
    ];
    return Object.fromEntries(Array.from({ length: 21 }, (_, i) => [addDays(start, i), pattern[(i * 3) % 7]]));
  }, [start]);
  const [brush, setBrush] = useState<Vote>("yes");
  const [mine, setMine] = useState<Record<string, Vote | undefined>>(() => ({
    [addDays(start, 3)]: "yes",
    [addDays(start, 4)]: "yes",
    [addDays(start, 5)]: "no",
    [addDays(start, 10)]: "ok",
  }));
  return (
    <div className="rounded-xl border-2 border-ink bg-paper p-3 sm:p-4">
      <p className="mb-3 font-semibold">{t("landing.tryIt")}</p>
      <div className="mb-3">
        <MarkerTray brush={brush} onChange={setBrush} />
      </div>
      <DayGrid
        startDate={start}
        endDate={end}
        today={today}
        mode="mine"
        mine={mine}
        tallies={tallies}
        people={4}
        brush={brush}
        onPaint={(day, value) => setMine((prev) => ({ ...prev, [day]: value ?? undefined }))}
      />
    </div>
  );
}

export function Landing() {
  useTitle(`whenucan? ${t("common.pageTitleSuffix")}`);
  const { config, user, refreshUser } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const signingIn = !user && config.googleEnabled;
  const turnstile = useTurnstile(signingIn ? config.turnstileSiteKey : "", "signin");
  const [error, setError] = useState<string | null>(
    params.get("signin") === "failed" ? t("landing.signInFailed") : null,
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => setError((current) => turnstile.problem ?? current), [turnstile.problem]);

  // The count changes on other pages, so read it again each time someone comes back here.
  useEffect(() => {
    refreshUser().catch(() => undefined);
  }, [refreshUser]);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const turnstileToken = await turnstile.getToken();
      const { url } = await api<{ url: string }>("/api/auth/google/start", {
        method: "POST",
        body: { turnstileToken, next: "/new" },
      });
      location.assign(url);
    } catch (failure) {
      setError(errorMessage(failure));
      turnstile.reset();
      setBusy(false);
    }
  };

  const devSignIn = async () => {
    await api("/api/auth/dev", { method: "POST" });
    await refreshUser();
    navigate("/new");
  };

  return (
    <>
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <bdi className="wordmark text-xl">whenucan?</bdi>
        {user?.groupCount === 0 && (
          <Link to="/dashboard" className="btn btn-quiet">
            {t("landing.account")}
          </Link>
        )}
      </header>
      <main className="mx-auto grid max-w-6xl items-start gap-10 px-4 pt-4 lg:grid-cols-[1fr_27rem] lg:pt-12">
        <div>
          <h1 className="wordmark mb-5 text-[clamp(3.5rem,13vw,8rem)] leading-[0.92]"><bdi>when u can?</bdi></h1>
          <p className="mb-7 max-w-xl text-xl">
            {t("landing.tagline")}
          </p>
          <div className="max-w-xl">
            {user ? (
              user.groupCount === 0 ? (
                <Link to="/new" className="btn btn-primary min-h-16 w-full text-2xl">
                  {t("landing.createGroup")}
                </Link>
              ) : (
                <div className="flex gap-2">
                  <Link to="/new" className="btn btn-primary min-h-13 flex-1 px-3 text-lg whitespace-nowrap">
                    {t("landing.createGroup")}
                  </Link>
                  <Link to="/dashboard" className="btn btn-plain min-h-13 flex-1 px-3 text-lg whitespace-nowrap">
                    {t("common.yourGroups")}
                  </Link>
                </div>
              )
            ) : (
              <div className="max-w-md space-y-2">
                {config.googleEnabled && (
                  <button type="button" className="btn btn-google w-full" disabled={busy} onClick={signIn}>
                    <GoogleIcon />
                    {t("landing.google")}
                  </button>
                )}
                {config.devLogin && (
                  <button type="button" className="btn btn-plain w-full" onClick={devSignIn}>
                    {t("landing.devSignIn")}
                  </button>
                )}
                {!config.googleEnabled && !config.devLogin && <p className="font-semibold">{t("landing.unavailable")}</p>}
                <div ref={turnstile.slot} />
                <p className="pt-1 text-soft">{t("landing.onlyOrganiser")}</p>
              </div>
            )}
            {error && (
              <p role="alert" className="mt-3 font-semibold text-danger">
                {error}
              </p>
            )}
          </div>
          <ol className="mt-12 max-w-xl space-y-3">
            {[
              t("landing.step1"),
              t("landing.step2"),
              t("landing.step3"),
            ].map((step, index) => (
              <li key={step} className="flex gap-3">
                <span className="font-bold">{index + 1}.</span>
                {step}
              </li>
            ))}
          </ol>
        </div>
        <Demo />
      </main>
      <SiteFooter large />
    </>
  );
}
