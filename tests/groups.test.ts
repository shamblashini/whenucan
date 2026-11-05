import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIMITS } from "@shared/limits";
import { cleanupExpired } from "../src/worker/auth";
import {
  call, createGroup, createOrganiser, errorCode, getMeta, getState, join, newIp, resetDb, stubFetch, testEnv,
} from "./helpers";

beforeEach(async () => {
  await resetDb();
  stubFetch();
});
afterEach(() => vi.restoreAllMocks());

async function setup() {
  const owner = await createOrganiser();
  const slug = await createGroup(owner.cookie);
  return { owner, slug };
}

const proposal = { title: "Dinner", startsAt: "2030-01-12T19:00", endsAt: "2030-01-12T22:00" };

describe("joining with a name", () => {
  it("treats the same name as the same person, whatever the case or spacing", async () => {
    const { slug } = await setup();
    const first = await join(slug, "Anna Maria");
    const second = await join(slug, "  anna   MARIA ");
    expect(first.returning).toBe(false);
    expect(second.returning).toBe(true);
    expect(second.participant).toEqual(first.participant);
    expect((await getState(slug, first.token)).participants).toHaveLength(1);
  });

  it("gives different names different people", async () => {
    const { slug } = await setup();
    const a = await join(slug, "Anna");
    const b = await join(slug, "Anne");
    expect(a.participant.id).not.toBe(b.participant.id);
  });

  it("rejects an empty name and strips control characters", async () => {
    const { slug } = await setup();
    const empty = await call(`/api/g/${slug}/join`, { method: "POST", body: { name: "  ​ ", turnstileToken: "ok" } });
    expect(empty.status).toBe(400);
    const { participant } = await join(slug, "Bo‮b");
    expect(participant.name).toBe("Bo b");
  });

  it("requires Turnstile from participants but not from the organiser", async () => {
    const { owner, slug } = await setup();
    vi.restoreAllMocks();
    stubFetch(undefined, false);

    const refused = await call(`/api/g/${slug}/join`, { method: "POST", body: { name: "Bot", turnstileToken: "bad" } });
    expect(refused.status).toBe(403);
    expect(await errorCode(refused)).toBe("turnstile_failed");

    const missing = await call(`/api/g/${slug}/join`, { method: "POST", body: { name: "Bot" } });
    expect(missing.status).toBe(403);

    const organiser = await call(`/api/g/${slug}/join`, { method: "POST", cookie: owner.cookie, body: { name: "Olive" } });
    expect(organiser.status).toBe(200);
  });

  it("does not show the group's answers without a token", async () => {
    const { slug } = await setup();
    expect((await call(`/api/g/${slug}/state`)).status).toBe(401);
    expect((await call(`/api/g/${slug}/state`, { token: "forged" })).status).toBe(401);
  });

  it("does not accept a token from another group", async () => {
    const { owner, slug } = await setup();
    const other = await createGroup(owner.cookie, { name: "Other" });
    const { token } = await join(other, "Anna");
    expect((await call(`/api/g/${slug}/state`, { token })).status).toBe(401);
  });

  it("answers 404 for an unknown link", async () => {
    expect((await call("/api/g/doesnotexist")).status).toBe(404);
  });

  it("lists existing names for the join screen and flags the owner", async () => {
    const { owner, slug } = await setup();
    await join(slug, "Zed");
    await join(slug, "Anna");
    const meta = await getMeta(slug);
    expect(meta.names).toEqual(["Anna", "Zed"]);
    expect(meta.isOwner).toBe(false);
    expect((await getMeta(slug, owner.cookie)).isOwner).toBe(true);
  });
});

describe("marking days", () => {
  it("saves, changes and clears answers", async () => {
    const { slug } = await setup();
    const { token, participant } = await join(slug, "Anna");
    const put = (changes: unknown[]) => call(`/api/g/${slug}/days`, { method: "PUT", token, body: { changes } });

    expect((await put([{ day: "2030-01-11", value: "yes" }, { day: "2030-01-12", value: "no" }])).status).toBe(200);
    let state = await getState(slug, token);
    expect(state.days["2030-01-11"][participant.id]).toBe("yes");
    expect(state.days["2030-01-12"][participant.id]).toBe("no");

    await put([{ day: "2030-01-11", value: "ok" }, { day: "2030-01-12", value: null }]);
    state = await getState(slug, token);
    expect(state.days["2030-01-11"][participant.id]).toBe("ok");
    expect(state.days["2030-01-12"]).toBeUndefined();
  });

  it("rejects days outside the range and bad values", async () => {
    const { slug } = await setup();
    const { token } = await join(slug, "Anna");
    const outside = await call(`/api/g/${slug}/days`, { method: "PUT", token, body: { changes: [{ day: "2030-02-01", value: "yes" }] } });
    expect(outside.status).toBe(400);
    const bad = await call(`/api/g/${slug}/days`, { method: "PUT", token, body: { changes: [{ day: "2030-01-11", value: "maybe" }] } });
    expect(bad.status).toBe(400);
    const notADay = await call(`/api/g/${slug}/days`, { method: "PUT", token, body: { changes: [{ day: "2030-02-31", value: "yes" }] } });
    expect(notADay.status).toBe(400);
  });

  it("uses the version for cheap polling", async () => {
    const { slug } = await setup();
    const { token } = await join(slug, "Anna");
    const first = await call(`/api/g/${slug}/state`, { token });
    const etag = first.headers.get("etag")!;
    const unchanged = await call(`/api/g/${slug}/state`, { token, headers: { "if-none-match": etag } });
    expect(unchanged.status).toBe(304);
    await call(`/api/g/${slug}/days`, { method: "PUT", token, body: { changes: [{ day: "2030-01-11", value: "yes" }] } });
    const changed = await call(`/api/g/${slug}/state`, { token, headers: { "if-none-match": etag } });
    expect(changed.status).toBe(200);
  });
});

describe("proposals", () => {
  async function create(slug: string, token: string, body: Record<string, string> = proposal) {
    return call(`/api/g/${slug}/proposals`, { method: "POST", token, body });
  }

  it("creates a proposal with the creator's yes, shows it to everyone, and takes votes", async () => {
    const { slug } = await setup();
    const anna = await join(slug, "Anna");
    const bob = await join(slug, "Bob");
    const created = await create(slug, anna.token);
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const vote = (value: string | null) =>
      call(`/api/g/${slug}/proposals/${id}/vote`, { method: "PUT", token: bob.token, body: { value } });
    expect((await vote("ok")).status).toBe(200);

    let [seen] = (await getState(slug, bob.token)).proposals;
    expect(seen).toMatchObject({ title: "Dinner", startsAt: proposal.startsAt, endsAt: proposal.endsAt });
    expect(seen.votes).toEqual({ [anna.participant.id]: "yes", [bob.participant.id]: "ok" });

    await vote(null);
    [seen] = (await getState(slug, bob.token)).proposals;
    expect(seen.votes).toEqual({ [anna.participant.id]: "yes" });
  });

  it("validates times", async () => {
    const { slug } = await setup();
    const { token } = await join(slug, "Anna");
    const cases: Record<string, string>[] = [
      { startsAt: "2030-01-12T22:00", endsAt: "2030-01-12T19:00" },
      { startsAt: "2030-01-12T19:00", endsAt: "2030-01-12T19:00" },
      { startsAt: "2030-02-12T19:00", endsAt: "2030-02-12T20:00" },
      { startsAt: "2030-01-20T19:00", endsAt: "2030-01-22T20:00" },
      { startsAt: "2030-01-12T25:00", endsAt: "2030-01-12T26:00" },
      { startsAt: "nonsense", endsAt: "2030-01-12T20:00" },
    ];
    for (const body of cases) expect((await create(slug, token, body)).status, JSON.stringify(body)).toBe(400);
    // A last-night plan may run past midnight.
    expect((await create(slug, token, { startsAt: "2030-01-20T22:00", endsAt: "2030-01-21T02:00" })).status).toBe(201);
  });

  it("refuses an exact duplicate without adding a stray vote", async () => {
    const { slug } = await setup();
    const { token } = await join(slug, "Anna");
    expect((await create(slug, token)).status).toBe(201);
    const duplicate = await create(slug, token);
    expect(duplicate.status).toBe(409);
    expect(await errorCode(duplicate)).toBe("duplicate");
    expect((await getState(slug, token)).proposals).toHaveLength(1);
  });

  it("lets the creator and the organiser delete, and nobody else", async () => {
    const { owner, slug } = await setup();
    const anna = await join(slug, "Anna");
    const bob = await join(slug, "Bob");
    const ids: string[] = [];
    for (const title of ["One", "Two"]) {
      ids.push(((await (await create(slug, anna.token, { ...proposal, title })).json()) as { id: string }).id);
    }
    const remove = (id: string, auth: { token?: string; cookie?: string }) =>
      call(`/api/g/${slug}/proposals/${id}`, { method: "DELETE", ...auth });

    expect((await remove(ids[0], { token: bob.token })).status).toBe(403);
    expect((await remove(ids[0], {})).status).toBe(401);
    expect((await remove(ids[0], { token: anna.token })).status).toBe(200);
    expect((await remove(ids[1], { cookie: owner.cookie })).status).toBe(200);
    expect((await getState(slug, anna.token)).proposals).toHaveLength(0);
  });

  it("does not take votes across groups", async () => {
    const { owner, slug } = await setup();
    const other = await createGroup(owner.cookie, { name: "Other" });
    const anna = await join(slug, "Anna");
    const { id } = (await (await create(slug, anna.token)).json()) as { id: string };
    const outsider = await join(other, "Eve");
    const vote = await call(`/api/g/${other}/proposals/${id}/vote`, { method: "PUT", token: outsider.token, body: { value: "no" } });
    expect(vote.status).toBe(404);
  });
});

describe("abuse limits", () => {
  it("stops new names when a group is full, but still lets existing people back in", async () => {
    const { slug } = await setup();
    await join(slug, "Anna");
    const { id: groupId } = (await testEnv.DB.prepare("SELECT id FROM groups WHERE slug = ?").bind(slug).first<{ id: string }>())!;
    const old = "2020-01-01T00:00:00.000Z";
    const inserts = Array.from({ length: LIMITS.participantsPerGroup - 1 }, (_, i) =>
      testEnv.DB.prepare("INSERT INTO participants (id, group_id, name, name_key, created_at) VALUES (?, ?, ?, ?, ?)").bind(`p${i}`, groupId, `P${i}`, `p${i}`, old),
    );
    await testEnv.DB.batch(inserts);

    const full = await call(`/api/g/${slug}/join`, { method: "POST", body: { name: "Newcomer", turnstileToken: "ok" } });
    expect(full.status).toBe(409);
    expect(await errorCode(full)).toBe("group_full");
    expect((await join(slug, "anna")).returning).toBe(true);
  });

  it("slows a burst of new names", async () => {
    const { slug } = await setup();
    const { id: groupId } = (await testEnv.DB.prepare("SELECT id FROM groups WHERE slug = ?").bind(slug).first<{ id: string }>())!;
    await testEnv.DB.batch(
      Array.from({ length: LIMITS.newNamesPer10Minutes }, (_, i) =>
        testEnv.DB.prepare("INSERT INTO participants (id, group_id, name, name_key) VALUES (?, ?, ?, ?)").bind(`b${i}`, groupId, `B${i}`, `b${i}`),
      ),
    );
    const response = await call(`/api/g/${slug}/join`, { method: "POST", body: { name: "One more", turnstileToken: "ok" } });
    expect(response.status).toBe(429);
  });

  it("caps proposals per person", async () => {
    const { slug } = await setup();
    const { token } = await join(slug, "Anna");
    for (let i = 0; i < LIMITS.proposalsPerParticipant; i++) {
      const response = await call(`/api/g/${slug}/proposals`, { method: "POST", token, body: { ...proposal, title: `P${i}` } });
      expect(response.status).toBe(201);
    }
    const over = await call(`/api/g/${slug}/proposals`, { method: "POST", token, body: { ...proposal, title: "Over" } });
    expect(over.status).toBe(409);
    expect(await errorCode(over)).toBe("too_many_proposals");
  });

  it("rate limits repeated joins from one address", async () => {
    const { slug } = await setup();
    const ip = newIp();
    const statuses: number[] = [];
    for (let i = 0; i < 40; i++) {
      statuses.push((await call(`/api/g/${slug}/join`, { method: "POST", ip, body: { name: "Anna", turnstileToken: "ok" } })).status);
    }
    expect(statuses).toContain(429);
  });

  it("caps groups per organiser per day", async () => {
    const owner = await createOrganiser();
    for (let i = 0; i < LIMITS.groupsPerDay; i++) await createGroup(owner.cookie, { name: `G${i}` });
    const over = await call("/api/groups", { method: "POST", cookie: owner.cookie, body: {
      name: "Over", startDate: "2030-01-10", endDate: "2030-01-20", timezone: "Europe/Warsaw",
    } });
    expect(over.status).toBe(429);
  });

  it("refuses writes from another site", async () => {
    const { slug } = await setup();
    const response = await call(`/api/g/${slug}/join`, {
      method: "POST",
      headers: { origin: "https://evil.example" },
      body: { name: "Anna", turnstileToken: "ok" },
    });
    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("bad_origin");
  });
});

describe("request limits", () => {
  it("refuses oversized bodies", async () => {
    const response = await call("/api/groups", { method: "POST", body: { name: "x".repeat(70 * 1024) } });
    expect(response.status).toBe(413);
  });

  it("rate limits every API route by IP, signed in or not", async () => {
    const ip = newIp();
    let last = 200;
    for (let i = 0; i < 700 && last !== 429; i++) {
      last = (await call("/api/g/doesnotexist1/proposals/x", { method: "DELETE", ip })).status;
    }
    expect(last).toBe(429);
  });
});

describe("organiser tools", () => {
  it("validates group fields", async () => {
    const owner = await createOrganiser();
    const post = (body: object) => call("/api/groups", { method: "POST", cookie: owner.cookie, body });
    const base = { name: "G", startDate: "2030-01-10", endDate: "2030-01-20", timezone: "Europe/Warsaw" };
    expect((await post({ ...base, name: " " })).status).toBe(400);
    expect((await post({ ...base, endDate: "2030-01-09" })).status).toBe(400);
    expect((await post({ ...base, endDate: "2031-06-01" })).status).toBe(400);
    expect((await post({ ...base, timezone: "Mars/Olympus" })).status).toBe(400);
    expect((await call("/api/groups", { method: "POST", body: base })).status).toBe(401);
  });

  it("protects organiser actions", async () => {
    const { slug } = await setup();
    const stranger = await createOrganiser("Stranger");
    expect((await call(`/api/g/${slug}`, { method: "DELETE" })).status).toBe(401);
    expect((await call(`/api/g/${slug}`, { method: "DELETE", cookie: stranger.cookie })).status).toBe(403);
    expect((await call(`/api/g/${slug}/rotate`, { method: "POST", cookie: stranger.cookie })).status).toBe(403);
  });

  it("rotating the link kills the old link and tokens, and keeps answers", async () => {
    const { owner, slug } = await setup();
    const anna = await join(slug, "Anna");
    await call(`/api/g/${slug}/days`, { method: "PUT", token: anna.token, body: { changes: [{ day: "2030-01-11", value: "yes" }] } });

    const rotated = await call(`/api/g/${slug}/rotate`, { method: "POST", cookie: owner.cookie });
    const { slug: fresh } = (await rotated.json()) as { slug: string };
    expect(fresh).not.toBe(slug);
    expect((await call(`/api/g/${slug}`)).status).toBe(404);
    expect((await call(`/api/g/${fresh}/state`, { token: anna.token })).status).toBe(401);

    const again = await join(fresh, "Anna");
    expect(again.returning).toBe(true);
    expect((await getState(fresh, again.token)).days["2030-01-11"][again.participant.id]).toBe("yes");
  });

  it("removing someone deletes their answers and proposals and ends their access", async () => {
    const { owner, slug } = await setup();
    const spammer = await join(slug, "Spammer");
    const anna = await join(slug, "Anna");
    await call(`/api/g/${slug}/proposals`, { method: "POST", token: spammer.token, body: proposal });
    await call(`/api/g/${slug}/days`, { method: "PUT", token: spammer.token, body: { changes: [{ day: "2030-01-11", value: "no" }] } });

    const removed = await call(`/api/g/${slug}/participants/${spammer.participant.id}`, { method: "DELETE", cookie: owner.cookie });
    expect(removed.status).toBe(200);

    const state = await getState(slug, anna.token);
    expect(state.participants.map((p) => p.name)).toEqual(["Anna"]);
    expect(state.proposals).toHaveLength(0);
    expect(state.days).toEqual({});
    const write = await call(`/api/g/${slug}/days`, { method: "PUT", token: spammer.token, body: { changes: [{ day: "2030-01-11", value: "no" }] } });
    expect(write.status).toBe(401);
    const read = await call(`/api/g/${slug}/state`, { token: spammer.token });
    expect(read.status).toBe(401);
    expect(await errorCode(read)).toBe("no_token");
  });

  it("shortening the dates removes answers outside the new range", async () => {
    const { owner, slug } = await setup();
    const { token, participant } = await join(slug, "Anna");
    await call(`/api/g/${slug}/days`, { method: "PUT", token, body: { changes: [
      { day: "2030-01-11", value: "yes" }, { day: "2030-01-19", value: "yes" },
    ] } });
    const patched = await call(`/api/g/${slug}`, { method: "PATCH", cookie: owner.cookie, body: {
      name: "Renamed", description: "", startDate: "2030-01-10", endDate: "2030-01-15", timezone: "Europe/Warsaw",
    } });
    expect(patched.status).toBe(200);
    const state = await getState(slug, token);
    expect(state.group.name).toBe("Renamed");
    expect(Object.keys(state.days)).toEqual(["2030-01-11"]);
    expect(state.days["2030-01-11"][participant.id]).toBe("yes");
  });

  it("deleting a group removes everything in it", async () => {
    const { owner, slug } = await setup();
    const { token } = await join(slug, "Anna");
    await call(`/api/g/${slug}/days`, { method: "PUT", token, body: { changes: [{ day: "2030-01-11", value: "yes" }] } });
    expect((await call(`/api/g/${slug}`, { method: "DELETE", cookie: owner.cookie })).status).toBe(200);
    expect((await call(`/api/g/${slug}`)).status).toBe(404);
    const left = await testEnv.DB.prepare("SELECT (SELECT COUNT(*) FROM participants) + (SELECT COUNT(*) FROM day_votes) AS n").first<{ n: number }>();
    expect(left!.n).toBe(0);
  });

  it("lists only the organiser's own groups with a head count", async () => {
    const { owner, slug } = await setup();
    await join(slug, "Anna");
    const other = await createOrganiser("Other");
    await createGroup(other.cookie, { name: "Theirs" });
    const { groups } = (await (await call("/api/groups", { cookie: owner.cookie })).json()) as { groups: { slug: string; people: number }[] };
    expect(groups).toEqual([expect.objectContaining({ slug, people: 1 })]);
  });
});

describe("retention", () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

  it("deletes groups 90 days after their last date, with their contents", async () => {
    const owner = await createOrganiser();
    const expired = await createGroup(owner.cookie, { name: "Old", startDate: daysAgo(100), endDate: daysAgo(91) });
    const kept = await createGroup(owner.cookie, { name: "Recent", startDate: daysAgo(100), endDate: daysAgo(89) });
    await join(expired, "Anna");

    await cleanupExpired(testEnv);

    expect((await call(`/api/g/${expired}`)).status).toBe(404);
    expect((await call(`/api/g/${kept}`)).status).toBe(200);
    const left = await testEnv.DB.prepare("SELECT COUNT(*) AS n FROM participants").first<{ n: number }>();
    expect(left!.n).toBe(0);
  });

  it("removes expired sessions and accounts with nothing left", async () => {
    const owner = await createOrganiser();
    await testEnv.DB.prepare("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE user_id = ?").bind(owner.id).run();
    await cleanupExpired(testEnv);
    const user = await testEnv.DB.prepare("SELECT id FROM users WHERE id = ?").bind(owner.id).first();
    expect(user).toBeNull();
    expect((await call("/api/me", { cookie: owner.cookie })).status).toBe(200);
  });
});
