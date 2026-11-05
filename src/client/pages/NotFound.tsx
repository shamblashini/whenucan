import { Link } from "react-router";
import { Wordmark, useTitle } from "../components/ui";

export function NotFound() {
  useTitle("Page not found | whenucan?");
  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <Wordmark />
      <h1 className="mt-16 mb-2 text-4xl font-bold tracking-tight">This page does not exist</h1>
      <p className="mb-6">Check the address, or start from the home page.</p>
      <Link to="/" className="btn btn-primary">
        Go to the home page
      </Link>
    </main>
  );
}
