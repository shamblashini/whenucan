import { useMemo, useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router";
import { addDays } from "@shared/dates";
import { LIMITS } from "@shared/limits";
import { api, errorMessage } from "../api";
import { useApp } from "../App";
import { DateRangePicker, type Range } from "../components/DateRangePicker";
import { ShareLink, Wordmark, useTitle } from "../components/ui";
import { localToday, timezoneLabel, viewerTimezone } from "../format";
import { t } from "../i18n";

export function NewGroup() {
  useTitle(`${t("new.pageTitle")} | whenucan?`);
  const { user } = useApp();
  const today = useMemo(localToday, []);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [range, setRange] = useState<Range>({ start: today, end: addDays(today, 13) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ slug: string; name: string } | null>(null);

  if (!user) return <Navigate to="/" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!range.end) {
      setError(t("new.tapLastDay"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { slug } = await api<{ slug: string }>("/api/groups", {
        method: "POST",
        body: { name, description, startDate: range.start, endDate: range.end, timezone: viewerTimezone() },
      });
      setCreated({ slug, name: name.trim() });
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-xl px-4 py-5">
      <header className="mb-8 flex items-center justify-between">
        <Wordmark />
        <Link to="/dashboard" className="btn btn-quiet">
          {t("common.yourGroups")}
        </Link>
      </header>
      {created ? (
        <>
          <h1 className="mb-2 text-4xl font-bold tracking-tight">{t("new.ready", { name: created.name })}</h1>
          <p className="mb-5 text-lg">{t("new.readyBody")}</p>
          <ShareLink slug={created.slug} groupName={created.name} />
          <Link to={`/g/${created.slug}`} className="btn btn-plain mt-2 w-full">
            {t("new.openCalendar")}
          </Link>
        </>
      ) : (
        <form onSubmit={submit} className="space-y-6">
          <h1 className="text-4xl font-bold tracking-tight">{t("new.heading")}</h1>
          <div>
            <label className="label" htmlFor="group-name">
              {t("new.nameLabel")}
            </label>
            <input
              id="group-name"
              dir="auto"
              className="field"
              required
              autoFocus
              maxLength={LIMITS.groupNameLength}
              placeholder={t("new.namePlaceholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="group-note">
              {t("new.noteLabel")}
            </label>
            <textarea
              id="group-note"
              dir="auto"
              className="field"
              rows={2}
              maxLength={LIMITS.descriptionLength}
              placeholder={t("new.notePlaceholder")}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <span className="label">{t("new.datesLabel")}</span>
            <DateRangePicker value={range} onChange={setRange} />
          </div>
          <p className="text-soft">{t("new.timesIn", { zone: timezoneLabel(viewerTimezone()) })}</p>
          {error && (
            <p role="alert" className="font-semibold text-danger">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-primary w-full text-lg" disabled={busy}>
            {busy ? t("new.creating") : t("new.create")}
          </button>
        </form>
      )}
    </main>
  );
}
