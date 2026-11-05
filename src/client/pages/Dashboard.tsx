import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { addDays } from "@shared/dates";
import { LIMITS } from "@shared/limits";
import type { GroupSummary } from "@shared/types";
import { api, errorMessage } from "../api";
import { useApp } from "../App";
import { ConfirmButton, SiteFooter, Spinner, Wordmark, shareUrl, useTitle, useToast } from "../components/ui";
import { formatRangeDays, formatShort, localToday } from "../format";

export function Dashboard() {
  useTitle("Your groups | whenucan?");
  const { user, refreshUser } = useApp();
  const navigate = useNavigate();
  const toast = useToast();
  const today = useMemo(localToday, []);
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    api<{ groups: GroupSummary[] }>("/api/groups")
      .then(({ groups: list }) => setGroups(list))
      .catch((failure) => setError(errorMessage(failure)));
  }, [user]);

  if (!user) return <Navigate to="/" replace />;

  const signOut = async () => {
    await api("/api/auth/logout", { method: "POST" });
    await refreshUser();
    navigate("/");
  };

  const deleteAccount = async () => {
    try {
      await api("/api/me", { method: "DELETE" });
      await refreshUser();
      navigate("/");
    } catch (failure) {
      toast(errorMessage(failure));
    }
  };

  const copy = async (slug: string) => {
    try {
      await navigator.clipboard.writeText(shareUrl(slug));
      toast("Link copied");
    } catch {
      toast(shareUrl(slug));
    }
  };

  return (
    <>
      <main className="mx-auto max-w-3xl px-4 py-5">
        <header className="mb-10 flex items-center justify-between">
          <Wordmark />
          <button type="button" className="btn btn-quiet" onClick={signOut}>
            Sign out
          </button>
        </header>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-4xl font-bold tracking-tight">Your groups</h1>
          <Link to="/new" className="btn btn-primary">
            New group
          </Link>
        </div>
        {error && <p role="alert" className="font-semibold text-danger">{error}</p>}
        {!groups && !error && <Spinner />}
        {groups?.length === 0 && (
          <p className="text-lg">You have no groups yet. Create one to get a link you can share.</p>
        )}
        {groups && groups.length > 0 && (
          <ul className="border-t-[1.5px] border-rule">
            {groups.map((group) => {
              const over = group.endDate < today;
              return (
                <li key={group.slug} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b-[1.5px] border-rule py-4">
                  <div className="min-w-0">
                    <Link to={`/g/${group.slug}`} className="block truncate text-xl font-bold underline-offset-3 hover:underline">
                      {group.name}
                    </Link>
                    <p className="text-soft">
                      {formatRangeDays(group.startDate, group.endDate)}, {group.people} {group.people === 1 ? "person" : "people"}
                      {over && `. Deleted on ${formatShort(addDays(group.endDate, LIMITS.retentionDays + 1))}`}
                    </p>
                  </div>
                  <button type="button" className="btn btn-plain" onClick={() => copy(group.slug)}>
                    Copy link
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <section className="mt-16">
          <h2 className="mb-1 text-xl font-bold">Your account</h2>
          <p className="mb-3 text-soft">
            Signed in as {user.name} ({user.email}). Deleting your account also deletes all your groups and everyone's answers in them.
          </p>
          <ConfirmButton label="Delete my account" confirmLabel="Click again to delete everything" onConfirm={deleteAccount} />
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
