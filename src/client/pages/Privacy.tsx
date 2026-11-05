import { LIMITS } from "@shared/limits";
import { useApp } from "../App";
import { SiteFooter, Wordmark, useTitle } from "../components/ui";

export function Privacy() {
  useTitle("Privacy | whenucan?");
  const { config } = useApp();
  return (
    <>
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Wordmark />
      <h1 className="mt-10 mb-6 text-4xl font-bold tracking-tight">Privacy</h1>
      <div className="space-y-6 [&_h2]:mb-1 [&_h2]:text-xl [&_h2]:font-bold">
        <section>
          <h2>If you were sent a link</h2>
          <p>
            We store the name you type and the answers and proposals you add. Everyone with the link can see them. Don't type anything
            you wouldn't want the group to see. There is no password, so anyone with the link can answer under any name.
          </p>
        </section>
        <section>
          <h2>If you organise a group</h2>
          <p>
            Sign-in uses Google. We receive and store your Google account ID, name and email address, and use them only to sign you in and
            show you your groups. We don't see your Google password, calendar or contacts.
          </p>
        </section>
        <section>
          <h2>How long we keep it</h2>
          <p>
            Each group is deleted {LIMITS.retentionDays} days after its last date, with everything in it. Organisers can delete a group, or
            their whole account, at any time from the dashboard. Accounts with no groups and no active sign-in are deleted automatically.
          </p>
        </section>
        <section>
          <h2>Stored in your browser</h2>
          <p>
            Your browser keeps the name you used for each group, so you don't have to type it again. Organisers also get a sign-in cookie.
            We use no advertising or analytics cookies.
          </p>
        </section>
        <section>
          <h2>Other services</h2>
          <p>
            whenucan runs on Cloudflare, which hosts the data and handles rate limiting. Cloudflare Turnstile checks that visitors are not
            bots when they join a group or sign in, and processes technical data such as your IP address to do this. Google handles
            organiser sign-in.
          </p>
        </section>
        <section id="your-data">
          <h2>Delete or change your data</h2>
          <p className="mb-2">
            If you answered in a group, the fastest way is to ask its organiser, who can remove you and everything you added. Organisers can
            delete a group or their account from the dashboard.
          </p>
          {config.contactEmail ? (
            <p>
              You can also ask us to see, correct or delete your data. Write to{" "}
              <a className="underline" href={`mailto:${config.contactEmail}`}>{config.contactEmail}</a> with the group's link and the name you
              used. Please don't use GitHub issues for this, because they are public.
            </p>
          ) : (
            config.repoUrl && (
              <p>
                You can also ask us to see, correct or delete your data by{" "}
                <a className="underline" href={`${config.repoUrl}/issues`}>opening a GitHub issue</a>. Issues are public, so don't include names
                or group links.
              </p>
            )
          )}
        </section>
      </div>
    </main>
    <SiteFooter />
    </>
  );
}
