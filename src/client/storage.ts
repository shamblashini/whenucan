// Saved in this browser so people are not asked for their name on every visit.
// Storage can be blocked (private windows, strict settings), so a memory copy keeps this tab working.

const memory = new Map<string, string>();

function read(key: string): string | null {
  try {
    return localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(key: string, value: string | null): void {
  if (value === null) memory.delete(key);
  else memory.set(key, value);
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // The memory copy still serves this tab.
  }
}

export interface Identity {
  token: string;
  id: string;
  name: string;
}

const key = (slug: string) => `whenucan:${slug}`;

export function loadIdentity(slug: string): Identity | null {
  const raw = read(key(slug));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Identity;
  } catch {
    return null;
  }
}

export function saveIdentity(slug: string, identity: Identity): void {
  write(key(slug), JSON.stringify(identity));
}

export function clearIdentity(slug: string): void {
  write(key(slug), null);
}
