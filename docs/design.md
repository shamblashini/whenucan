# whenucan: design and decisions

"When you can?" A group picks a date without anyone making an account, except the organiser.

## What it does

1. The organiser signs in with Google and creates a group: name, optional note, date range.
2. They get a share link: `https://<domain>/g/<12 random characters>`.
3. Anyone with the link types a name. The same name is the same person (ignoring case and extra spaces).
4. People mark days yes, OK or no with a highlighter: pick a marker, then tap or drag.
5. People add proposals (a start and end time, with an optional title). Proposals appear in a list for
   everyone, each with yes, OK and no buttons. The person who proposes gets a yes automatically.
6. The "Everyone" view shows each day as a stacked column, ranks the best days, and shows who said what.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Domain | Set in `wrangler.jsonc` | Anyone self-hosting changes one line. The hosted copy uses `whenucan.app`. |
| Abuse protection | Invisible Turnstile plus limits | Guests never solve a puzzle in the normal case. See below. |
| Retention | Delete 90 days after a group's last date | Long enough to look back, and old data doesn't pile up. |
| Times | Wall-clock strings plus a group time zone label | Everyone reads the same "Fri 19:00", matching the plain calendar days. No time zone conversion and no DST bugs. People in other zones see a label saying which zone applies. |
| Organiser's identity | Same name screen as everyone, prefilled | One code path and one UI. The organiser's extra controls come from their session cookie. |
| Live updates | Polling (4s, 12s when idle, paused when hidden) | The `version` column makes an unchanged poll one row read and a 304. WebSockets and Durable Objects are not needed at this scale. |
| Languages | Own small `t()` with `Intl.PluralRules`, one lazy-loaded file per language | About 40 lines cover everything needed, and visitors download only their language. The API sends error keys, and the browser translates them. |
| Clock format | 24-hour unless the language uses 12-hour and the time zone is outside Europe | Browsers only reveal a format through the language, and many people in Europe use an en-US browser. The time inputs in the form are native, so they follow the browser's own format, which a page cannot change. |
| Database access | Plain D1 SQL | Six small tables do not justify an ORM. |

Left out on purpose, to keep it simple: calendar export, locking a final date,
closing a group, notifications, email.

## Architecture

One Cloudflare Worker serves everything.

- `src/worker`: Hono API on D1. `auth.ts` has Google sign-in and sessions, `groups.ts` has groups, votes and proposals,
  `turnstile.ts` verifies bot checks. A daily cron deletes expired data.
- `src/client`: React single-page app, served as static assets.
- `src/shared`: types, limits, date helpers and name rules, used by both sides.
- `migrations`: D1 schema.

## Identity and access

| Who | Credential | Can do |
| --- | --- | --- |
| Organiser | `__Host-session` cookie: HttpOnly, SameSite=Lax, 30 days, stored hashed in D1, revoked on sign-out | Create, edit and delete groups, remove people, replace the link, delete any proposal, delete the account |
| Participant | Signed token (HS256, 120 days) in `localStorage`, bound to one share link | Read the group, mark days, propose, vote, delete their own proposals |
| Anyone with the link | Nothing | See the group's name, note, dates and the list of names |

Names are not authentication. **Anyone with the link can answer as anyone.** This follows from the rule that the same
name is the same person, with no password. The join screen and privacy page say so. The link is the real secret, and
the organiser can remove people or replace the link.

## Abuse protection

Layers, from the outside in:

1. **Turnstile**, managed mode with `interaction-only` appearance, on organiser sign-in and when a participant joins.
   Invisible for almost everyone. It only runs at the name step, so voting stays instant afterwards.
2. **Rate limits** with Workers rate-limit bindings: all API requests 600/min per IP, writes 120/min per person, joins 15/min per IP,
   sign-in and group creation 20/min. These count per Cloudflare location, so treat them as approximate.
3. **Hard caps** enforced in D1, in `src/shared/limits.ts`:
   150 people and 100 proposals per group, 15 proposals per person, 40 new names per group per 10 minutes,
   10 new groups a day and 50 groups in total per organiser, a one-year date range, and length limits on all text.
4. **Organiser tools**: remove a person (with their answers and proposals), delete a proposal, replace the link
   (the old link and its tokens stop working at once and answers stay), delete the group.
5. **Unguessable links**: about 70 bits, not indexed (an `X-Robots-Tag: noindex` header, which `robots.txt` deliberately leaves crawlers able to read), and kept out of `Referer` for other sites.
6. **Browser hardening**: strict CSP, no framing, HSTS, Origin check on writes, a 64 KB limit on request bodies, and control and bidi characters stripped from all text.

## Tests

- `pnpm test`: API tests against real D1 and rate-limit bindings in `workerd`, with Google and Turnstile faked at the network edge.
- `pnpm test:e2e`: browser tests with several people at once, drag and touch marking, live updates, and organiser tools.
