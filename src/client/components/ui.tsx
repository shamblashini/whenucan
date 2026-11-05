import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import type { Vote } from "@shared/types";
import { useApp } from "../App";

export function useTitle(title: string): void {
  useEffect(() => {
    document.title = title;
  }, [title]);
}

export function Wordmark({ className = "text-xl" }: { className?: string }) {
  return (
    <Link to="/" className={`wordmark no-underline ${className}`} aria-label="whenucan home">
      whenucan?
    </Link>
  );
}

export function Glyph({ value, className }: { value: Vote; className?: string }) {
  const paths: Record<Vote, string> = {
    yes: "M3 8.5 6.5 12 13 4",
    ok: "M2.5 9.5c2-3 3.5-3 5.5-1.2s3.5 1.8 5.5-1.3",
    no: "M4 4l8 8M12 4l-8 8",
  };
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[value]} />
    </svg>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <p role="status" className="py-16 text-center text-soft">
      {label}…
    </p>
  );
}

const ToastContext = createContext<(message: string) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((next: string) => {
    setMessage(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 4000);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center px-4">
        {message && <div className="rounded-lg bg-ink px-4 py-2 font-semibold text-paper">{message}</div>}
      </div>
    </ToastContext.Provider>
  );
}

/** A native modal dialog: focus trapping, Escape and the backdrop come from the browser. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog ref={ref} className="sheet" onClose={onClose} aria-labelledby="sheet-title">
      <div className="mb-4 flex items-start justify-between gap-4">
        <h2 id="sheet-title" className="text-2xl font-bold tracking-tight">
          {title}
        </h2>
        <button type="button" className="btn btn-quiet" onClick={() => ref.current?.close()}>
          Close
        </button>
      </div>
      {children}
    </dialog>
  );
}

/** A destructive button that asks for a second click instead of a popup. */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  className = "btn btn-danger",
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(timer);
  }, [armed]);
  return (
    <button
      type="button"
      className={className}
      disabled={busy}
      onClick={async () => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setBusy(true);
        try {
          await onConfirm();
        } finally {
          setBusy(false);
          setArmed(false);
        }
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

export function shareUrl(slug: string): string {
  return `${location.origin}/g/${slug}`;
}

export function ShareLink({ slug, groupName }: { slug: string; groupName: string }) {
  const toast = useToast();
  const url = shareUrl(slug);
  const input = useRef<HTMLInputElement>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied");
    } catch {
      input.current?.select();
      toast("Press copy on your keyboard to copy the link");
    }
  };
  const canShare = typeof navigator.share === "function" && matchMedia("(pointer: coarse)").matches;
  return (
    <div>
      <input ref={input} className="field mb-2 font-medium" readOnly value={url} aria-label="Share link" onFocus={(e) => e.target.select()} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary grow" onClick={copy}>
          Copy link
        </button>
        {canShare && (
          <button
            type="button"
            className="btn btn-plain grow"
            onClick={() => navigator.share({ title: groupName, text: `When can you? Mark your days for ${groupName}.`, url }).catch(() => {})}
          >
            Share
          </button>
        )}
      </div>
    </div>
  );
}

export function SiteFooter() {
  const { config } = useApp();
  return (
    <footer className="mx-auto mt-auto max-w-6xl px-4 pt-16 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4 border-t-[1.5px] border-rule pt-5 text-lg">
        {config.repoUrl && (
          <a href={config.repoUrl} className="group flex items-center gap-3">
            <svg viewBox="0 0 16 16" className="h-12 w-12" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
            </svg>
            <span>
              <span className="block font-bold underline-offset-3 group-hover:underline">{new URL(config.repoUrl).pathname.slice(1)} on GitHub</span>
              <span className="block text-base text-soft">Free and open source, with no ads</span>
            </span>
          </a>
        )}
        <nav aria-label="About whenucan" className="flex flex-wrap items-center gap-x-6 gap-y-1">
          {config.repoUrl && (
            <a href={`${config.repoUrl}/issues`} className="underline underline-offset-3">
              Report a problem
            </a>
          )}
          <Link to="/privacy" className="underline underline-offset-3">
            Privacy and data deletion
          </Link>
        </nav>
      </div>
    </footer>
  );
}
