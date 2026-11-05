import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { addDays } from "@shared/dates";
import { LIMITS } from "@shared/limits";
import type { GroupMeta, GroupState, JoinResult, Participant, Proposal, Vote } from "@shared/types";
import { ApiFailure, api, errorMessage, rawRequest } from "../api";
import { useApp } from "../App";
import { DateRangePicker, type Range } from "../components/DateRangePicker";
import { DayGrid, MarkerTray, type Tally } from "../components/DayGrid";
import { ConfirmButton, Glyph, ShareLink, Sheet, SiteFooter, Spinner, Wordmark, shareUrl, useTitle, useToast } from "../components/ui";
import {
  VOTES, formatDayLong, formatHour, formatDayNumber, formatMonthShort, formatProposalTime, formatRangeDays, formatWeekday, googleCalendarUrl, localToday,
  timezoneLabel, viewerTimezone, voteLabel,
} from "../format";
import { t } from "../i18n";
import { clearIdentity, loadIdentity, saveIdentity, type Identity } from "../storage";
import { useTurnstile } from "../turnstile";
import { useGroupState } from "../useGroupState";

/** Remounts per link, so nothing from an old link can reach the page for a new one. */
export function GroupPage() {
  const { slug = "" } = useParams();
  return <Group key={slug} slug={slug} />;
}

function Group({ slug }: { slug: string }) {
  const [meta, setMeta] = useState<GroupMeta | null>(null);
  const [gone, setGone] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(() => loadIdentity(slug));
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setMeta(await api<GroupMeta>(`/api/g/${slug}`));
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 404) setGone(true);
      else setLoadError(errorMessage(error));
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const leave = useCallback(
    (message?: string) => {
      clearIdentity(slug);
      setIdentity(null);
      setNotice(message ?? null);
      // Refresh the names, so the person sees who is in the group now.
      void api<GroupMeta>(`/api/g/${slug}`).then(setMeta, () => undefined);
    },
    [slug],
  );

  useTitle(meta ? `${meta.name} | whenucan?` : "whenucan?");

  if (gone) return <DeadLink />;
  if (loadError) {
    return (
      <main className="mx-auto max-w-lg px-4 py-20">
        <p role="alert" className="mb-4 text-lg font-semibold">{loadError}</p>
        <button type="button" className="btn btn-primary" onClick={load}>
          {t("common.tryAgain")}
        </button>
      </main>
    );
  }
  if (!meta) return <Spinner />;
  if (!identity) {
    return (
      <JoinScreen
        meta={meta}
        notice={notice}
        onJoined={(next) => {
          saveIdentity(slug, next);
          setIdentity(next);
          setNotice(null);
        }}
      />
    );
  }
  return (
    <Planner
      key={`${slug}:${identity.id}`}
      slug={slug}
      meta={meta}
      identity={identity}
      onLeave={leave}
      onGone={() => setGone(true)}
    />
  );
}

function DeadLink() {
  useTitle(`${t("dead.pageTitle")} | whenucan?`);
  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <Wordmark />
      <h1 className="mt-16 mb-3 text-4xl font-bold tracking-tight">{t("dead.heading")}</h1>
      <p className="text-lg">
        {t("dead.body")}
      </p>
    </main>
  );
}

function JoinScreen({ meta, notice, onJoined }: { meta: GroupMeta; notice: string | null; onJoined: (identity: Identity) => void }) {
  const { config, user } = useApp();
  const toast = useToast();
  const skipCheck = meta.isOwner;
  const turnstile = useTurnstile(skipCheck ? "" : config.turnstileSiteKey, "join");
  const [name, setName] = useState(() => (meta.isOwner && user ? user.name.split(" ")[0] : ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(notice);

  useEffect(() => {
    if (turnstile.problem) setError(turnstile.problem);
  }, [turnstile.problem]);

  const join = async (chosen: string) => {
    if (!chosen.trim()) {
      setError(t("join.enterName"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const turnstileToken = await turnstile.getToken();
      const result = await api<JoinResult>(`/api/g/${meta.slug}/join`, {
        method: "POST",
        body: { name: chosen, turnstileToken },
      });
      if (result.returning) toast(t("join.welcomeBack", { name: result.participant.name }));
      onJoined({ token: result.token, id: result.participant.id, name: result.participant.name });
    } catch (failure) {
      setError(errorMessage(failure));
      turnstile.reset();
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void join(name);
  };

  return (
    <>
      <main className="mx-auto max-w-xl px-4 py-5">
        <Wordmark />
        <h1 className="wordmark mt-14 mb-2 text-[clamp(2.5rem,10vw,4.5rem)] leading-none break-words">{meta.name}</h1>
        <p className="mb-2 text-lg font-semibold">{formatRangeDays(meta.startDate, meta.endDate)}</p>
        {meta.description && <p className="mb-2 text-lg">{meta.description}</p>}
        <form onSubmit={submit} className="mt-8">
          <label className="label text-lg" htmlFor="your-name">
            {t("join.nameLabel")}
          </label>
          <div className="flex gap-2">
            <input
              id="your-name"
              className="field text-lg"
              autoFocus
              autoComplete="given-name"
              autoCapitalize="words"
              enterKeyHint="go"
              maxLength={LIMITS.nameLength}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button type="submit" className="btn btn-primary min-h-12 shrink-0 text-lg" disabled={busy}>
              {busy ? t("join.opening") : t("join.continue")}
            </button>
          </div>
          <div ref={turnstile.slot} className="mt-2" />
          {error && (
            <p role="alert" className="mt-3 font-semibold text-danger">
              {error}
            </p>
          )}
        </form>
        {meta.names.length > 0 && (
          <div className="mt-6">
            <p className="mb-2 text-soft">{t("join.beenHere")}</p>
            <div className="flex flex-wrap gap-1.5">
              {meta.names.map((existing) => (
                <button key={existing} type="button" className="chip" disabled={busy} onClick={() => join(existing)}>
                  {existing}
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="mt-8 text-soft">
          {t("join.warning")}
        </p>
      </main>
      <SiteFooter />
    </>
  );
}

function useDayData(state: GroupState | null, me: string) {
  return useMemo(() => {
    const mine: Record<string, Vote | undefined> = {};
    const tallies: Record<string, Tally | undefined> = {};
    if (state) {
      for (const [day, votes] of Object.entries(state.days)) {
        const tally: Tally = { yes: 0, ok: 0, no: 0 };
        for (const [participant, value] of Object.entries(votes)) {
          tally[value] += 1;
          if (participant === me) mine[day] = value;
        }
        tallies[day] = tally;
      }
    }
    return { mine, tallies };
  }, [state, me]);
}

/** Fewest no's first, then most yes, then most OK, then soonest. */
function rankDays(tallies: Record<string, Tally | undefined>, today: string): { day: string; tally: Tally }[] {
  return Object.entries(tallies)
    .filter((entry): entry is [string, Tally] => !!entry[1] && entry[0] >= today && entry[1].yes + entry[1].ok > 0)
    .map(([day, tally]) => ({ day, tally }))
    .sort((a, b) => a.tally.no - b.tally.no || b.tally.yes - a.tally.yes || b.tally.ok - a.tally.ok || a.day.localeCompare(b.day))
    .slice(0, 3);
}

function Planner({
  slug, meta, identity, onLeave, onGone,
}: {
  slug: string;
  meta: GroupMeta;
  identity: Identity;
  onLeave: (message?: string) => void;
  onGone: () => void;
}) {
  const toast = useToast();
  const { state, refresh, change, markDay, pause } = useGroupState(slug, identity.token, {
    onSignedOut: onLeave,
    onGone,
    onError: toast,
  });
  const [mode, setMode] = useState<"mine" | "everyone">("mine");
  const [brush, setBrush] = useState<Vote>("yes");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [proposing, setProposing] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [organising, setOrganising] = useState(false);
  const today = useMemo(localToday, []);
  const { mine, tallies } = useDayData(state, identity.id);
  const best = useMemo(() => rankDays(tallies, today), [tallies, today]);

  if (!state) return <Spinner />;

  const group = state.group;
  const names = new Map(state.participants.map((p) => [p.id, p.name]));
  const answeredAny = Object.keys(mine).some((day) => mine[day]);
  const defaultDay = best[0]?.day ?? (today > group.startDate && today <= group.endDate ? today : group.startDate);

  const showDay = (day: string) => {
    setMode("everyone");
    setSelectedDay(day);
  };

  return (
    <>
      <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 pt-4">
        <Wordmark />
        <div className="flex flex-wrap items-center gap-1">
          <span className="font-semibold">{identity.name}</span>
          <button type="button" className="btn btn-quiet" onClick={() => onLeave()}>
            {t("group.notYou")}
          </button>
          {meta.isOwner && (
            <button type="button" className="btn btn-quiet" onClick={() => setOrganising(true)}>
              {t("group.organise")}
            </button>
          )}
          <button type="button" className="btn btn-plain" onClick={() => setSharing(true)}>
            {t("group.shareLink")}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-6">
        <div className="mb-6">
          <h1 className="wordmark text-[clamp(2.25rem,7vw,4rem)] leading-none break-words">{group.name}</h1>
          <p className="mt-2 text-lg font-semibold">
            {t("group.summary", { range: formatRangeDays(group.startDate, group.endDate), count: state.participants.length })}
          </p>
          {group.description && <p className="mt-1 max-w-2xl text-lg">{group.description}</p>}
        </div>

        <div className="grid items-start gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,27rem)_minmax(0,1fr)]">
          <section aria-labelledby="days-heading">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 id="days-heading" className="text-2xl font-bold tracking-tight">
                {t("group.days")}
              </h2>
              <div role="tablist" aria-label={t("group.calendarView")} className="flex rounded-lg border-[1.5px] border-ink p-0.5">
                {(["mine", "everyone"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={mode === value}
                    className={`min-h-9 rounded-md px-3 font-semibold ${mode === value ? "bg-ink text-paper" : ""}`}
                    onClick={() => setMode(value)}
                  >
                    {value === "mine" ? t("group.mine") : t("group.everyone")}
                  </button>
                ))}
              </div>
            </div>
            {mode === "mine" && !answeredAny && (
              <p className="mb-3 font-medium">{t("group.markHint")}</p>
            )}
            {mode === "everyone" && <EveryoneLegend />}
            <DayGrid
              startDate={group.startDate}
              endDate={group.endDate}
              today={today}
              mode={mode}
              mine={mine}
              tallies={tallies}
              people={state.participants.length}
              brush={brush}
              bestDays={best.map((b) => b.day)}
              selectedDay={selectedDay}
              onPaint={(day, value) => markDay(identity.id, day, value)}
              onSelectDay={setSelectedDay}
            />
            {mode === "mine" && (
              <div className="sticky bottom-0 z-10 -mx-4 mt-3 bg-paper/95 px-4 py-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))] backdrop-blur-sm sm:mx-0 sm:px-0">
                <MarkerTray brush={brush} onChange={setBrush} />
              </div>
            )}
            {mode === "everyone" && selectedDay && (
              <DayDetail
                day={selectedDay}
                state={state}
                onPropose={() => setProposing(selectedDay)}
              />
            )}
            {best.length > 0 && <BestDays best={best} state={state} onShow={showDay} />}
          </section>

          <section aria-labelledby="proposals-heading">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 id="proposals-heading" className="text-2xl font-bold tracking-tight">
                {t("proposals.heading")}
              </h2>
              <button type="button" className="btn btn-primary" onClick={() => setProposing(defaultDay)}>
                {t("proposals.propose")}
              </button>
            </div>
            {viewerTimezone() !== group.timezone && state.proposals.length > 0 && (
              <p className="mb-2 text-soft">{t("proposals.timesIn", { zone: timezoneLabel(group.timezone) })}</p>
            )}
            {state.proposals.length === 0 ? (
              <p className="border-t-[1.5px] border-rule pt-4 text-lg">
                {t("proposals.empty")}
              </p>
            ) : (
              <ul className="border-t-[1.5px] border-rule">
                {state.proposals.map((proposal) => (
                  <ProposalRow
                    key={proposal.id}
                    proposal={proposal}
                    names={names}
                    participants={state.participants}
                    me={identity.id}
                    canDelete={meta.isOwner || proposal.createdBy === identity.id}
                    calendarUrl={googleCalendarUrl({
                      title: proposal.title ? `${proposal.title} (${group.name})` : group.name,
                      startsAt: proposal.startsAt,
                      endsAt: proposal.endsAt,
                      timezone: group.timezone,
                      details: [group.description, shareUrl(slug)].filter(Boolean).join("\n\n"),
                    })}
                    onVote={(value) =>
                      change(
                        (current) => ({
                          ...current,
                          proposals: current.proposals.map((p) => {
                            if (p.id !== proposal.id) return p;
                            const votes = { ...p.votes };
                            if (value) votes[identity.id] = value;
                            else delete votes[identity.id];
                            return { ...p, votes };
                          }),
                        }),
                        () => rawRequest(`/api/g/${slug}/proposals/${proposal.id}/vote`, { method: "PUT", token: identity.token, body: { value } }),
                      )
                    }
                    onDelete={async () => {
                      const ok = await change(
                        (current) => ({ ...current, proposals: current.proposals.filter((p) => p.id !== proposal.id) }),
                        () => rawRequest(`/api/g/${slug}/proposals/${proposal.id}`, { method: "DELETE", token: identity.token }),
                      );
                      if (ok) toast(t("proposals.removed"));
                    }}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
      <SiteFooter />

      {sharing && (
        <Sheet title={t("group.shareTitle")} onClose={() => setSharing(false)}>
          <p className="mb-3">{t("group.shareBody")}</p>
          <ShareLink slug={slug} groupName={group.name} />
        </Sheet>
      )}
      {proposing && (
        <ProposalForm
          slug={slug}
          token={identity.token}
          startDate={group.startDate}
          endDate={group.endDate}
          today={today}
          initialDay={proposing}
          timezone={group.timezone}
          onClose={() => setProposing(null)}
          onCreated={async () => {
            setProposing(null);
            toast(t("proposals.added"));
            await refresh();
          }}
          onSignedOut={onLeave}
        />
      )}
      {organising && (
        <OrganiserSheet
          slug={slug}
          state={state}
          me={identity}
          onClose={() => setOrganising(false)}
          onChanged={refresh}
          onLeavingLink={pause}
        />
      )}
    </>
  );
}

function namesText(names: string[]): string {
  if (names.length <= 3) return names.join(", ");
  return t("best.namesMore", { names: names.slice(0, 3).join(", "), count: names.length - 3 });
}

function BestDays({
  best, state, onShow,
}: {
  best: { day: string; tally: Tally }[];
  state: GroupState;
  onShow: (day: string) => void;
}) {
  const people = state.participants;
  return (
    <div className="mt-6">
      <h3 className="mb-1 text-lg font-bold">{t("best.heading")}</h3>
      <ol className="border-t-[1.5px] border-rule">
        {best.map(({ day, tally }, index) => {
          const votes = state.days[day] ?? {};
          const said = (value: Vote) => people.filter((p) => votes[p.id] === value).map((p) => p.name);
          const waiting = people.filter((p) => !votes[p.id]).map((p) => p.name);
          const can = tally.yes + tally.ok;
          const everyone = people.length > 1 && can === people.length;
          const details = [
            [tally.yes && t("best.yesCount", { count: tally.yes }), tally.ok && t("best.okCount", { count: tally.ok })].filter(Boolean).join(", "),
            tally.no > 0 && t("best.cant", { names: namesText(said("no")) }),
            waiting.length > 0 && t("best.waiting", { names: namesText(waiting) }),
          ].filter(Boolean);
          return (
            <li key={day} className="border-b-[1.5px] border-rule">
              <button type="button" className="best-day" onClick={() => onShow(day)}>
                <span className="leaf">
                  <span className="leaf-top">{formatWeekday(day)}</span>
                  <span className="leaf-day">
                    {index === 0 && (
                      <svg viewBox="0 0 100 64" preserveAspectRatio="none" aria-hidden="true">
                        <path d="M56 5C27 2 5 13 4 31c-1 19 22 29 48 27 26-2 45-14 44-31C95 11 73 3 42 7" />
                      </svg>
                    )}
                    {formatDayNumber(day)}
                  </span>
                  <span className="leaf-month">{formatMonthShort(day)}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-bold">
                    {everyone ? (tally.ok ? t("best.allCan") : t("best.allYes")) : t("best.someCan", { can, total: people.length })}
                  </span>
                  <span className="who" data-dense={people.length > 24 || undefined} aria-hidden="true">
                    {(["yes", "ok", "no"] as const).flatMap((value) =>
                      Array.from({ length: tally[value] }, (_, i) => <span key={`${value}${i}`} className={`mark-${value}`} />),
                    )}
                    {waiting.map((name) => <span key={name} className="who-waiting" />)}
                  </span>
                  <span className="block text-soft">{details.join(". ")}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function EveryoneLegend() {
  return (
    <p className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-soft">
      {VOTES.map((value) => (
        <span key={value} className="inline-flex items-center gap-1.5">
          <span className={`inline-block h-3.5 w-3.5 rounded-sm bg-${value}`} />
          {voteLabel(value)}
        </span>
      ))}
      <span>{t("group.tapDayHint")}</span>
    </p>
  );
}

function DayDetail({ day, state, onPropose }: { day: string; state: GroupState; onPropose: () => void }) {
  const votes = state.days[day] ?? {};
  const byVote = (value: Vote) => state.participants.filter((p) => votes[p.id] === value).map((p) => p.name);
  const waiting = state.participants.filter((p) => !votes[p.id]).map((p) => p.name);
  return (
    <div className="mt-4 border-t-[1.5px] border-rule pt-3" aria-live="polite">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-bold">{formatDayLong(day)}</h3>
        <button type="button" className="btn btn-plain" onClick={onPropose}>
          {t("day.proposeHere")}
        </button>
      </div>
      <dl className="space-y-1">
        {VOTES.map((value) => (
          <div key={value} className="flex gap-2">
            <dt className="w-14 shrink-0 font-semibold">{voteLabel(value)}</dt>
            <dd>{byVote(value).join(", ") || <span className="text-soft">{t("day.nobody")}</span>}</dd>
          </div>
        ))}
        {waiting.length > 0 && (
          <div className="flex gap-2 text-soft">
            <dt className="w-14 shrink-0 font-semibold">{t("day.noAnswer")}</dt>
            <dd>{waiting.join(", ")}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function ProposalRow({
  proposal, names, participants, me, canDelete, calendarUrl, onVote, onDelete,
}: {
  proposal: Proposal;
  names: Map<string, string>;
  participants: Participant[];
  me: string;
  canDelete: boolean;
  calendarUrl: string;
  onVote: (value: Vote | null) => void;
  onDelete: () => Promise<void>;
}) {
  const mine = proposal.votes[me];
  const creator = names.get(proposal.createdBy);
  const list = (value: Vote) => participants.filter((p) => proposal.votes[p.id] === value).map((p) => p.name);
  const waiting = participants.filter((p) => !proposal.votes[p.id]).map((p) => p.name);
  return (
    <li className="border-b-[1.5px] border-rule py-4">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-[1_1_16rem]">
          <p className="text-xl font-bold leading-snug">{formatProposalTime(proposal.startsAt, proposal.endsAt)}</p>
          {proposal.title && <p className="text-lg break-words">{proposal.title}</p>}
          <p className="text-soft">{creator ? t("proposal.by", { name: creator }) : t("proposal.byUnknown")}</p>
        </div>
        <div className="flex flex-[1_1_14rem] gap-1.5 sm:max-w-xs" role="group" aria-label={t("proposal.yourAnswer")}>
          {VOTES.map((value) => (
            <button
              key={value}
              type="button"
              className="vote"
              data-v={value}
              aria-pressed={mine === value}
              onClick={() => onVote(mine === value ? null : value)}
            >
              <Glyph value={value} className="h-4 w-4" />
              {voteLabel(value)}
            </button>
          ))}
        </div>
      </div>
      <dl className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1">
        {VOTES.map((value) => {
          const people = list(value);
          return people.length > 0 ? (
            <div key={value} className="flex gap-1.5">
              <dt className="inline-flex items-baseline gap-1 font-semibold">
                <span className={`inline-block h-2.5 w-2.5 rounded-sm bg-${value}`} />
                {voteLabel(value)}
              </dt>
              <dd>{people.join(", ")}</dd>
            </div>
          ) : null;
        })}
        {waiting.length > 0 && (
          <div className="flex gap-1.5 text-soft">
            <dt>{t("proposal.noAnswer")}</dt>
            <dd>{waiting.join(", ")}</dd>
          </div>
        )}
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <a href={calendarUrl} target="_blank" rel="noopener noreferrer" className="btn btn-plain min-h-9 px-3 py-1">
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <rect x="2" y="3" width="12" height="11" rx="1.5" />
            <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3M8 8.5v3.5M6.25 10.25h3.5" />
          </svg>
          {t("proposal.addToCalendar")}
        </a>
        {canDelete && (
          <ConfirmButton label={t("proposal.remove")} confirmLabel={t("proposal.removeConfirm")} onConfirm={onDelete} className="btn btn-quiet" />
        )}
      </div>
    </li>
  );
}

/** Two dropdowns, because a native time input follows the browser's clock format and ignores ours. */
function TimeSelect({ id, value, onChange }: { id: string; value: string; onChange: (next: string) => void }) {
  const [hour, minute] = value.split(":");
  return (
    <div className="flex gap-1.5">
      <select id={id} className="field min-w-0 flex-[3] px-2" value={hour} onChange={(e) => onChange(`${e.target.value}:${minute}`)}>
        {Array.from({ length: 24 }, (_, h) => (
          <option key={h} value={String(h).padStart(2, "0")}>
            {formatHour(h)}
          </option>
        ))}
      </select>
      <select className="field min-w-0 flex-[2] px-2" aria-label={t("form.minutes")} value={minute} onChange={(e) => onChange(`${hour}:${e.target.value}`)}>
        {Array.from({ length: 12 }, (_, m) => String(m * 5).padStart(2, "0")).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

function ProposalForm({
  slug, token, startDate, endDate, today, initialDay, timezone, onClose, onCreated, onSignedOut,
}: {
  slug: string;
  token: string;
  startDate: string;
  endDate: string;
  today: string;
  initialDay: string;
  timezone: string;
  onClose: () => void;
  onCreated: () => Promise<void>;
  onSignedOut: (message?: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [day, setDay] = useState(initialDay);
  const [from, setFrom] = useState("18:00");
  const [to, setTo] = useState("20:00");
  const [longer, setLonger] = useState(false);
  const [endDay, setEndDay] = useState(initialDay);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A finish earlier than the start means it runs past midnight, unless an end date was chosen.
  const overnight = !longer && to <= from;
  const finishDay = longer ? endDay : overnight ? addDays(day, 1) : day;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/g/${slug}/proposals`, {
        method: "POST",
        token,
        body: { title, startsAt: `${day}T${from}`, endsAt: `${finishDay}T${to}` },
      });
      await onCreated();
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 401) onSignedOut();
      setError(errorMessage(failure));
      setBusy(false);
    }
  };

  const minDay = today > startDate && today <= endDate ? today : startDate;
  return (
    <Sheet title={t("form.title")} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="proposal-title">
            {t("form.plan")}
          </label>
          <input
            id="proposal-title"
            className="field"
            maxLength={LIMITS.proposalTitleLength}
            placeholder={t("form.planPlaceholder")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="proposal-day">
            {longer ? t("form.startDate") : t("form.date")}
          </label>
          <input
            id="proposal-day"
            className="field"
            type="date"
            required
            min={minDay}
            max={endDate}
            value={day}
            onChange={(e) => {
              setDay(e.target.value);
              if (endDay < e.target.value) setEndDay(e.target.value);
            }}
          />
        </div>
        {longer && (
          <div>
            <label className="label" htmlFor="proposal-end-day">
              {t("form.endDate")}
            </label>
            <input
              id="proposal-end-day"
              className="field"
              type="date"
              required
              min={day}
              max={addDays(endDate, 1)}
              value={endDay}
              onChange={(e) => setEndDay(e.target.value)}
            />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="proposal-from">
              {t("form.from")}
            </label>
            <TimeSelect id="proposal-from" value={from} onChange={setFrom} />
          </div>
          <div>
            <label className="label" htmlFor="proposal-to">
              {t("form.to")}
            </label>
            <TimeSelect id="proposal-to" value={to} onChange={setTo} />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-soft">
            {overnight ? `${t("form.endsNextDay")} ` : ""}
            {viewerTimezone() !== timezone ? t("form.inZone", { zone: timezoneLabel(timezone) }) : ""}
          </p>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => {
              setEndDay(finishDay);
              setLonger(!longer);
            }}
          >
            {longer ? t("form.sameDay") : t("form.addEndDate")}
          </button>
        </div>
        {error && (
          <p role="alert" className="font-semibold text-danger">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary w-full text-lg" disabled={busy}>
          {busy ? t("form.adding") : t("form.add")}
        </button>
      </form>
    </Sheet>
  );
}

function OrganiserSheet({
  slug, state, me, onClose, onChanged, onLeavingLink,
}: {
  slug: string;
  state: GroupState;
  me: Identity;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onLeavingLink: () => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const group = state.group;
  const today = useMemo(localToday, []);
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description);
  const [range, setRange] = useState<Range>({ start: group.startDate, end: group.endDate });
  const [timezone] = useState(group.timezone);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const shrinks = range.end !== null && (range.start > group.startDate || range.end < group.endDate);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!range.end) {
      setError(t("new.tapLastDay"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/api/g/${slug}`, {
        method: "PATCH",
        body: { name, description, startDate: range.start, endDate: range.end, timezone },
      });
      await onChanged();
      toast(t("org.saved"));
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  const guarded = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (failure) {
      toast(errorMessage(failure));
    }
  };

  return (
    <Sheet title={t("org.title")} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <div>
          <label className="label" htmlFor="edit-name">
            {t("org.nameLabel")}
          </label>
          <input id="edit-name" className="field" required maxLength={LIMITS.groupNameLength} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="edit-note">
            {t("org.noteLabel")}
          </label>
          <textarea id="edit-note" className="field" rows={2} maxLength={LIMITS.descriptionLength} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div>
          <span className="label">{t("org.dates")}</span>
          <DateRangePicker value={range} onChange={setRange} minDay={group.startDate < today ? group.startDate : today} />
          {shrinks && <p className="mt-1 font-semibold">{t("org.shrinkWarning")}</p>}
        </div>
        {error && (
          <p role="alert" className="font-semibold text-danger">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary w-full" disabled={busy}>
          {busy ? t("org.saving") : t("org.save")}
        </button>
      </form>

      <section className="mt-8">
        <h3 className="mb-1 text-lg font-bold">{t("org.people")}</h3>
        <p className="mb-2 text-soft">{t("org.peopleBody")}</p>
        <ul className="border-t-[1.5px] border-rule">
          {state.participants.map((person) => (
            <li key={person.id} className="flex items-center justify-between gap-2 border-b-[1.5px] border-rule py-1.5">
              <span className="truncate">{person.id === me.id ? t("org.you", { name: person.name }) : person.name}</span>
              {person.id !== me.id && (
                <ConfirmButton
                  label={t("org.remove")}
                  confirmLabel={t("org.removeConfirm")}
                  className="btn btn-quiet shrink-0"
                  onConfirm={() =>
                    guarded(async () => {
                      await api(`/api/g/${slug}/participants/${person.id}`, { method: "DELETE" });
                      await onChanged();
                      toast(t("org.removedPerson", { name: person.name }));
                    })
                  }
                />
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h3 className="mb-1 text-lg font-bold">{t("org.replaceHeading")}</h3>
        <p className="mb-2 text-soft">{t("org.replaceBody")}</p>
        <ConfirmButton
          label={t("org.replace")}
          confirmLabel={t("org.replaceConfirm")}
          className="btn btn-plain"
          onConfirm={() =>
            guarded(async () => {
              onLeavingLink();
              const { slug: fresh } = await api<{ slug: string }>(`/api/g/${slug}/rotate`, { method: "POST" });
              // Keep the organiser signed in to the group under the new link.
              const joined = await api<JoinResult>(`/api/g/${fresh}/join`, { method: "POST", body: { name: me.name } });
              saveIdentity(fresh, { token: joined.token, id: joined.participant.id, name: joined.participant.name });
              clearIdentity(slug);
              toast(t("org.replaced"));
              navigate(`/g/${fresh}`, { replace: true });
            })
          }
        />
      </section>

      <section className="mt-8">
        <h3 className="mb-1 text-lg font-bold">{t("org.deleteHeading")}</h3>
        <p className="mb-2 text-soft">{t("org.deleteBody")}</p>
        <ConfirmButton
          label={t("org.delete")}
          confirmLabel={t("org.deleteConfirm")}
          onConfirm={() =>
            guarded(async () => {
              onLeavingLink();
              await api(`/api/g/${slug}`, { method: "DELETE" });
              clearIdentity(slug);
              toast(t("org.deleted"));
              navigate("/dashboard", { replace: true });
            })
          }
        />
      </section>
      <p className="mt-6">
        <Link to="/dashboard" className="underline underline-offset-3">
          {t("org.allGroups")}
        </Link>
      </p>
    </Sheet>
  );
}
