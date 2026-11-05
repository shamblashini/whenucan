import { Link } from "react-router";
import { Wordmark, useTitle } from "../components/ui";
import { t } from "../i18n";

export function NotFound() {
  useTitle(`${t("notFound.pageTitle")} | whenucan?`);
  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <Wordmark />
      <h1 className="mt-16 mb-2 text-4xl font-bold tracking-tight">{t("notFound.heading")}</h1>
      <p className="mb-6">{t("notFound.body")}</p>
      <Link to="/" className="btn btn-primary">
        {t("notFound.home")}
      </Link>
    </main>
  );
}
