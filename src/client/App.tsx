import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Route, Routes } from "react-router";
import type { Account, Config } from "@shared/types";
import { api } from "./api";
import { t } from "./i18n";
import { Spinner, ToastProvider } from "./components/ui";
import { Dashboard } from "./pages/Dashboard";
import { GroupPage } from "./pages/GroupPage";
import { Landing } from "./pages/Landing";
import { NewGroup } from "./pages/NewGroup";
import { NotFound } from "./pages/NotFound";
import { Privacy } from "./pages/Privacy";

interface AppState {
  config: Config;
  user: Account | null;
  refreshUser: () => Promise<void>;
}

const AppContext = createContext<AppState>(null as unknown as AppState);
export const useApp = () => useContext(AppContext);

export function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [user, setUser] = useState<Account | null>(null);
  const [failed, setFailed] = useState(false);

  const refreshUser = useCallback(async () => {
    const { user: next } = await api<{ user: Account | null }>("/api/me");
    setUser(next);
  }, []);

  useEffect(() => {
    Promise.all([api<Config>("/api/config").then(setConfig), refreshUser()]).catch(() => setFailed(true));
  }, [refreshUser]);

  if (failed) {
    return (
      <main className="mx-auto max-w-lg px-4 py-20">
        <h1 className="mb-2 text-3xl font-bold">{t("app.loadFailedTitle")}</h1>
        <p className="mb-4">{t("app.loadFailedBody")}</p>
        <button type="button" className="btn btn-primary" onClick={() => location.reload()}>
          {t("app.reload")}
        </button>
      </main>
    );
  }
  if (!config) return <Spinner />;

  return (
    <AppContext.Provider value={{ config, user, refreshUser }}>
      <ToastProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/new" element={<NewGroup />} />
          <Route path="/g/:slug" element={<GroupPage />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </ToastProvider>
    </AppContext.Provider>
  );
}
