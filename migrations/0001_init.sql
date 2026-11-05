-- Organisers. Only the people who create groups have accounts.
CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  google_sub  TEXT NOT NULL UNIQUE,
  email       TEXT NOT NULL,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);

-- `slug` is the secret part of the share link. `version` goes up on every change, so
-- clients can poll cheaply: an unchanged version costs one row read and returns 304.
CREATE TABLE groups (
  id           TEXT PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  start_date   TEXT NOT NULL,
  end_date     TEXT NOT NULL,
  timezone     TEXT NOT NULL,
  version      INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX groups_owner ON groups(owner_id);
CREATE INDEX groups_end ON groups(end_date);

-- The unique index is the "same name means same person" rule.
CREATE TABLE participants (
  id          TEXT PRIMARY KEY,
  group_id    TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  name_key    TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (group_id, name_key)
);

CREATE TABLE day_votes (
  participant_id  TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  day             TEXT NOT NULL,
  value           TEXT NOT NULL CHECK (value IN ('yes', 'ok', 'no')),
  PRIMARY KEY (participant_id, day)
) WITHOUT ROWID;

-- Times are wall-clock strings (2026-11-14T19:00) in the group's time zone, so everyone
-- reads the same time. The unique index also absorbs double submits.
CREATE TABLE proposals (
  id          TEXT PRIMARY KEY,
  group_id    TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  created_by  TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  title       TEXT NOT NULL DEFAULT '',
  starts_at   TEXT NOT NULL,
  ends_at     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (group_id, starts_at, ends_at, title)
);
CREATE INDEX proposals_creator ON proposals(created_by);

CREATE TABLE proposal_votes (
  proposal_id     TEXT NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  participant_id  TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  value           TEXT NOT NULL CHECK (value IN ('yes', 'ok', 'no')),
  PRIMARY KEY (proposal_id, participant_id)
) WITHOUT ROWID;
CREATE INDEX proposal_votes_participant ON proposal_votes(participant_id);
