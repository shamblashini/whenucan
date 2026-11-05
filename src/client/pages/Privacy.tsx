import { LIMITS } from "@shared/limits";
import { useApp } from "../App";
import { SiteFooter, Wordmark, useTitle } from "../components/ui";
import { rich, t } from "../i18n";

export function Privacy() {
  useTitle(`${t("privacy.pageTitle")} | whenucan?`);
  const { config } = useApp();
  return (
    <>
      <main className="mx-auto max-w-2xl px-4 py-8">
        <Wordmark />
        <h1 className="mt-10 mb-6 text-4xl font-bold tracking-tight">{t("privacy.heading")}</h1>
        <div className="space-y-6 [&_h2]:mb-1 [&_h2]:text-xl [&_h2]:font-bold">
          <section>
            <h2>{t("privacy.linkHeading")}</h2>
            <p>{t("privacy.linkBody")}</p>
          </section>
          <section>
            <h2>{t("privacy.organiserHeading")}</h2>
            <p>{t("privacy.organiserBody")}</p>
          </section>
          <section>
            <h2>{t("privacy.keepHeading")}</h2>
            <p>{t("privacy.keepBody", { days: LIMITS.retentionDays })}</p>
          </section>
          <section>
            <h2>{t("privacy.browserHeading")}</h2>
            <p>{t("privacy.browserBody")}</p>
          </section>
          <section>
            <h2>{t("privacy.servicesHeading")}</h2>
            <p>{t("privacy.servicesBody")}</p>
          </section>
          <section id="your-data">
            <h2>{t("privacy.dataHeading")}</h2>
            <p className="mb-2">{t("privacy.dataBody")}</p>
            {config.contactEmail ? (
              <p>
                {rich("privacy.dataEmail", {
                  email: (
                    <a className="underline" href={`mailto:${config.contactEmail}`}>
                      {config.contactEmail}
                    </a>
                  ),
                })}
              </p>
            ) : (
              config.repoUrl && (
                <p>
                  {rich("privacy.dataIssue", {
                    link: (
                      <a className="underline" href={`${config.repoUrl}/issues`}>
                        {t("privacy.dataIssueLink")}
                      </a>
                    ),
                  })}
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
