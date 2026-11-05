export type Vote = "yes" | "ok" | "no";

export interface Config {
  turnstileSiteKey: string;
  googleEnabled: boolean;
  devLogin: boolean;
  contactEmail: string;
  repoUrl: string;
}

export interface Me {
  id: string;
  name: string;
  email: string;
}

export interface Account extends Me {
  groupCount: number;
}

export interface GroupSummary {
  slug: string;
  name: string;
  startDate: string;
  endDate: string;
  people: number;
}

export interface GroupMeta {
  slug: string;
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  timezone: string;
  names: string[];
  isOwner: boolean;
}

export interface Participant {
  id: string;
  name: string;
}

export interface Proposal {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  createdBy: string;
  votes: Record<string, Vote>;
}

export interface GroupState {
  version: number;
  group: Omit<GroupMeta, "names" | "isOwner">;
  participants: Participant[];
  /** day -> participant id -> vote */
  days: Record<string, Record<string, Vote>>;
  proposals: Proposal[];
}

export interface JoinResult {
  token: string;
  participant: Participant;
  returning: boolean;
}
