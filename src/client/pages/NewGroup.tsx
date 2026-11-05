import { useMemo, useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router";
import { addDays } from "@shared/dates";
import { LIMITS } from "@shared/limits";
import { api, errorMessage } from "../api";
import { useApp } from "../App";
import { DateRangePicker, type Range } from "../components/DateRangePicker";
import { ShareLink, Wordmark, useTitle } from "../components/ui";
import { localToday, timezoneLabel, viewerTimezone } from "../format";

export function NewGroup() {
  useTitle("New group | whenucan?");
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
      setError("Tap the last day of your date range.");
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
          Your groups
        </Link>
      </header>
      {created ? (
        <>
          <h1 className="mb-2 text-4xl font-bold tracking-tight">{created.name} is ready</h1>
          <p className="mb-5 text-lg">Send this link to your group. Anyone who has it can open the calendar and answer.</p>
          <ShareLink slug={created.slug} groupName={created.name} />
          <Link to={`/g/${created.slug}`} className="btn btn-plain mt-2 w-full">
            Open the calendar
          </Link>
        </>
      ) : (
        <form onSubmit={submit} className="space-y-6">
          <h1 className="text-4xl font-bold tracking-tight">New group</h1>
          <div>
            <label className="label" htmlFor="group-name">
              What are you planning?
            </label>
            <input
              id="group-name"
              className="field"
              required
              autoFocus
              maxLength={LIMITS.groupNameLength}
              placeholder="Ski trip, Friday dinner, band practice"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="group-note">
              Note for the group (optional)
            </label>
            <textarea
              id="group-note"
              className="field"
              rows={2}
              maxLength={LIMITS.descriptionLength}
              placeholder="Anything people should know before they answer"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <span className="label">Which dates are possible?</span>
            <DateRangePicker value={range} onChange={setRange} />
          </div>
          <p className="text-soft">Times in this group will be in {timezoneLabel(viewerTimezone())} time.</p>
          {error && (
            <p role="alert" className="font-semibold text-danger">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-primary w-full text-lg" disabled={busy}>
            {busy ? "Creating…" : "Create group"}
          </button>
        </form>
      )}
    </main>
  );
}
