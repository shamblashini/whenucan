import { Hono, type Context } from "hono";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { addDays, daysBetween, isDay, isLocalDateTime } from "@shared/dates";
import { LIMITS } from "@shared/limits";
import { cleanName, cleanText, nameKey } from "@shared/names";
import type { GroupMeta, GroupState, GroupSummary, JoinResult, Proposal, Vote } from "@shared/types";
import { currentUser, requireUser } from "./auth";
import { ApiError, clientIp, newSlug, rateLimit, secretKey, type AppContext } from "./env";
import { calendarFile } from "./ics";
import { verifyTurnstile } from "./turnstile";

interface GroupRow {
  id: string;
  slug: string;
  owner_id: string;
  name: string;
  description: string;
  start_date: string;
  end_date: string;
  timezone: string;
  version: number;
}

const day = z.string().refine(isDay, "error.invalidDate");
const vote = z.enum(["yes", "ok", "no"]);

const validTimezone = (value: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

const groupFields = z.object({
  name: z.string().transform(cleanText).pipe(z.string().min(1, "error.groupName").max(LIMITS.groupNameLength)),
  description: z.string().transform(cleanText).pipe(z.string().max(LIMITS.descriptionLength)).default(""),
  startDate: day,
  endDate: day,
  timezone: z.string().max(64).refine(validTimezone, "error.invalidTimezone"),
});

const checkRange = (value: { startDate: string; endDate: string }) => {
  const length = daysBetween(value.startDate, value.endDate);
  if (length < 0) throw new ApiError(400, "invalid", "error.lastDayBeforeFirst");
  if (length >= LIMITS.rangeDays) throw new ApiError(400, "invalid", "error.rangeTooLong");
};

const joinBody = z.object({
  name: z.string().max(400).transform(cleanName).pipe(z.string().min(1, "error.nameRequired")),
  turnstileToken: z.string().max(4096).optional(),
});
const daysBody = z.object({
  changes: z
    .array(z.object({ day, value: vote.nullable() }))
    .min(1)
    .max(LIMITS.dayChangesPerRequest),
});
const proposalBody = z.object({
  title: z.string().transform(cleanText).pipe(z.string().max(LIMITS.proposalTitleLength)).default(""),
  startsAt: z.string().refine(isLocalDateTime, "error.invalidStart"),
  endsAt: z.string().refine(isLocalDateTime, "error.invalidEnd"),
});
const voteBody = z.object({ value: vote.nullable() });

async function findGroup(c: Context<AppContext>, slug: string): Promise<GroupRow> {
  const group = await c.env.DB.prepare("SELECT * FROM groups WHERE slug = ?").bind(slug).first<GroupRow>();
  if (!group) throw new ApiError(404, "group_not_found", "error.linkDead");
  return group;
}

async function findOwnedGroup(c: Context<AppContext>, slug: string): Promise<GroupRow> {
  const user = await requireUser(c);
  await rateLimit(c.env.RL_WRITE, `user:${user.id}`);
  const group = await findGroup(c, slug);
  if (group.owner_id !== user.id) throw new ApiError(403, "not_owner", "error.notOwner");
  return group;
}

const bumpVersion = (c: Context<AppContext>, groupId: string) =>
  c.env.DB.prepare("UPDATE groups SET version = version + 1 WHERE id = ?").bind(groupId);

/** The participant credential: signed, bound to one share link, so a new link ends old ones. */
async function participantToken(c: Context<AppContext>, slug: string, participantId: string): Promise<string> {
  return new SignJWT({ s: slug, p: participantId })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("120d")
    .sign(secretKey(c.env));
}

const REMOVED = "error.removed";

async function participantId(c: Context<AppContext>, slug: string): Promise<string> {
  const token = c.req.header("authorization")?.replace(/^Bearer /, "");
  if (!token) throw new ApiError(401, "no_token", "error.enterName");
  try {
    const { payload } = await jwtVerify<{ s: string; p: string }>(token, secretKey(c.env), { algorithms: ["HS256"] });
    if (payload.s === slug) return payload.p;
  } catch {
    // Reported below, with the same answer as a token for another group.
  }
  throw new ApiError(401, "no_token", "error.enterName");
}

/** Authenticates a writer: the token must be valid and the person must still be in the group. */
async function requireParticipant(c: Context<AppContext>, slug: string) {
  const id = await participantId(c, slug);
  await rateLimit(c.env.RL_WRITE, `participant:${id}`);
  const group = await findGroup(c, slug);
  const row = await c.env.DB.prepare("SELECT id FROM participants WHERE id = ? AND group_id = ?")
    .bind(id, group.id)
    .first();
  if (!row) throw new ApiError(401, "no_token", REMOVED);
  return { group, id };
}

export const groupRoutes = new Hono<AppContext>();

groupRoutes.get("/api/groups", async (c) => {
  const user = await requireUser(c);
  const { results } = await c.env.DB.prepare(
    `SELECT g.slug, g.name, g.start_date AS startDate, g.end_date AS endDate,
            (SELECT COUNT(*) FROM participants p WHERE p.group_id = g.id) AS people
     FROM groups g WHERE g.owner_id = ? ORDER BY g.end_date DESC, g.created_at DESC`,
  )
    .bind(user.id)
    .all<GroupSummary>();
  return c.json({ groups: results });
});

groupRoutes.post("/api/groups", async (c) => {
  const user = await requireUser(c);
  await rateLimit(c.env.RL_AUTH, `create:${user.id}`);
  const body = groupFields.parse(await c.req.json());
  checkRange(body);

  const counts = await c.env.DB.prepare(
    `SELECT COUNT(*) AS active,
            COALESCE(SUM(created_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')), 0) AS today
     FROM groups WHERE owner_id = ?`,
  )
    .bind(user.id)
    .first<{ active: number; today: number }>();
  if (counts!.today >= LIMITS.groupsPerDay) {
    throw new ApiError(429, "too_many_groups", "error.groupsPerDay", { count: LIMITS.groupsPerDay });
  }
  if (counts!.active >= LIMITS.activeGroupsPerUser) {
    throw new ApiError(429, "too_many_groups", "error.groupsTotal", { count: LIMITS.activeGroupsPerUser });
  }

  const slug = newSlug();
  await c.env.DB.prepare(
    `INSERT INTO groups (id, slug, owner_id, name, description, start_date, end_date, timezone)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), slug, user.id, body.name, body.description, body.startDate, body.endDate, body.timezone)
    .run();
  return c.json({ slug }, 201);
});

function publicGroup(group: GroupRow) {
  return {
    slug: group.slug,
    name: group.name,
    description: group.description,
    startDate: group.start_date,
    endDate: group.end_date,
    timezone: group.timezone,
  };
}

groupRoutes.get("/api/g/:slug", async (c) => {
  const group = await findGroup(c, c.req.param("slug"));
  const [{ results }, user] = await Promise.all([
    c.env.DB.prepare("SELECT name FROM participants WHERE group_id = ? ORDER BY name COLLATE NOCASE LIMIT 60")
      .bind(group.id)
      .all<{ name: string }>(),
    currentUser(c),
  ]);
  const meta: GroupMeta = {
    ...publicGroup(group),
    names: results.map((row) => row.name),
    isOwner: user?.id === group.owner_id,
  };
  return c.json(meta);
});

groupRoutes.patch("/api/g/:slug", async (c) => {
  const group = await findOwnedGroup(c, c.req.param("slug"));
  const body = groupFields.parse(await c.req.json());
  checkRange(body);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE groups SET name = ?, description = ?, start_date = ?, end_date = ?, timezone = ?, version = version + 1
       WHERE id = ?`,
    ).bind(body.name, body.description, body.startDate, body.endDate, body.timezone, group.id),
    // Answers for days that are no longer in the range would count towards nothing.
    c.env.DB.prepare(
      `DELETE FROM day_votes WHERE (day < ? OR day > ?)
       AND participant_id IN (SELECT id FROM participants WHERE group_id = ?)`,
    ).bind(body.startDate, body.endDate, group.id),
  ]);
  return c.json({ ok: true });
});

groupRoutes.delete("/api/g/:slug", async (c) => {
  const group = await findOwnedGroup(c, c.req.param("slug"));
  await c.env.DB.prepare("DELETE FROM groups WHERE id = ?").bind(group.id).run();
  return c.json({ ok: true });
});

/** Replaces the share link. The old link and every token issued for it stop working at once. */
groupRoutes.post("/api/g/:slug/rotate", async (c) => {
  const group = await findOwnedGroup(c, c.req.param("slug"));
  const slug = newSlug();
  await c.env.DB.prepare("UPDATE groups SET slug = ?, version = version + 1 WHERE id = ?").bind(slug, group.id).run();
  return c.json({ slug });
});

groupRoutes.delete("/api/g/:slug/participants/:id", async (c) => {
  const group = await findOwnedGroup(c, c.req.param("slug"));
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM participants WHERE id = ? AND group_id = ?").bind(c.req.param("id"), group.id),
    bumpVersion(c, group.id),
  ]);
  return c.json({ ok: true });
});

groupRoutes.post("/api/g/:slug/join", async (c) => {
  await rateLimit(c.env.RL_JOIN, clientIp(c.req.raw));
  const { name, turnstileToken } = joinBody.parse(await c.req.json());
  const group = await findGroup(c, c.req.param("slug"));

  const user = await currentUser(c);
  if (user?.id !== group.owner_id) await verifyTurnstile(c.env, c.req.raw, turnstileToken, "join");

  const key = nameKey(name);
  const db = c.env.DB;
  const lookup = db.prepare("SELECT id, name FROM participants WHERE group_id = ? AND name_key = ?").bind(group.id, key);
  let participant = await lookup.first<{ id: string; name: string }>();
  const returning = !!participant;

  if (!participant) {
    const counts = await db
      .prepare(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(created_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes')), 0) AS recent
         FROM participants WHERE group_id = ?`,
      )
      .bind(group.id)
      .first<{ total: number; recent: number }>();
    if (counts!.total >= LIMITS.participantsPerGroup) {
      throw new ApiError(409, "group_full", "error.groupFull", { count: LIMITS.participantsPerGroup });
    }
    if (counts!.recent >= LIMITS.newNamesPer10Minutes) {
      throw new ApiError(429, "rate_limited", "error.joiningBusy");
    }
    await db.batch([
      db
        .prepare("INSERT INTO participants (id, group_id, name, name_key) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING")
        .bind(crypto.randomUUID(), group.id, name, key),
      bumpVersion(c, group.id),
    ]);
    participant = await lookup.first<{ id: string; name: string }>();
  }

  const result: JoinResult = {
    token: await participantToken(c, group.slug, participant!.id),
    participant: participant!,
    returning,
  };
  return c.json(result);
});

groupRoutes.get("/api/g/:slug/state", async (c) => {
  const slug = c.req.param("slug");
  const me = await participantId(c, slug);
  const group = await findGroup(c, slug);

  const etag = `"${group.version}"`;
  c.header("ETag", etag);
  c.header("Cache-Control", "private, no-cache");
  if (c.req.header("if-none-match") === etag) return c.body(null, 304);

  const db = c.env.DB;
  // Checked only when there is something new to send. Removing someone changes the version,
  // so they can't get past this point, and unchanged polls stay one row read.
  const stillHere = await db.prepare("SELECT id FROM participants WHERE id = ? AND group_id = ?").bind(me, group.id).first();
  if (!stillHere) throw new ApiError(401, "no_token", REMOVED);

  const [participants, dayVotes, proposals, proposalVotes] = await db.batch([
    db.prepare("SELECT id, name FROM participants WHERE group_id = ? ORDER BY created_at").bind(group.id),
    db
      .prepare(
        `SELECT v.participant_id AS p, v.day AS d, v.value AS v FROM day_votes v
         JOIN participants p ON p.id = v.participant_id WHERE p.group_id = ?`,
      )
      .bind(group.id),
    db
      .prepare(
        `SELECT id, title, starts_at AS startsAt, ends_at AS endsAt, created_by AS createdBy FROM proposals
         WHERE group_id = ? ORDER BY starts_at, ends_at`,
      )
      .bind(group.id),
    db
      .prepare(
        `SELECT v.proposal_id AS proposal, v.participant_id AS p, v.value AS v FROM proposal_votes v
         JOIN proposals x ON x.id = v.proposal_id WHERE x.group_id = ?`,
      )
      .bind(group.id),
  ]);

  const days: GroupState["days"] = {};
  for (const row of dayVotes.results as { p: string; d: string; v: Vote }[]) {
    (days[row.d] ??= {})[row.p] = row.v;
  }
  const byId = new Map<string, Proposal>();
  for (const row of proposals.results as Omit<Proposal, "votes">[]) byId.set(row.id, { ...row, votes: {} });
  for (const row of proposalVotes.results as { proposal: string; p: string; v: Vote }[]) {
    byId.get(row.proposal)!.votes[row.p] = row.v;
  }

  const state: GroupState = {
    version: group.version,
    group: publicGroup(group),
    participants: participants.results as GroupState["participants"],
    days,
    proposals: [...byId.values()],
  };
  return c.json(state);
});

groupRoutes.put("/api/g/:slug/days", async (c) => {
  const { group, id } = await requireParticipant(c, c.req.param("slug"));
  const { changes } = daysBody.parse(await c.req.json());
  const db = c.env.DB;
  const statements = changes.map(({ day: changed, value }) => {
    if (changed < group.start_date || changed > group.end_date) {
      throw new ApiError(400, "invalid", "error.dayOutside");
    }
    return value
      ? db
          .prepare(
            `INSERT INTO day_votes (participant_id, day, value) VALUES (?, ?, ?)
             ON CONFLICT (participant_id, day) DO UPDATE SET value = excluded.value`,
          )
          .bind(id, changed, value)
      : db.prepare("DELETE FROM day_votes WHERE participant_id = ? AND day = ?").bind(id, changed);
  });
  await db.batch([...statements, bumpVersion(c, group.id)]);
  return c.json({ ok: true });
});

groupRoutes.post("/api/g/:slug/proposals", async (c) => {
  const { group, id } = await requireParticipant(c, c.req.param("slug"));
  const { title, startsAt, endsAt } = proposalBody.parse(await c.req.json());

  if (endsAt <= startsAt) throw new ApiError(400, "invalid", "error.endAfterStart");
  if (daysBetween(startsAt.slice(0, 10), endsAt.slice(0, 10)) > LIMITS.proposalDays) {
    throw new ApiError(400, "invalid", "error.proposalTooLong", { count: LIMITS.proposalDays });
  }
  // One extra day at the end, so a last-night plan can run past midnight.
  if (startsAt.slice(0, 10) < group.start_date || startsAt.slice(0, 10) > group.end_date ||
      endsAt.slice(0, 10) > addDays(group.end_date, 1)) {
    throw new ApiError(400, "invalid", "error.timeOutside");
  }

  const db = c.env.DB;
  const counts = await db
    .prepare("SELECT COUNT(*) AS total, COALESCE(SUM(created_by = ?), 0) AS mine FROM proposals WHERE group_id = ?")
    .bind(id, group.id)
    .first<{ total: number; mine: number }>();
  if (counts!.total >= LIMITS.proposalsPerGroup) {
    throw new ApiError(409, "too_many_proposals", "error.proposalsGroupLimit");
  }
  if (counts!.mine >= LIMITS.proposalsPerParticipant) {
    throw new ApiError(409, "too_many_proposals", "error.proposalsPersonLimit", { count: LIMITS.proposalsPerParticipant });
  }

  const proposalId = crypto.randomUUID();
  const [insert] = await db.batch([
    db
      .prepare(
        `INSERT INTO proposals (id, group_id, created_by, title, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT DO NOTHING`,
      )
      .bind(proposalId, group.id, id, title, startsAt, endsAt),
    // Proposing a time means you can make it. Does nothing if the insert above was a duplicate.
    db
      .prepare(
        `INSERT INTO proposal_votes (proposal_id, participant_id, value)
         SELECT id, ?, 'yes' FROM proposals WHERE id = ?`,
      )
      .bind(id, proposalId),
    bumpVersion(c, group.id),
  ]);
  if (!insert.meta.changes) throw new ApiError(409, "duplicate", "error.proposalDuplicate");
  return c.json({ id: proposalId }, 201);
});

groupRoutes.put("/api/g/:slug/proposals/:id/vote", async (c) => {
  const { group, id } = await requireParticipant(c, c.req.param("slug"));
  const { value } = voteBody.parse(await c.req.json());
  const proposal = await c.env.DB.prepare("SELECT id FROM proposals WHERE id = ? AND group_id = ?")
    .bind(c.req.param("id"), group.id)
    .first<{ id: string }>();
  if (!proposal) throw new ApiError(404, "proposal_not_found", "error.proposalRemoved");
  const db = c.env.DB;
  await db.batch([
    value
      ? db
          .prepare(
            `INSERT INTO proposal_votes (proposal_id, participant_id, value) VALUES (?, ?, ?)
             ON CONFLICT (proposal_id, participant_id) DO UPDATE SET value = excluded.value`,
          )
          .bind(proposal.id, id, value)
      : db.prepare("DELETE FROM proposal_votes WHERE proposal_id = ? AND participant_id = ?").bind(proposal.id, id),
    bumpVersion(c, group.id),
  ]);
  return c.json({ ok: true });
});

/**
 * The file calendar apps add an event from. Browsers open it with a plain link, so there is no
 * token: the share link and the proposal's random ID are what grant access.
 */
groupRoutes.get("/api/g/:slug/proposals/:id/calendar.ics", async (c) => {
  const group = await findGroup(c, c.req.param("slug"));
  const proposal = await c.env.DB.prepare("SELECT id, title, starts_at, ends_at FROM proposals WHERE id = ? AND group_id = ?")
    .bind(c.req.param("id"), group.id)
    .first<{ id: string; title: string; starts_at: string; ends_at: string }>();
  if (!proposal) throw new ApiError(404, "proposal_not_found", "error.proposalRemoved");
  const { origin, hostname } = new URL(c.req.url);
  const link = `${origin}/g/${group.slug}`;
  const body = calendarFile({
    uid: `${proposal.id}@${hostname}`,
    title: proposal.title ? `${proposal.title} (${group.name})` : group.name,
    description: [group.description, link].filter(Boolean).join("\n\n"),
    url: link,
    startsAt: proposal.starts_at,
    endsAt: proposal.ends_at,
    timezone: group.timezone,
  });
  return c.body(body, 200, {
    "Content-Type": "text/calendar; charset=utf-8",
    // No "attachment" and no filename: either can make iPhones save a file instead of offering to add the event.
    "Content-Disposition": "inline",
    "Cache-Control": "private, no-store",
  });
});

/** The person who proposed it can remove it, and so can the organiser. */
groupRoutes.delete("/api/g/:slug/proposals/:id", async (c) => {
  const slug = c.req.param("slug");
  const group = await findGroup(c, slug);
  const proposal = await c.env.DB.prepare("SELECT id, created_by FROM proposals WHERE id = ? AND group_id = ?")
    .bind(c.req.param("id"), group.id)
    .first<{ id: string; created_by: string }>();
  if (!proposal) throw new ApiError(404, "proposal_not_found", "error.proposalAlreadyRemoved");

  const user = await currentUser(c);
  if (user?.id === group.owner_id) {
    await rateLimit(c.env.RL_WRITE, `user:${user.id}`);
  } else {
    const { id } = await requireParticipant(c, slug);
    if (proposal.created_by !== id) throw new ApiError(403, "not_creator", "error.notCreator");
  }
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM proposals WHERE id = ?").bind(proposal.id),
    bumpVersion(c, group.id),
  ]);
  return c.json({ ok: true });
});
