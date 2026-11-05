import { useCallback, useEffect, useRef, useState } from "react";
import type { GroupState, Vote } from "@shared/types";
import { ApiFailure, errorMessage, failureFrom, rawRequest } from "./api";

const POLL_ACTIVE_MS = 4_000;
const POLL_IDLE_MS = 12_000;
const IDLE_AFTER_MS = 90_000;
const SAVE_DELAY_MS = 350;

/**
 * Keeps one group's state on screen. Changes show at once and save in the background; polling
 * brings in other people's answers. A poll that overlaps a local change is thrown away, so it
 * can't undo what the visitor just did.
 */
export function useGroupState(
  slug: string,
  token: string,
  handlers: { onSignedOut: (message?: string) => void; onGone: () => void; onError: (message: string) => void },
) {
  const [state, setState] = useState<GroupState | null>(null);
  const etag = useRef<string | null>(null);
  const changes = useRef(0);
  const saving = useRef(0);
  const queuedDays = useRef(new Map<string, Vote | null>());
  const lastChange = useRef(Date.now());
  const paused = useRef(false);
  const callbacks = useRef(handlers);
  callbacks.current = handlers;

  const refresh = useCallback(async () => {
    if (paused.current) return;
    const startedAt = changes.current;
    try {
      const response = await rawRequest(`/api/g/${slug}/state`, {
        token,
        headers: etag.current ? { "if-none-match": etag.current } : undefined,
      });
      // The page moved on while this was in flight, for example to a replaced link.
      if (paused.current || response.status === 304) return;
      if (response.status === 401) return callbacks.current.onSignedOut((await failureFrom(response)).message);
      if (response.status === 404) return callbacks.current.onGone();
      if (!response.ok) throw await failureFrom(response);
      const next = (await response.json()) as GroupState;
      if (changes.current !== startedAt || saving.current > 0 || queuedDays.current.size > 0) return;
      etag.current = response.headers.get("etag");
      lastChange.current = Date.now();
      setState(next);
    } catch (error) {
      // A missed poll is harmless; the next one catches up.
      if (!(error instanceof ApiFailure) || error.code !== "offline") console.warn("Could not refresh:", error);
    }
  }, [slug, token]);

  useEffect(() => {
    paused.current = false;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const schedule = () => {
      const idle = Date.now() - lastChange.current > IDLE_AFTER_MS;
      timer = setTimeout(tick, idle ? POLL_IDLE_MS : POLL_ACTIVE_MS);
    };
    const tick = async () => {
      if (document.visibilityState === "visible" && saving.current === 0) await refresh();
      if (!stopped) schedule();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        lastChange.current = Date.now();
        void refresh();
      }
    };
    void refresh();
    schedule();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      paused.current = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  /** Applies a change on screen now and sends it. If the server refuses, the true state returns. */
  const change = useCallback(
    async (apply: ((current: GroupState) => GroupState) | null, send: () => Promise<Response>): Promise<boolean> => {
      changes.current += 1;
      if (apply) setState((current) => current && apply(current));
      saving.current += 1;
      let ok = true;
      try {
        const response = await send();
        if (response.status === 401) {
          callbacks.current.onSignedOut((await failureFrom(response)).message);
          return false;
        }
        if (response.status === 404 && (await isGroupGone(slug))) {
          callbacks.current.onGone();
          return false;
        }
        if (!response.ok) throw await failureFrom(response);
      } catch (error) {
        ok = false;
        callbacks.current.onError(errorMessage(error));
      } finally {
        saving.current -= 1;
      }
      if (saving.current === 0 && queuedDays.current.size === 0) {
        etag.current = null;
        await refresh();
      }
      return ok;
    },
    [refresh, slug],
  );

  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const flushDays = useCallback(() => {
    clearTimeout(saveTimer.current);
    if (queuedDays.current.size === 0) return;
    const batch = [...queuedDays.current].map(([day, value]) => ({ day, value }));
    queuedDays.current.clear();
    void change(null, () => rawRequest(`/api/g/${slug}/days`, { method: "PUT", token, body: { changes: batch } }));
  }, [change, slug, token]);

  const markDay = useCallback(
    (participantId: string, day: string, value: Vote | null) => {
      changes.current += 1;
      queuedDays.current.set(day, value);
      setState((current) => {
        if (!current) return current;
        const forDay = { ...current.days[day] };
        if (value) forDay[participantId] = value;
        else delete forDay[participantId];
        return { ...current, days: { ...current.days, [day]: forDay } };
      });
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(flushDays, SAVE_DELAY_MS);
    },
    [flushDays],
  );

  // Don't lose the last few marks when someone closes the tab right after painting.
  useEffect(() => {
    const flush = () => flushDays();
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flushDays();
    };
  }, [flushDays]);

  const pause = useCallback(() => {
    paused.current = true;
  }, []);

  return { state, refresh, change, markDay, pause };
}

async function isGroupGone(slug: string): Promise<boolean> {
  return (await rawRequest(`/api/g/${slug}`)).status === 404;
}
